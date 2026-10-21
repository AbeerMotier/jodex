import 'server-only';
import { restroomLabel, timeHM } from '@/lib/domain/format';
import { randomUUID } from 'node:crypto';
import { ANSWER_LABEL, DISPLAY_STATUS, MAX_SUPERVISOR_PHOTOS, SHIFT_LABEL } from '@/lib/domain/catalog';
import { periodRange, riyadhDate, riyadhMinuteOfDay } from '@/lib/domain/time';
import { roundDisplayStatus, type ComplianceLevel, type RoundStatus, type Shift } from '@/lib/domain/schedule';
import { buildSupervisorNote, isLowRating, supervisorScore, type Answer } from '@/lib/domain/scoring';
import { evaluationIssues, type EvaluationSubmitInput } from '@/lib/domain/validation';
import type { SessionUser } from './auth';
import { loadActiveItemsByGroup, loadItems } from './catalog';
import { ApiError } from './http';
import { namesById } from './people';
import { normalizePhoto, removePhotos, signPhotoUrls, storePhoto } from './photos';
import { syncRounds } from './rounds-maintenance';
import { createServiceClient, createUserClient } from './supabase';

const UUID = /^[0-9a-f-]{36}$/i;

async function assertAssigned(user: SessionUser, restroomId: string) {
  if (!UUID.test(restroomId)) throw new ApiError(404, 'site_not_found', 'الموقع غير موجود.');
  const svc = createServiceClient();
  const [{ data: assignment }, { data: room }] = await Promise.all([
    svc.from('supervisor_assignments').select('restroom_id').eq('supervisor_id', user.id).eq('restroom_id', restroomId).maybeSingle(),
    svc.from('restrooms').select('id, name, floor_label, code, building_id, is_active').eq('id', restroomId).maybeSingle(),
  ]);
  // موقع غير مسند = غير موجود بالنسبة للمشرف
  if (!assignment || !room || !room.is_active) throw new ApiError(403, 'site_not_assigned', 'هذا الموقع غير مسند إليك.');
  return room;
}

export async function supervisorSites(user: SessionUser, now: Date) {
  const client = await createUserClient();
  const today = riyadhDate(now);
  const range = periodRange('today', today);
  const { data: assigns } = await client.from('supervisor_assignments').select('restroom_id').eq('supervisor_id', user.id);
  const ids = (assigns ?? []).map((a) => a.restroom_id);
  const [{ data: rooms }, { data: evals }, items] = await Promise.all([
    ids.length
      ? client.from('restrooms').select('id, code, name, floor_label, building_id').in('id', ids).eq('is_active', true).order('code')
      : Promise.resolve({ data: [] as { id: string; code: string; name: string; floor_label: string; building_id: string }[] }),
    client
      .from('supervisor_evaluations')
      .select('id, restroom_id, submitted_at, started_at')
      .eq('supervisor_id', user.id)
      .gte('started_at', range.fromInstant.toISOString())
      .lt('started_at', range.toInstantExclusive.toISOString())
      .order('started_at', { ascending: false }),
    loadActiveItemsByGroup(),
  ]);
  const buildingIds = [...new Set((rooms ?? []).map((r) => r.building_id))];
  const { data: buildings } = buildingIds.length
    ? await client.from('buildings').select('id, name').in('id', buildingIds)
    : { data: [] as { id: string; name: string }[] };
  const bname = new Map((buildings ?? []).map((b) => [b.id, b.name]));
  return {
    serverNow: now.toISOString(),
    today,
    supervisor: { id: user.id, name: user.fullName },
    items: items.supervisor.map((i) => ({ id: i.id, title: i.title, description: i.description, category: i.category })),
    sites: (rooms ?? []).map((r) => {
      const mine = (evals ?? []).filter((e) => e.restroom_id === r.id);
      const submitted = mine.filter((e) => e.submitted_at).sort((a, b) => (a.submitted_at! < b.submitted_at! ? 1 : -1));
      return {
        id: r.id,
        code: r.code,
        name: restroomLabel(r.name),
        floor: r.floor_label,
        building: bname.get(r.building_id) ?? '',
        lastSubmittedAt: submitted[0]?.submitted_at ?? null,
      };
    }),
  };
}

