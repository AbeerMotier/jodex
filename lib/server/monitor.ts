import 'server-only';
import { randomUUID } from 'node:crypto';
import { BADGE_STATUS, CAMERA_ONLY_SLOTS, DISPLAY_STATUS, PHOTO_SLOTS, SHIFT_LABEL, type PhotoSlot } from '@/lib/domain/catalog';
import { minutesToHHMM, riyadhDate, riyadhMinuteOfDay, riyadhWeekday } from '@/lib/domain/time';
import {
  computeCompliance,
  defaultShift,
  roundBadgeState,
  roundDisplayStatus,
  SHIFT_PLAN,
  shiftWindowState,
  windowText,
  worstBadge,
  type ComplianceLevel,
  type RoundStatus,
  type Shift,
} from '@/lib/domain/schedule';
import { qualityScore, type Answer } from '@/lib/domain/scoring';
import { roundSubmissionIssues, type RoundDraft, type RoundSubmitInput } from '@/lib/domain/validation';
import type { SessionUser } from './auth';
import { loadActiveItemsByGroup, loadSettings } from './catalog';
import { ApiError } from './http';
import { namesById } from './people';
import { assertFreshCapture, normalizePhoto, removePhotos, signPhotoUrls, storePhoto } from './photos';
import { syncRounds } from './rounds-maintenance';
import { createServiceClient, createUserClient } from './supabase';

export interface MonitorScope {
  /** دورات المياه المسندة (للأساسي: دوراته، وللنائب: دورات الأساسي) */
  restroomIds: string[];
  primaryId: string;
  primaryName: string;
  isSubstitute: boolean;
}

