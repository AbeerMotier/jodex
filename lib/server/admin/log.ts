import 'server-only';
import { ANSWER_LABEL, DISPLAY_STATUS, PHOTO_SLOT_LABEL, PHOTO_SLOTS, RATING_LABEL, SHIFT_LABEL, type PhotoSlot } from '@/lib/domain/catalog';
import type { Rating } from '@/lib/domain/scoring';
import { instantDate } from '@/lib/domain/format';
import type { MetricEvaluation, MetricRound } from '@/lib/domain/metrics';
import { answerFactor, type Answer } from '@/lib/domain/scoring';
import { minutesToHHMM, riyadhMinuteOfDay } from '@/lib/domain/time';
import { roundDisplayStatus, SHIFT_PLAN, type Shift } from '@/lib/domain/schedule';
import { ApiError } from '../http';
import { namesById } from '../people';
import { signPhotoUrls } from '../photos';
import { syncRounds } from '../rounds-maintenance';
import { createUserClient } from '../supabase';
import { loadRestroomRefs, restroomScope, type CommonQuery } from './common';
import { evaluationEntry, roomView, roundEntry, type EntryView } from './presenters';

export const LOG_PAGE_SIZE = 25;

export const LOG_STATUS_OPTIONS = [
  { value: 'full', label: 'ملتزم تمامًا' },
  { value: 'behind', label: 'متأخر عن الخطة' },
  { value: 'non', label: 'غير ملتزم بالخطة' },
  { value: 'missed', label: 'فائتة' },
  { value: 'pending', label: 'لم تُرسل بعد' },
  { value: 'urgent', label: 'تقييم مشرف يحتاج معالجة فورية' },
] as const;
export type LogStatus = (typeof LOG_STATUS_OPTIONS)[number]['value'];

export interface LogQuery extends CommonQuery {
  kind?: 'round' | 'supervisor';
  status?: LogStatus;
  employeeId?: string;
  offset: number;
  limit: number;
}

interface LogViewRow {
  kind: 'round' | 'supervisor';
  id: string;
  restroom_id: string;
  entry_date: string;
  sort_at: string;
  occurred_at: string | null;
  round_type: string;
  status: string;
  compliance_level: string | null;
  compliance_score: number | null;
  score: number | null;
  employee_id: string;
  responsible_id: string;
  on_behalf_of_id: string | null;
  needs_urgent: string | null;
}

