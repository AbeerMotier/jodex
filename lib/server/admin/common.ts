import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSource, type Source } from '@/lib/domain/catalog';
import type { FeedbackCount, MetricEvaluation, MetricRound, MonitorRef, RestroomRef } from '@/lib/domain/metrics';
import { isPeriod, periodRange, riyadhDate, type DateRange, type Period } from '@/lib/domain/time';
import { ApiError } from '../http';

const PAGE = 1000;
const UUID = /^[0-9a-f-]{36}$/i;

/** يجلب كل الصفوف على دفعات (حد PostgREST الافتراضي 1000 صف) */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface LocationFilter {
  buildingId?: string;
  floor?: string;
  restroomId?: string;
}

export interface CommonQuery extends LocationFilter {
  period: Period;
  range: DateRange;
  today: string;
}

export function parseCommon(sp: URLSearchParams, now: Date, defaultPeriod: Period = 'week'): CommonQuery {
  const p = sp.get('period');
  const period: Period = isPeriod(p) ? p : defaultPeriod;
  const today = riyadhDate(now);
  const buildingId = sp.get('building') || undefined;
  const restroomId = sp.get('restroom') || undefined;
  const floor = sp.get('floor')?.slice(0, 60) || undefined;
  if (buildingId && !UUID.test(buildingId)) throw new ApiError(422, 'bad_filter', 'قيمة المبنى غير صالحة.');
  if (restroomId && !UUID.test(restroomId)) throw new ApiError(422, 'bad_filter', 'قيمة دورة المياه غير صالحة.');
  return { period, range: periodRange(period, today), today, buildingId, floor, restroomId };
}

export function parseSource(sp: URLSearchParams): Source {
  const s = sp.get('source');
  return isSource(s) ? s : 'all';
}

export function parseUuid(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  if (!UUID.test(v)) throw new ApiError(422, 'bad_filter', 'قيمة الفلتر غير صالحة.');
  return v;
}

export async function loadRestroomRefs(client: SupabaseClient, options: { includeInactive?: boolean } = {}): Promise<(RestroomRef & { is_active: boolean })[]> {
  const [{ data: rooms, error }, { data: buildings }] = await Promise.all([
    client.from('restrooms').select('id, code, name, floor_label, building_id, is_active').order('code'),
    client.from('buildings').select('id, name'),
  ]);
  if (error) throw new Error(error.message);
  const bname = new Map((buildings ?? []).map((b) => [b.id, b.name]));
  return (rooms ?? [])
    .filter((r) => options.includeInactive || r.is_active)
    .map((r) => ({ ...r, building_name: bname.get(r.building_id) ?? '' }));
}

/** دورات المياه المطابقة لفلاتر الموقع (undefined = بلا تقييد) */
export function restroomScope(rooms: RestroomRef[], f: LocationFilter): Set<string> | undefined {
  if (!f.buildingId && !f.floor && !f.restroomId) return undefined;
  return new Set(
    rooms
      .filter((r) => (!f.buildingId || r.building_id === f.buildingId) && (!f.floor || r.floor_label === f.floor) && (!f.restroomId || r.id === f.restroomId))
      .map((r) => r.id),
  );
}

const ROUND_METRIC_COLUMNS =
  'id, restroom_id, round_date, shift, status, compliance_level, compliance_score, quality_score, assigned_monitor_id, executed_by_id, on_behalf_of_id, submitted_at';

function toMetricRound(r: Record<string, unknown>): MetricRound {
  return {
    id: String(r.id),
    restroom_id: String(r.restroom_id),
    round_date: String(r.round_date),
    shift: r.shift as MetricRound['shift'],
    status: r.status as MetricRound['status'],
    compliance_level: (r.compliance_level as MetricRound['compliance_level']) ?? null,
    compliance_score: r.compliance_score === null ? null : Number(r.compliance_score),
    quality_score: r.quality_score === null ? null : Number(r.quality_score),
    assigned_monitor_id: String(r.assigned_monitor_id),
    executed_by_id: (r.executed_by_id as string | null) ?? null,
    on_behalf_of_id: (r.on_behalf_of_id as string | null) ?? null,
    submitted_at: (r.submitted_at as string | null) ?? null,
  };
}

export async function loadPeriodRounds(client: SupabaseClient, range: DateRange, scope?: Set<string>): Promise<MetricRound[]> {
  if (scope && scope.size === 0) return [];
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = client.from('rounds').select(ROUND_METRIC_COLUMNS).gte('round_date', range.from).lte('round_date', range.to);
    if (scope) q = q.in('restroom_id', [...scope]);
    return q.order('round_date').order('id').range(from, to);
  });
  return rows.map(toMetricRound);
}

export async function loadPeriodEvaluations(client: SupabaseClient, range: DateRange, scope?: Set<string>): Promise<(MetricEvaluation & { needs_urgent: string | null })[]> {
  if (scope && scope.size === 0) return [];
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = client
      .from('supervisor_evaluations')
      .select('id, restroom_id, supervisor_id, submitted_at, score, needs_urgent, matches_round')
      .not('submitted_at', 'is', null)
      .gte('submitted_at', range.fromInstant.toISOString())
      .lt('submitted_at', range.toInstantExclusive.toISOString());
    if (scope) q = q.in('restroom_id', [...scope]);
    return q.order('submitted_at').order('id').range(from, to);
  });
  return rows.map((e) => ({
    id: String(e.id),
    restroom_id: String(e.restroom_id),
    supervisor_id: String(e.supervisor_id),
    submitted_at: String(e.submitted_at),
    score: e.score === null ? null : Number(e.score),
    needs_urgent: (e.needs_urgent as string | null) ?? null,
    matches_round: (e.matches_round as 'yes' | 'no' | null) ?? null,
  }));
}

export async function loadFeedbackSummary(client: SupabaseClient, range: DateRange, scope?: Set<string>): Promise<FeedbackCount[]> {
  const { data, error } = await client.rpc('feedback_summary', {
    p_from: range.fromInstant.toISOString(),
    p_to: range.toInstantExclusive.toISOString(),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { restroom_id: string; rating: number; total: number }[])
    .filter((r) => !scope || scope.has(r.restroom_id))
    .map((r) => ({ restroom_id: r.restroom_id, rating: Number(r.rating), total: Number(r.total) }));
}

export async function loadPrimaryMonitors(client: SupabaseClient): Promise<MonitorRef[]> {
  const [{ data, error }, { data: rooms, error: roomErr }] = await Promise.all([
    client
      .from('users')
      .select('id, full_name')
      .eq('role', 'contractor_monitor')
      .eq('monitor_kind', 'primary')
      .eq('is_active', true)
      .order('full_name'),
    client.from('restrooms').select('id, monitor_id').not('monitor_id', 'is', null),
  ]);
  if (error) throw new Error(error.message);
  if (roomErr) throw new Error(roomErr.message);
  const byMonitor = new Map<string, string[]>();
  for (const r of rooms ?? []) byMonitor.set(r.monitor_id, [...(byMonitor.get(r.monitor_id) ?? []), r.id]);
  return (data ?? []).map((u) => ({ id: u.id, full_name: u.full_name, restroom_ids: byMonitor.get(u.id) ?? [] }));
}

/** هل يقع أي من مواقع المراقب ضمن نطاق الفلاتر */
export function inScope(scope: Set<string> | undefined, restroomIds: string[]): boolean {
  return !scope || restroomIds.some((id) => scope.has(id));
}

export const PERIOD_TEXT: Record<Period, string> = { today: 'اليوم', week: 'آخر 7 أيام', month: 'آخر 30 يومًا' };