/** تقييم واحد في اليوم لكل موقع: تقييم المشرف المرسل اليوم لنفس الموقع (غير التقييم المحدد إن وُجد) */
async function assertNotEvaluatedToday(user: SessionUser, restroomId: string, now: Date, exceptId: string | null = null) {
  const range = periodRange('today', riyadhDate(now));
  let query = createServiceClient()
    .from('supervisor_evaluations')
    .select('id, submitted_at')
    .eq('supervisor_id', user.id)
    .eq('restroom_id', restroomId)
    .gte('submitted_at', range.fromInstant.toISOString())
    .lt('submitted_at', range.toInstantExclusive.toISOString())
    .limit(1);
  if (exceptId) query = query.neq('id', exceptId);
  const { data } = await query.maybeSingle();
  if (data?.submitted_at) {
    throw new ApiError(409, 'evaluated_today', `قيّمت هذا الموقع اليوم الساعة ${timeHM(data.submitted_at)}. التقييم مرة واحدة في اليوم لكل موقع.`);
  }
}

export async function startEvaluation(user: SessionUser, restroomId: string, now: Date) {
  await assertAssigned(user, restroomId);
  await assertNotEvaluatedToday(user, restroomId, now);
  const svc = createServiceClient();
  const range = periodRange('today', riyadhDate(now));
  const { data: open } = await svc
    .from('supervisor_evaluations')
    .select('id, started_at, viewed_contractor_rounds, viewed_contractor_rounds_at')
    .eq('supervisor_id', user.id)
    .eq('restroom_id', restroomId)
    .is('submitted_at', null)
    .gte('started_at', range.fromInstant.toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let evaluation = open;
  if (!evaluation) {
    const { data, error } = await svc
      .from('supervisor_evaluations')
      .insert({ restroom_id: restroomId, supervisor_id: user.id, started_at: now.toISOString() })
      .select('id, started_at, viewed_contractor_rounds, viewed_contractor_rounds_at')
      .single();
    if (error) throw new Error(error.message);
    evaluation = data;
  }
  const { data: photos } = await svc.from('supervisor_photos').select('id, storage_key').eq('evaluation_id', evaluation.id).order('uploaded_at');
  const urls = await signPhotoUrls((photos ?? []).map((p) => p.storage_key));
  return {
    evaluationId: evaluation.id,
    startedAt: evaluation.started_at,
    viewed: evaluation.viewed_contractor_rounds,
    viewedAt: evaluation.viewed_contractor_rounds_at,
    photos: (photos ?? []).map((p) => ({ id: p.id, url: urls[p.storage_key] ?? null })),
  };
}

async function ownOpenEvaluation(user: SessionUser, evaluationId: string) {
  if (!UUID.test(evaluationId)) throw new ApiError(404, 'evaluation_not_found', 'التقييم غير موجود.');
  const { data } = await createServiceClient()
    .from('supervisor_evaluations')
    .select('id, restroom_id, supervisor_id, submitted_at, viewed_contractor_rounds, idempotency_key, score, started_at')
    .eq('id', evaluationId)
    .maybeSingle();
  if (!data || data.supervisor_id !== user.id) throw new ApiError(404, 'evaluation_not_found', 'التقييم غير موجود.');
  return data;
}

interface SupRoundRow {
  id: string;
  round_date: string;
  shift: Shift;
  status: RoundStatus;
  compliance_level: ComplianceLevel | null;
  executed_by_id: string | null;
  on_behalf_of_id: string | null;
  submitted_at: string | null;
  quality_score: number | null;
  note: string | null;
  weights_snapshot: { items?: { id: string; title: string }[]; deep_items?: { id: string; title: string }[] } | null;
}

/** «تحقق رقابي»: جولتا المراقب لنفس الموقع لليوم أو لآخر يوم سابق (قراءة فقط) — ويُسجَّل الاطلاع */
export async function contractorRoundsForSupervisor(user: SessionUser, restroomId: string, evaluationId: string | null, now: Date) {
  await assertAssigned(user, restroomId);
  await syncRounds(now);
  const client = await createUserClient();
  const today = riyadhDate(now);
  const minute = riyadhMinuteOfDay(now);
  const cols = 'id, round_date, shift, status, compliance_level, executed_by_id, on_behalf_of_id, submitted_at, quality_score, note, weights_snapshot';

  let { data: rounds } = await client.from('rounds').select(cols).eq('restroom_id', restroomId).eq('round_date', today).order('shift');
  let date = today;
  if (!(rounds ?? []).some((r) => r.status === 'submitted')) {
    const { data: prev } = await client
      .from('rounds')
      .select('round_date')
      .eq('restroom_id', restroomId)
      .lt('round_date', today)
      .order('round_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      date = prev.round_date;
      ({ data: rounds } = await client.from('rounds').select(cols).eq('restroom_id', restroomId).eq('round_date', date).order('shift'));
    }
  }
  const list = (rounds ?? []) as SupRoundRow[];
  const ids = list.map((r) => r.id);
  const [{ data: answers }, names, currentItems] = await Promise.all([
    ids.length ? client.from('round_answers').select('round_id, item_id, answer').in('round_id', ids) : Promise.resolve({ data: [] as { round_id: string; item_id: string; answer: Answer }[] }),
    namesById(list.flatMap((r) => [r.executed_by_id, r.on_behalf_of_id])),
    loadItems(),
  ]);
  const itemTitle = new Map(currentItems.map((i) => [i.id, i.title]));

  let viewedAt: string | null = null;
  if (evaluationId) {
    const evaluation = await ownOpenEvaluation(user, evaluationId);
    if (evaluation.restroom_id !== restroomId) throw new ApiError(409, 'evaluation_site_mismatch', 'التقييم لا يخص هذا الموقع.');
    if (!evaluation.submitted_at) {
      const { data: updated } = await createServiceClient()
        .from('supervisor_evaluations')
        .update({ viewed_contractor_rounds: true, viewed_contractor_rounds_at: now.toISOString() })
        .eq('id', evaluation.id)
        .is('submitted_at', null)
        .eq('viewed_contractor_rounds', false)
        .select('viewed_contractor_rounds_at')
        .maybeSingle();
      viewedAt = updated?.viewed_contractor_rounds_at ?? now.toISOString();
    }
  }

  return {
    date,
    isToday: date === today,
    viewedAt,
    rounds: list.map((r) => {
      const display = roundDisplayStatus(r, today, minute);
      const snapItems = [...(r.weights_snapshot?.items ?? []), ...(r.weights_snapshot?.deep_items ?? [])];
      const snapTitle = new Map(snapItems.map((i) => [i.id, i.title]));
      const contractorIds = new Set((r.weights_snapshot?.items ?? []).map((i) => i.id));
      const mine = ((answers ?? []) as { round_id: string; item_id: string; answer: Answer }[]).filter((a) => a.round_id === r.id);
      const main = mine.filter((a) => contractorIds.size === 0 || contractorIds.has(a.item_id));
      return {
        id: r.id,
        shift: r.shift,
        label: SHIFT_LABEL[r.shift],
        status: r.status,
        statusLabel: DISPLAY_STATUS[display].label,
        tone: DISPLAY_STATUS[display].tone,
        executedBy: r.executed_by_id ? names[r.executed_by_id] ?? null : null,
        onBehalfOf: r.on_behalf_of_id ? names[r.on_behalf_of_id] ?? null : null,
        submittedAt: r.submitted_at,
        counts: {
          done: main.filter((a) => a.answer === 'done').length,
          partial: main.filter((a) => a.answer === 'partial').length,
          notDone: main.filter((a) => a.answer === 'not_done').length,
        },
        answers: mine.map((a) => ({
          title: snapTitle.get(a.item_id) ?? itemTitle.get(a.item_id) ?? '—',
          answer: a.answer,
          answerLabel: ANSWER_LABEL[a.answer],
          deep: !contractorIds.has(a.item_id) && contractorIds.size > 0,
        })),
        note: r.note,
      };
    }),
  };
}

export async function uploadEvaluationPhoto(user: SessionUser, evaluationId: string, file: Buffer, now: Date) {
  const evaluation = await ownOpenEvaluation(user, evaluationId);
  if (evaluation.submitted_at) throw new ApiError(409, 'evaluation_locked', 'تم إرسال هذا التقييم ولا يمكن تعديله.');
  await assertAssigned(user, evaluation.restroom_id);
  const svc = createServiceClient();
  const { count } = await svc.from('supervisor_photos').select('id', { count: 'exact', head: true }).eq('evaluation_id', evaluation.id);
  if ((count ?? 0) >= MAX_SUPERVISOR_PHOTOS) throw new ApiError(422, 'too_many_photos', `الحد الأقصى ${MAX_SUPERVISOR_PHOTOS} صور للتقييم الواحد.`);
  const photo = await normalizePhoto(file);
  const key = `evaluations/${evaluation.id}/${randomUUID()}.jpg`;
  await storePhoto(key, photo.buffer, photo.mime);
  const { data, error } = await svc
    .from('supervisor_photos')
    .insert({ evaluation_id: evaluation.id, storage_key: key, mime: photo.mime, size_bytes: photo.size, uploaded_at: now.toISOString() })
    .select('id')
    .single();
  if (error) {
    await removePhotos([key]);
    if (error.message.includes('evaluation_locked')) throw new ApiError(409, 'evaluation_locked', 'تم إرسال هذا التقييم ولا يمكن تعديله.');
    throw new Error(error.message);
  }
  const urls = await signPhotoUrls([key]);
  return { id: data.id, url: urls[key] ?? null };
}

export async function deleteEvaluationPhoto(user: SessionUser, evaluationId: string, photoId: string) {
  const evaluation = await ownOpenEvaluation(user, evaluationId);
  if (evaluation.submitted_at) throw new ApiError(409, 'evaluation_locked', 'تم إرسال هذا التقييم ولا يمكن تعديله.');
  if (!UUID.test(photoId)) throw new ApiError(404, 'photo_not_found', 'الصورة غير موجودة.');
  const svc = createServiceClient();
  const { data: photo } = await svc.from('supervisor_photos').select('id, storage_key').eq('id', photoId).eq('evaluation_id', evaluation.id).maybeSingle();
  if (!photo) throw new ApiError(404, 'photo_not_found', 'الصورة غير موجودة.');
  const { error } = await svc.from('supervisor_photos').delete().eq('id', photo.id);
  if (error) throw new Error(error.message);
  await removePhotos([photo.storage_key]);
  return { deleted: true };
}

export const NOT_VIEWED_MESSAGE = 'لا يمكن الإجابة عن سؤال المطابقة قبل فتح «تحقق رقابي» لمراجعة جولة المراقب.';

export async function submitEvaluation(user: SessionUser, input: EvaluationSubmitInput, now: Date) {
  const evaluation = await ownOpenEvaluation(user, input.evaluationId);
  const room = await assertAssigned(user, evaluation.restroom_id);

  if (evaluation.submitted_at) {
    if (evaluation.idempotency_key && evaluation.idempotency_key === input.idempotencyKey) {
      return {
        duplicate: true,
        evaluationId: evaluation.id,
        submittedAt: evaluation.submitted_at,
        score: Number(evaluation.score),
        restroom: { name: restroomLabel(room.name), floor: room.floor_label },
      };
    }
    throw new ApiError(409, 'evaluation_already_submitted', 'تم إرسال هذا التقييم مسبقًا ولا يمكن تعديله.');
  }
  await assertNotEvaluatedToday(user, evaluation.restroom_id, now, evaluation.id);

  // سؤال المطابقة مرفوض قبل فتح «تحقق رقابي» (يُتحقق منه على الخادم)
  if (input.matchesRound !== null && !evaluation.viewed_contractor_rounds) {
    throw new ApiError(409, 'contractor_rounds_not_viewed', NOT_VIEWED_MESSAGE);
  }

  const items = (await loadActiveItemsByGroup()).supervisor;
  const allowed = new Set(items.map((i) => i.id));
  if (Object.keys(input.ratings).some((id) => !allowed.has(id))) {
    throw new ApiError(422, 'unknown_items', 'تغيّرت بنود التقييم. حدّث الصفحة ثم أعد الإرسال.');
  }
  const issues = evaluationIssues({
    items,
    ratings: input.ratings,
    viewed: evaluation.viewed_contractor_rounds,
    matchesRound: input.matchesRound,
    needsUrgent: input.needsUrgent,
    note: input.note ?? '',
  });
  if (issues.total > 0) {
    const message = issues.missingRatings.length
      ? 'قيّم جميع البنود قبل الإرسال'
      : issues.missingMatch || issues.missingUrgent
        ? 'أجب عن سؤالي التحقق قبل الإرسال'
        : 'اكتب ملاحظة توضيحية للتقييم المنخفض';
    throw new ApiError(422, 'incomplete', message, issues.noteRequired ? { note: 'الملاحظة مطلوبة لوجود تقييم منخفض.' } : undefined, {
      missingRatings: issues.missingRatings.length,
      missingMatch: issues.missingMatch,
      missingUrgent: issues.missingUrgent,
      noteRequired: issues.noteRequired,
    });
  }

  const weighted = items.map((i) => ({ id: i.id, title: i.title, weight: Number(i.weight ?? 0) }));
  const score = supervisorScore(weighted, input.ratings);
  const lowTitles = items.filter((i) => isLowRating(input.ratings[i.id])).map((i) => i.title);
  const note = buildSupervisorNote(lowTitles, input.note);
  const snapshot = {
    version: 1,
    items: items.map((i) => ({ id: i.id, key: i.key, title: i.title, category: i.category, weight: Number(i.weight ?? 0), group: 'supervisor' })),
  };
  const { data, error } = await createServiceClient().rpc('submit_evaluation_tx', {
    p_evaluation_id: evaluation.id,
    p_supervisor_id: user.id,
    p_submitted_at: now.toISOString(),
    p_ratings: Object.entries(input.ratings).map(([item_id, rating]) => ({ item_id, rating })),
    p_matches_round: input.matchesRound,
    p_needs_urgent: input.needsUrgent,
    p_note: input.note ?? '',
    p_score: score,
    p_weights_snapshot: snapshot,
    p_note_text: note?.text ?? null,
    p_note_severity: note?.severity ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    if (error.message === 'contractor_rounds_not_viewed') throw new ApiError(409, 'contractor_rounds_not_viewed', NOT_VIEWED_MESSAGE);
    if (error.message === 'evaluation_already_submitted') throw new ApiError(409, 'evaluation_already_submitted', 'تم إرسال هذا التقييم مسبقًا ولا يمكن تعديله.');
    throw new Error(error.message);
  }
  return {
    duplicate: Boolean(data?.duplicate),
    evaluationId: evaluation.id,
    submittedAt: now.toISOString(),
    score,
    restroom: { name: restroomLabel(room.name), floor: room.floor_label },
    note: note ? { severity: note.severity, text: note.text } : null,
  };
}