async function activeRestroomIdsOf(primaryId: string): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from('restrooms')
    .select('id')
    .eq('monitor_id', primaryId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

const NO_ASSIGNMENT = 'لا توجد دورات مياه مسندة لك حاليًا. راجع الأدمن.';

/** نطاق المراقب: الأساسي = دوراته، النائب = دورات الأساسي الذي ينوب عنه */
export async function resolveMonitorScope(user: SessionUser): Promise<MonitorScope> {
  if (user.role !== 'contractor_monitor') throw new ApiError(403, 'forbidden', 'لا تملك صلاحية الوصول لهذه الصفحة');
  let scope: Omit<MonitorScope, 'restroomIds'> | null = null;
  if (user.monitorKind === 'primary') {
    scope = { primaryId: user.id, primaryName: user.fullName, isSubstitute: false };
  } else if (user.monitorKind === 'substitute' && user.substituteForId) {
    const { data: primary } = await createServiceClient()
      .from('users')
      .select('id, full_name, is_active, monitor_kind')
      .eq('id', user.substituteForId)
      .maybeSingle();
    if (primary?.is_active && primary.monitor_kind === 'primary') {
      scope = { primaryId: primary.id, primaryName: primary.full_name, isSubstitute: true };
    }
  }
  if (!scope) throw new ApiError(409, 'no_assignment', NO_ASSIGNMENT);
  const restroomIds = await activeRestroomIdsOf(scope.primaryId);
  if (!restroomIds.length) throw new ApiError(409, 'no_assignment', NO_ASSIGNMENT);
  return { ...scope, restroomIds };
}

const ROUND_COLUMNS =
  'id, restroom_id, round_date, shift, status, assigned_monitor_id, executed_by_id, on_behalf_of_id, started_at, submitted_at, compliance_level, compliance_score, quality_score, idempotency_key';

interface RoundRow {
  id: string;
  restroom_id: string;
  round_date: string;
  shift: Shift;
  status: RoundStatus;
  assigned_monitor_id: string;
  executed_by_id: string | null;
  on_behalf_of_id: string | null;
  started_at: string | null;
  submitted_at: string | null;
  compliance_level: ComplianceLevel | null;
  compliance_score: number | null;
  quality_score: number | null;
  idempotency_key: string | null;
}

function planInfo(shift: Shift) {
  const p = SHIFT_PLAN[shift];
  return {
    start: minutesToHHMM(p.start),
    fullUntil: minutesToHHMM(Math.min(p.fullUntil, p.deadline)),
    nonFrom: minutesToHHMM(p.nonFrom),
    deadline: minutesToHHMM(p.deadline),
    // هل للجولة فترة «متأخر/غير ملتزم» داخل نافذتها (المسائية ملتزمة طوال نافذتها)
    hasLateBand: p.fullUntil < p.deadline,
  };
}

export function deadlineMessage(shift: Shift) {
  return `انتهى الوقت المسموح لإنهاء الجولة (${minutesToHHMM(SHIFT_PLAN[shift].deadline)})`;
}

export function notOpenMessage(shift: Shift) {
  return `لم يبدأ وقت ${SHIFT_LABEL[shift]} بعد. وقتها من ${windowText(shift)} بتوقيت الرياض.`;
}

/** بدء الجولة والعمل عليها (حفظ المسودة والصور والإرسال) داخل نافذتها فقط — بتوقيت الرياض */
function assertWindowOpen(round: RoundRow, now: Date) {
  const state = shiftWindowState(round.shift, riyadhMinuteOfDay(now));
  if (state === 'before') throw new ApiError(409, 'round_not_open', notOpenMessage(round.shift));
  if (state === 'closed') throw new ApiError(409, 'round_missed', deadlineMessage(round.shift));
}

/** الجولة المعروضة للمراقب الآن: درجة شريط الالتزام */
function liveComplianceBar(round: RoundRow, today: string, minute: number): number {
  if (round.status === 'submitted') return Number(round.compliance_score ?? 0);
  if (round.status === 'missed') return 0;
  const state = roundDisplayStatus(round, today, minute);
  if (state === 'late') {
    const c = computeCompliance(round.shift, minute);
    return c.ok ? c.score : 0;
  }
  return state === 'missed' ? 0 : 100;
}

interface MonitorRoom {
  id: string;
  code: string;
  name: string;
  floor_label: string;
  building_id: string;
}

export async function loadMonitorToday(user: SessionUser, now: Date, requestedRestroomId?: string | null) {
  const scope = await resolveMonitorScope(user);
  await syncRounds(now);
  const today = riyadhDate(now);
  const minute = riyadhMinuteOfDay(now);
  const client = await createUserClient();

  const [{ data: allRounds, error: rErr }, { data: roomRows, error: roomErr }, items, settings] = await Promise.all([
    client.from('rounds').select(ROUND_COLUMNS).in('restroom_id', scope.restroomIds).eq('round_date', today).order('shift'),
    client.from('restrooms').select('id, code, name, floor_label, building_id').in('id', scope.restroomIds),
    loadActiveItemsByGroup(),
    loadSettings(),
  ]);
  if (rErr) throw new Error(rErr.message);
  if (roomErr) throw new Error(roomErr.message);
  const rooms = (roomRows ?? []) as MonitorRoom[];
  if (!rooms.length) throw new ApiError(409, 'no_assignment', NO_ASSIGNMENT);
  const { data: buildingRows } = await client
    .from('buildings')
    .select('id, name')
    .in('id', [...new Set(rooms.map((r) => r.building_id))]);
  const buildingName = new Map((buildingRows ?? []).map((b) => [b.id as string, b.name as string]));
  rooms.sort(
    (x, y) =>
      (buildingName.get(x.building_id) ?? '').localeCompare(buildingName.get(y.building_id) ?? '', 'ar') ||
      x.code.localeCompare(y.code),
  );

  const roundsAll = (allRounds ?? []) as RoundRow[];
  const roomSummaries = rooms.map((room) => {
    const mine = roundsAll.filter((r) => r.restroom_id === room.id);
    const state = worstBadge(mine.map((r) => roundBadgeState(r, today, minute)));
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      floor: room.floor_label,
      building: buildingName.get(room.building_id) ?? '',
      badge: { state, ...BADGE_STATUS[state] },
      submitted: mine.filter((r) => r.status === 'submitted').length,
      total: mine.length,
    };
  });
  // الدورة المختارة: المطلوبة إن كانت ضمن النطاق، وإلا أول دورة لم تكتمل جولاتها
  const selected =
    rooms.find((r) => r.id === requestedRestroomId) ??
    rooms.find((r) => roomSummaries.find((x) => x.id === r.id)!.submitted < roomSummaries.find((x) => x.id === r.id)!.total) ??
    rooms[0];
  const room = selected;
  const building = { name: buildingName.get(room.building_id) ?? '' };
  const rounds = roundsAll.filter((r) => r.restroom_id === room.id);

  const list = (rounds ?? []) as RoundRow[];
  const pendingIds = list.filter((r) => r.status === 'pending').map((r) => r.id);
  const [{ data: photos }, { data: drafts }, names] = await Promise.all([
    pendingIds.length
      ? client.from('round_photos').select('round_id, slot, storage_key, size_bytes').in('round_id', pendingIds)
      : Promise.resolve({ data: [] as { round_id: string; slot: PhotoSlot; storage_key: string; size_bytes: number }[] }),
    pendingIds.length
      ? client.from('round_drafts').select('round_id, payload, updated_at').eq('monitor_id', user.id).in('round_id', pendingIds)
      : Promise.resolve({ data: [] as { round_id: string; payload: RoundDraft; updated_at: string }[] }),
    namesById(list.flatMap((r) => [r.executed_by_id, r.on_behalf_of_id])),
  ]);
  const urls = await signPhotoUrls((photos ?? []).map((p) => p.storage_key));

  const shaped = list.map((r) => {
    const display = roundDisplayStatus(r, today, minute);
    return {
      id: r.id,
      shift: r.shift,
      label: SHIFT_LABEL[r.shift],
      status: r.status,
      display,
      displayLabel: DISPLAY_STATUS[display].label,
      tone: DISPLAY_STATUS[display].tone,
      bar: liveComplianceBar(r, today, minute),
      plan: planInfo(r.shift),
      window: shiftWindowState(r.shift, minute),
      complianceLevel: r.compliance_level,
      complianceScore: r.compliance_score === null ? null : Number(r.compliance_score),
      submittedAt: r.submitted_at,
      startedAt: r.started_at,
      executedBy: r.executed_by_id ? names[r.executed_by_id] ?? null : null,
      onBehalfOf: r.on_behalf_of_id ? names[r.on_behalf_of_id] ?? null : null,
      photos: (photos ?? [])
        .filter((p) => p.round_id === r.id)
        .map((p) => ({ slot: p.slot as PhotoSlot, url: urls[p.storage_key] ?? null, size: p.size_bytes })),
      draft: (() => {
        const d = (drafts ?? []).find((x) => x.round_id === r.id);
        return d ? { answers: d.payload?.answers ?? {}, note: d.payload?.note ?? '', updatedAt: d.updated_at } : null;
      })(),
    };
  });

  const badge = worstBadge(list.map((r) => roundBadgeState(r, today, minute)));
  return {
    serverNow: now.toISOString(),
    today,
    minute,
    user: { id: user.id, name: user.fullName, isSubstitute: scope.isSubstitute },
    onBehalfOf: scope.isSubstitute ? scope.primaryName : null,
    restroom: { id: room.id, name: room.name, code: room.code, floor: room.floor_label, building: building.name },
    restrooms: roomSummaries,
    notice:
      requestedRestroomId && !rooms.some((r) => r.id === requestedRestroomId)
        ? 'دورة المياه التي مسحت رمزها ليست ضمن دوراتك؛ عُرضت أول دورة مسندة إليك.'
        : null,
    badge: { state: badge, ...BADGE_STATUS[badge] },
    defaultShift: defaultShift(minute, list),
    deep: {
      required: items.deep.length > 0 && riyadhWeekday(now) === settings.deep_clean_weekday,
      weekday: settings.deep_clean_weekday,
    },
    items: {
      contractor: items.contractor.map((i) => ({ id: i.id, title: i.title, description: i.description })),
      deep: items.deep.map((i) => ({ id: i.id, title: i.title, description: i.description })),
    },
    photoSlots: PHOTO_SLOTS,
    rounds: shaped,
  };
}

