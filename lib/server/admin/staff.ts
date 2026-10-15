import 'server-only';
import { bonusCandidates, CLASSIFICATION_LABEL, monitorPerformance, rankByTotal } from '@/lib/domain/metrics';
import { periodRange, type Period } from '@/lib/domain/time';
import type { SessionUser } from '../auth';
import { audit } from '../audit';
import { ApiError } from '../http';
import { syncRounds } from '../rounds-maintenance';
import { createServiceClient, createUserClient } from '../supabase';
import { loadPeriodEvaluations, loadPeriodRounds, loadPrimaryMonitors, loadRestroomRefs, restroomScope, type CommonQuery } from './common';
import { roomView } from './presenters';

export interface StaffQuery extends CommonQuery {
  monitorId?: string;
  approval?: 'approved' | 'not_approved';
}

/**
 * أداء كل المراقبين الأساسيين في الفترة. المرشحون للمكافأة يُحددون على مستوى الجهة كلها
 * (أعلى 3)، وفلاتر الموقع تضيّق المعروض فقط — فيبقى الاعتماد متسقًا مع ما يراه الأدمن.
 */
async function performance(q: CommonQuery) {
  const client = await createUserClient();
  const rooms = await loadRestroomRefs(client, { includeInactive: true });
  const scope = restroomScope(rooms, q);
  const [monitors, rounds, evaluations] = await Promise.all([
    loadPrimaryMonitors(client),
    loadPeriodRounds(client, q.range),
    loadPeriodEvaluations(client, q.range),
  ]);
  const all = monitorPerformance(monitors, rounds, evaluations, 'all');
  return { rooms, scope, all, perf: scope ? all.filter((p) => scope.has(p.restroomId)) : all };
}

async function activeApprovals(period: Period, from: string, to: string) {
  const { data, error } = await createServiceClient()
    .from('bonus_approvals')
    .select('id, monitor_id, approved_at')
    .eq('period_type', period)
    .eq('period_start', from)
    .eq('period_end', to)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((a) => [a.monitor_id, a.approved_at as string]));
}

export async function staffReport(q: StaffQuery, now: Date) {
  await syncRounds(now);
  const { rooms, scope, all, perf } = await performance(q);
  const approvals = await activeApprovals(q.period, q.range.from, q.range.to);
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const filterRow = (monitorId: string) =>
    (!q.monitorId || monitorId === q.monitorId) &&
    (!q.approval || (q.approval === 'approved' ? approvals.has(monitorId) : !approvals.has(monitorId)));

  // الترتيب على مستوى الجهة (rank ثابت)، ثم يُعرض ما يقع ضمن الفلاتر
  const candidates = bonusCandidates(all)
    .map((p, i) => ({ p, rank: i + 1 }))
    .filter(({ p }) => (!scope || scope.has(p.restroomId)) && filterRow(p.monitorId))
    .map(({ p, rank }) => ({
      monitorId: p.monitorId,
      name: p.name,
      rank,
      cp: p.cp,
      q: p.q,
      restroom: roomView(roomMap, p.restroomId),
      approved: approvals.has(p.monitorId),
      approvedAt: approvals.get(p.monitorId) ?? null,
    }));
  const ranked = rankByTotal(perf);
  const rows = ranked
    .map((p, i) => ({
      rank: i + 1,
      monitorId: p.monitorId,
      name: p.name,
      restroom: roomView(roomMap, p.restroomId),
      completed: p.completed,
      required: p.required,
      cp: p.cp,
      a: p.a,
      s: p.s,
      q: p.q,
      classification: p.classification,
      classificationLabel: p.classification ? CLASSIFICATION_LABEL[p.classification] : null,
      approved: approvals.has(p.monitorId),
    }))
    .filter((r) => filterRow(r.monitorId));
  return { period: q.period, range: { from: q.range.from, to: q.range.to }, candidates, rows };
}

/** اعتماد/إلغاء اعتماد المكافأة — الاعتماد فقط لمرشح فعلي في الفترة المختارة */
export async function setBonusApproval(user: SessionUser, monitorId: string, period: Period, approve: boolean, now: Date, today: string) {
  if (!/^[0-9a-f-]{36}$/i.test(monitorId)) throw new ApiError(404, 'not_found', 'الموظف غير موجود.');
  const range = periodRange(period, today);
  const svc = createServiceClient();
  const { data: monitor } = await svc.from('users').select('id, full_name, role, monitor_kind').eq('id', monitorId).maybeSingle();
  if (!monitor || monitor.role !== 'contractor_monitor' || monitor.monitor_kind !== 'primary') throw new ApiError(404, 'not_found', 'الموظف غير موجود.');

  if (approve) {
    const { all } = await performance({ period, range, today });
    const isCandidate = bonusCandidates(all).some((p) => p.monitorId === monitorId);
    if (!isCandidate) throw new ApiError(409, 'not_candidate', 'الموظف ليس ضمن المرشحين للمكافأة في هذه الفترة.');
    const { error } = await svc.from('bonus_approvals').insert({
      monitor_id: monitorId,
      period_type: period,
      period_start: range.from,
      period_end: range.to,
      approved_by: user.id,
      approved_at: now.toISOString(),
    });
    if (error && !error.message.includes('bonus_approvals_one_active')) throw new Error(error.message);
    await audit(user.id, 'bonus.approve', 'bonus_approvals', monitorId, { period, from: range.from, to: range.to });
    return { approved: true, message: `اعتُمدت مكافأة ${monitor.full_name}` };
  }
  const { error } = await svc
    .from('bonus_approvals')
    .update({ revoked_at: now.toISOString() })
    .eq('monitor_id', monitorId)
    .eq('period_type', period)
    .eq('period_start', range.from)
    .eq('period_end', range.to)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
  await audit(user.id, 'bonus.revoke', 'bonus_approvals', monitorId, { period, from: range.from, to: range.to });
  return { approved: false, message: `أُلغي اعتماد مكافأة ${monitor.full_name}` };
}