/** سجل الجولات: جولات المراقبين + تقييمات المشرفين (بدون المستفيدين)، من الأحدث */
export async function listLog(q: LogQuery, now: Date): Promise<{ rows: EntryView[]; total: number; offset: number; limit: number }> {
  await syncRounds(now);
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const scope = restroomScope(rooms, q);
  if (scope && scope.size === 0) return { rows: [], total: 0, offset: q.offset, limit: q.limit };

  let query = client
    .from('admin_log_entries')
    .select('*', { count: 'exact' })
    .gte('entry_date', q.range.from)
    .lte('entry_date', q.range.to);
  if (scope) query = query.in('restroom_id', [...scope]);
  if (q.kind) query = query.eq('kind', q.kind);
  if (q.employeeId) query = query.or(`employee_id.eq.${q.employeeId},responsible_id.eq.${q.employeeId}`);
  switch (q.status) {
    case 'full':
    case 'behind':
    case 'non':
      query = query.eq('kind', 'round').eq('status', 'submitted').eq('compliance_level', q.status);
      break;
    case 'missed':
    case 'pending':
      query = query.eq('kind', 'round').eq('status', q.status);
      break;
    case 'urgent':
      query = query.eq('kind', 'supervisor').eq('needs_urgent', 'yes');
      break;
  }
  const { data, count, error } = await query
    .order('sort_at', { ascending: false })
    .order('id', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as LogViewRow[];
  const names = await namesById(rows.flatMap((r) => [r.employee_id, r.responsible_id, r.on_behalf_of_id]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const minute = riyadhMinuteOfDay(now);
  return {
    total: count ?? 0,
    offset: q.offset,
    limit: q.limit,
    rows: rows.map((r) => {
      if (r.kind === 'round') {
        const metric: MetricRound = {
          id: r.id,
          restroom_id: r.restroom_id,
          round_date: r.entry_date,
          shift: r.round_type as Shift,
          status: r.status as MetricRound['status'],
          compliance_level: (r.compliance_level as MetricRound['compliance_level']) ?? null,
          compliance_score: r.compliance_score === null ? null : Number(r.compliance_score),
          quality_score: r.score === null ? null : Number(r.score),
          assigned_monitor_id: r.responsible_id,
          executed_by_id: r.status === 'submitted' ? r.employee_id : null,
          on_behalf_of_id: r.on_behalf_of_id,
          submitted_at: r.occurred_at,
        };
        return roundEntry(metric, roomMap, names, q.today, minute);
      }
      const ev: MetricEvaluation & { needs_urgent: string | null } = {
        id: r.id,
        restroom_id: r.restroom_id,
        supervisor_id: r.employee_id,
        submitted_at: r.occurred_at ?? r.sort_at,
        score: r.score === null ? null : Number(r.score),
        needs_urgent: r.needs_urgent,
      };
      return evaluationEntry(ev, roomMap, names, instantDate);
    }),
  };
}

interface Snapshot {
  partial_credit_pct?: number;
  items?: { id: string; title: string; weight: number }[];
  deep_items?: { id: string; title: string }[];
  plan?: { start: string; fullUntil: string; nonFrom: string; deadline: string };
}

/** تفاصيل جولة مراقب أو تقييم مشرف (للأدمن) */
export async function logDetails(kind: string, id: string, now: Date) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'not_found', 'السجل غير موجود.');
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const roomMap = new Map(rooms.map((r) => [r.id, r]));

  if (kind === 'round') {
    const { data: r } = await client
      .from('rounds')
      .select('id, restroom_id, round_date, shift, status, assigned_monitor_id, executed_by_id, on_behalf_of_id, started_at, submitted_at, compliance_level, compliance_score, quality_score, weights_snapshot, note')
      .eq('id', id)
      .maybeSingle();
    if (!r) throw new ApiError(404, 'not_found', 'السجل غير موجود.');
    const [{ data: answers }, { data: photos }, names] = await Promise.all([
      client.from('round_answers').select('item_id, answer').eq('round_id', id),
      client.from('round_photos').select('slot, storage_key').eq('round_id', id),
      namesById([r.executed_by_id, r.on_behalf_of_id, r.assigned_monitor_id]),
    ]);
    const snap = (r.weights_snapshot ?? {}) as Snapshot;
    const partial = Number(snap.partial_credit_pct ?? 50);
    const ans = new Map((answers ?? []).map((a) => [a.item_id, a.answer as Answer]));
    const urls = await signPhotoUrls((photos ?? []).map((p) => p.storage_key));
    const display = roundDisplayStatus(r as MetricRound, instantDate(now), riyadhMinuteOfDay(now));
    const shift = r.shift as Shift;
    const plan = SHIFT_PLAN[shift];
    const room = roomView(roomMap, r.restroom_id);
    const photoMap = new Map((photos ?? []).map((p) => [p.slot as PhotoSlot, urls[p.storage_key] ?? null]));
    return {
      kind: 'round' as const,
      kicker: 'مراقب المقاول · جولة ميدانية',
      title: `${SHIFT_LABEL[shift]} — ${room.name}`,
      score: r.status === 'submitted' ? Number(r.quality_score) : null,
      status: DISPLAY_STATUS[display],
      meta: [
        { k: 'التاريخ', v: r.round_date, type: 'date' },
        { k: 'وقت الإنهاء', v: r.submitted_at, type: 'time' },
        { k: 'الخطة الزمنية', v: `${minutesToHHMM(plan.start)} – ${minutesToHHMM(plan.deadline)} · ملتزم حتى ${minutesToHHMM(plan.fullUntil)}`, type: 'text' },
        { k: 'المنفّذ', v: r.executed_by_id ? names[r.executed_by_id] ?? '—' : '—', type: 'text' },
        { k: 'بالنيابة عن', v: r.on_behalf_of_id ? names[r.on_behalf_of_id] ?? '—' : '—', type: 'text' },
        { k: 'الموقع', v: `${room.name} · ${room.floor} · ${room.building}`, type: 'text' },
        { k: 'بدء الجولة', v: r.started_at, type: 'time' },
        { k: 'درجة الالتزام', v: r.compliance_score === null ? null : Number(r.compliance_score), type: 'pct' },
      ],
      answerHead: 'الإجابة',
      rows:
        r.status === 'submitted'
          ? (snap.items ?? []).map((i) => {
              const a = ans.get(i.id) ?? null;
              return {
                title: i.title,
                answer: a,
                answerLabel: a ? ANSWER_LABEL[a] : '—',
                tone: a === 'done' ? 'success' : a === 'partial' ? 'warning' : a === 'not_done' ? 'error' : 'neutral',
                weight: Number(i.weight),
                points: a ? Math.round(Number(i.weight) * answerFactor(a, partial) * 100) / 100 : 0,
              };
            })
          : [],
      formula: `تم = 100% من وزن البند · جزئي = ${partial}% · لم يتم = 0%`,
      deepRows: (snap.deep_items ?? [])
        .filter((i) => ans.has(i.id))
        .map((i) => {
          const a = ans.get(i.id)!;
          return { title: i.title, answer: a, answerLabel: ANSWER_LABEL[a], tone: a === 'done' ? 'success' : a === 'partial' ? 'warning' : 'error' };
        }),
      photos:
        r.status === 'submitted'
          ? PHOTO_SLOTS.filter((s) => s.required || photoMap.has(s.slot)).map((s) => ({ label: PHOTO_SLOT_LABEL[s.slot], url: photoMap.get(s.slot) ?? null }))
          : [],
      note:
        r.status === 'submitted'
          ? r.note || 'لا توجد ملاحظات.'
          : r.status === 'missed'
            ? 'لم تُنفّذ هذه الجولة.'
            : 'لم تُرسل هذه الجولة بعد.',
    };
  }

  if (kind === 'supervisor') {
    const { data: e } = await client
      .from('supervisor_evaluations')
      .select('id, restroom_id, supervisor_id, started_at, submitted_at, matches_round, needs_urgent, note, score, weights_snapshot, viewed_contractor_rounds_at')
      .eq('id', id)
      .not('submitted_at', 'is', null)
      .maybeSingle();
    if (!e) throw new ApiError(404, 'not_found', 'السجل غير موجود.');
    const [{ data: ratings }, { data: photos }, names] = await Promise.all([
      client.from('supervisor_ratings').select('item_id, rating').eq('evaluation_id', id),
      client.from('supervisor_photos').select('id, storage_key').eq('evaluation_id', id).order('uploaded_at'),
      namesById([e.supervisor_id]),
    ]);
    const snap = (e.weights_snapshot ?? {}) as Snapshot;
    const rate = new Map((ratings ?? []).map((x) => [x.item_id, Number(x.rating)]));
    const urls = await signPhotoUrls((photos ?? []).map((p) => p.storage_key));
    const room = roomView(roomMap, e.restroom_id);
    return {
      kind: 'supervisor' as const,
      kicker: 'المشرف الميداني · تقييم عام مستقل للموقع',
      title: `تقييم الموقع — ${room.name}`,
      score: Number(e.score),
      status: { label: 'مكتملة', tone: 'success' as const },
      meta: [
        { k: 'التاريخ', v: instantDate(e.submitted_at), type: 'date' },
        { k: 'الوقت', v: e.submitted_at, type: 'time' },
        { k: 'المشرف الميداني', v: names[e.supervisor_id] ?? '—', type: 'text' },
        { k: 'الموقع', v: `${room.name} · ${room.floor} · ${room.building}`, type: 'text' },
        { k: 'جولة المراقب مطابقة للواقع', v: e.matches_round === 'yes' ? 'نعم' : e.matches_round === 'no' ? 'لا' : '—', type: 'text' },
        { k: 'يحتاج معالجة فورية', v: e.needs_urgent === 'yes' ? 'نعم' : 'لا', type: 'text' },
      ],
      answerHead: 'التقييم',
      rows: (snap.items ?? []).map((i) => {
        const v = rate.get(i.id) ?? null;
        return {
          title: i.title,
          answer: v,
          answerLabel: v ? `${v} — ${RATING_LABEL[v as Rating]}` : '—',
          tone: v !== null && v <= 2 ? 'error' : 'neutral',
          weight: Number(i.weight),
          points: v ? Math.round((v / 5) * Number(i.weight) * 100) / 100 : 0,
        };
      }),
      formula: 'المساهمة = (درجة المعيار ÷ 5) × وزن المعيار',
      deepRows: [],
      photos: (photos ?? []).map((p, i) => ({ label: `صورة ${i + 1}`, url: urls[p.storage_key] ?? null })),
      note: e.note || 'لا توجد ملاحظات.',
    };
  }
  throw new ApiError(404, 'not_found', 'السجل غير موجود.');
}