/** يتحقق أن الجولة تخص نطاق المراقب، وأنها لليوم، وما زالت مفتوحة */
async function openRoundForMonitor(user: SessionUser, roundId: string, now: Date) {
  const scope = await resolveMonitorScope(user);
  if (!/^[0-9a-f-]{36}$/i.test(roundId)) throw new ApiError(404, 'round_not_found', 'الجولة غير موجودة.');
  await syncRounds(now);
  const { data: round } = await createServiceClient().from('rounds').select(ROUND_COLUMNS).eq('id', roundId).maybeSingle();
  // لا نكشف وجود جولات مواقع أخرى
  if (!round || !scope.restroomIds.includes(round.restroom_id)) throw new ApiError(404, 'round_not_found', 'الجولة غير موجودة.');
  const r = round as RoundRow;
  if (r.round_date !== riyadhDate(now)) throw new ApiError(409, 'not_today', 'لا يمكن العمل على جولة يوم آخر.');
  return { scope, round: r };
}

function assertPending(round: RoundRow) {
  if (round.status === 'submitted') throw new ApiError(409, 'round_already_submitted', 'تم إرسال هذه الجولة مسبقًا ولا يمكن تعديلها.');
  if (round.status === 'missed') throw new ApiError(409, 'round_missed', deadlineMessage(round.shift));
}

async function markStarted(roundId: string, now: Date) {
  await createServiceClient()
    .from('rounds')
    .update({ started_at: now.toISOString() })
    .eq('id', roundId)
    .eq('status', 'pending')
    .is('started_at', null);
}

async function activeItemIds() {
  const items = await loadActiveItemsByGroup();
  return { items, allowed: new Set([...items.contractor, ...items.deep].map((i) => i.id)) };
}

export async function saveDraft(user: SessionUser, roundId: string, draft: RoundDraft, now: Date) {
  const { round } = await openRoundForMonitor(user, roundId, now);
  assertPending(round);
  assertWindowOpen(round, now);
  const { allowed } = await activeItemIds();
  const answers = Object.fromEntries(Object.entries(draft.answers).filter(([id]) => allowed.has(id)));
  const { error } = await createServiceClient()
    .from('round_drafts')
    .upsert(
      { monitor_id: user.id, round_id: round.id, payload: { answers, note: draft.note }, updated_at: now.toISOString() },
      { onConflict: 'monitor_id,round_id' },
    );
  if (error) throw new Error(error.message);
  await markStarted(round.id, now);
  return { savedAt: now.toISOString() };
}

function lockedFromDb(message: string | undefined, shift: Shift): ApiError | null {
  if (!message) return null;
  if (message.includes('round_locked') || message === 'round_missed') return new ApiError(409, 'round_locked', deadlineMessage(shift));
  if (message === 'round_not_open') return new ApiError(409, 'round_not_open', notOpenMessage(shift));
  if (message === 'round_already_submitted') return new ApiError(409, 'round_already_submitted', 'تم إرسال هذه الجولة مسبقًا ولا يمكن تعديلها.');
  return null;
}

export async function uploadRoundPhoto(user: SessionUser, roundId: string, slot: PhotoSlot, file: Buffer, now: Date, source: string | null = null) {
  const { round } = await openRoundForMonitor(user, roundId, now);
  assertPending(round);
  assertWindowOpen(round, now);
  // صورة العمالة: التقاط مباشر بالكاميرا فقط (لا صور محفوظة على الجهاز)
  if (CAMERA_ONLY_SLOTS.includes(slot)) await assertFreshCapture(file, source, now);
  const photo = await normalizePhoto(file);
  const key = `rounds/${round.id}/${slot}-${randomUUID()}.jpg`;
  await storePhoto(key, photo.buffer, photo.mime);
  const svc = createServiceClient();
  const { data: existing } = await svc.from('round_photos').select('storage_key').eq('round_id', round.id).eq('slot', slot).maybeSingle();
  const { error } = await svc
    .from('round_photos')
    .upsert(
      { round_id: round.id, slot, storage_key: key, mime: photo.mime, size_bytes: photo.size, uploaded_at: now.toISOString() },
      { onConflict: 'round_id,slot' },
    );
  if (error) {
    await removePhotos([key]);
    throw lockedFromDb(error.message, round.shift) ?? new Error(error.message);
  }
  if (existing?.storage_key && existing.storage_key !== key) await removePhotos([existing.storage_key]);
  await markStarted(round.id, now);
  const urls = await signPhotoUrls([key]);
  return { slot, url: urls[key] ?? null, size: photo.size };
}

export async function deleteRoundPhoto(user: SessionUser, roundId: string, slot: PhotoSlot, now: Date) {
  const { round } = await openRoundForMonitor(user, roundId, now);
  assertPending(round);
  assertWindowOpen(round, now);
  const svc = createServiceClient();
  const { data: existing } = await svc.from('round_photos').select('id, storage_key').eq('round_id', round.id).eq('slot', slot).maybeSingle();
  if (!existing) return { slot, deleted: false };
  const { error } = await svc.from('round_photos').delete().eq('id', existing.id);
  if (error) throw lockedFromDb(error.message, round.shift) ?? new Error(error.message);
  await removePhotos([existing.storage_key]);
  return { slot, deleted: true };
}

export async function submitRound(user: SessionUser, roundId: string, input: RoundSubmitInput, now: Date) {
  const { scope, round } = await openRoundForMonitor(user, roundId, now);
  const names = await namesById([round.executed_by_id, round.on_behalf_of_id]);

  // إرسال مكرر بنفس المفتاح يعيد النتيجة الأصلية دون أي كتابة جديدة
  if (round.status === 'submitted') {
    if (round.idempotency_key && round.idempotency_key === input.idempotencyKey) {
      return {
        duplicate: true,
        shift: round.shift,
        label: SHIFT_LABEL[round.shift],
        complianceLevel: round.compliance_level,
        complianceLabel: DISPLAY_STATUS[round.compliance_level ?? 'full'].label,
        complianceScore: Number(round.compliance_score),
        qualityScore: Number(round.quality_score),
        submittedAt: round.submitted_at,
        executedBy: round.executed_by_id ? names[round.executed_by_id] : null,
        onBehalfOf: round.on_behalf_of_id ? names[round.on_behalf_of_id] : null,
      };
    }
    throw new ApiError(409, 'round_already_submitted', 'تم إرسال هذه الجولة مسبقًا ولا يمكن تعديلها.');
  }
  if (round.status === 'missed') throw new ApiError(409, 'round_missed', deadlineMessage(round.shift));

  const minute = riyadhMinuteOfDay(now);
  const compliance = computeCompliance(round.shift, minute);
  if (!compliance.ok) {
    if (compliance.reason === 'not_open') throw new ApiError(409, 'round_not_open', notOpenMessage(round.shift));
    throw new ApiError(409, 'deadline_passed', deadlineMessage(round.shift));
  }

  const [{ items, allowed }, settings, { data: photoRows }] = await Promise.all([
    activeItemIds(),
    loadSettings(),
    createServiceClient().from('round_photos').select('slot').eq('round_id', round.id),
  ]);
  const unknown = Object.keys(input.answers).filter((id) => !allowed.has(id));
  if (unknown.length) throw new ApiError(422, 'unknown_items', 'تغيّرت بنود الجولة. حدّث الصفحة ثم أعد الإرسال.');

  const deepRequired = items.deep.length > 0 && riyadhWeekday(now) === settings.deep_clean_weekday;
  const answers = input.answers as Record<string, Answer>;
  const issues = roundSubmissionIssues({
    contractorItems: items.contractor,
    deepItems: items.deep,
    deepRequired,
    answers,
    photos: (photoRows ?? []).map((p) => p.slot as PhotoSlot),
  });
  if (issues.total > 0) {
    throw new ApiError(422, 'incomplete', 'أكمل البنود والصور الإلزامية قبل الإرسال', undefined, {
      missingItems: issues.missingItems.length,
      missingDeep: issues.missingDeep.length,
      missingPhotos: issues.missingPhotos,
    });
  }

  const weighted = items.contractor.map((i) => ({ id: i.id, title: i.title, weight: Number(i.weight ?? 0) }));
  const quality = qualityScore(weighted, answers, settings.partial_credit_pct);
  const snapshot = {
    version: 1,
    partial_credit_pct: settings.partial_credit_pct,
    deep_required: deepRequired,
    plan: planInfo(round.shift),
    items: items.contractor.map((i) => ({ id: i.id, key: i.key, title: i.title, weight: Number(i.weight ?? 0), group: 'contractor' })),
    deep_items: items.deep.map((i) => ({ id: i.id, key: i.key, title: i.title, group: 'deep' })),
  };
  const answerRows = Object.entries(answers)
    .filter(([, a]) => Boolean(a))
    .map(([item_id, answer]) => ({ item_id, answer }));

  const onBehalfOf = scope.isSubstitute ? scope.primaryId : null;
  const { data, error } = await createServiceClient().rpc('submit_round_tx', {
    p_round_id: round.id,
    p_executed_by: user.id,
    p_on_behalf_of: onBehalfOf,
    p_submitted_at: now.toISOString(),
    p_compliance_level: compliance.level,
    p_compliance_score: compliance.score,
    p_quality_score: quality,
    p_weights_snapshot: snapshot,
    p_note: input.note ?? '',
    p_answers: answerRows,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    if (error.message === 'round_already_submitted') throw new ApiError(409, 'round_already_submitted', 'تم إرسال هذه الجولة مسبقًا ولا يمكن تعديلها.');
    if (error.message === 'round_missed' || error.message.includes('round_locked')) throw new ApiError(409, 'round_missed', deadlineMessage(round.shift));
    if (error.message === 'round_photos_missing') throw new ApiError(422, 'incomplete', 'أكمل الصور الإلزامية قبل الإرسال');
    if (error.message === 'round_not_open') throw new ApiError(409, 'round_not_open', notOpenMessage(round.shift));
    throw new Error(error.message);
  }
  return {
    duplicate: Boolean(data?.duplicate),
    shift: round.shift,
    label: SHIFT_LABEL[round.shift],
    complianceLevel: compliance.level,
    complianceLabel: DISPLAY_STATUS[compliance.level].label,
    complianceScore: compliance.score,
    qualityScore: quality,
    submittedAt: now.toISOString(),
    executedBy: user.fullName,
    onBehalfOf: scope.isSubstitute ? scope.primaryName : null,
  };
}
