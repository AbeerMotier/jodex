import 'server-only';
import { FEEDBACK_MAX_WEIGHT, FEEDBACK_WEIGHT, SATISFACTION_FORMULA, SOURCE_LABEL, type Source } from '@/lib/domain/catalog';
import { instantDate } from '@/lib/domain/format';
import {
  comparisonSeries,
  complianceRates,
  contractorAverage,
  feedbackStats,
  monitorPerformance,
  recentEntries,
  roundCounts,
  supervisorAverage,
  topByQuality,
} from '@/lib/domain/metrics';
import { riyadhMinuteOfDay, riyadhParts } from '@/lib/domain/time';
import type { SessionUser } from '../auth';
import { namesById } from '../people';
import { syncRounds } from '../rounds-maintenance';
import { createServiceClient, createUserClient } from '../supabase';
import {
  loadFeedbackSummary,
  loadPeriodEvaluations,
  loadPeriodRounds,
  loadPrimaryMonitors,
  loadRestroomRefs,
  PERIOD_TEXT,
  inScope,
  restroomScope,
  type CommonQuery,
} from './common';
import { areaView, evaluationEntry, roomView, roundEntry } from './presenters';

const RECENT_LIMIT = 4;
const TOP_PERFORMERS = 4;

export type ComparisonSeriesKey = 'contractor' | 'supervisor' | 'beneficiary';

export async function buildDashboard(user: SessionUser, q: CommonQuery, source: Source, now: Date) {
  await syncRounds(now);
  const client = await createUserClient();
  const minute = riyadhMinuteOfDay(now);
  const rooms = await loadRestroomRefs(client);
  const scope = restroomScope(rooms, q);
  const [rounds, evaluations, feedback, monitors] = await Promise.all([
    loadPeriodRounds(client, q.range, scope),
    loadPeriodEvaluations(client, q.range, scope),
    loadFeedbackSummary(client, q.range, scope),
    loadPrimaryMonitors(client),
  ]);
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const scopedRooms = scope ? rooms.filter((r) => scope.has(r.id)) : rooms;
  const scopedMonitors = monitors.filter((m) => inScope(scope, m.restroom_ids));

  const showContractor = source === 'all' || source === 'contractor';
  const showSupervisor = source === 'all' || source === 'supervisor';
  const showBeneficiary = source === 'all' || source === 'beneficiary';

  const fb = feedbackStats(feedback);
  const counts = roundCounts(rounds, q.today, minute);
  const completed = rounds.filter((r) => r.status === 'submitted');

  // إجمالي التقييمات حسب نوع التقييم (لا خلط بين الأنواع)
  const total =
    source === 'all'
      ? { label: 'إجمالي التقييمات', value: evaluations.length + fb.total, sub: `${PERIOD_TEXT[q.period]} · المشرفون والمستفيدون` }
      : source === 'contractor'
        ? { label: 'تقييمات المقاول', value: completed.length, sub: `${PERIOD_TEXT[q.period]} · جولات مكتملة` }
        : source === 'supervisor'
          ? { label: 'تقييمات المشرفين', value: evaluations.length, sub: PERIOD_TEXT[q.period] }
          : { label: 'تقييمات المستفيدين', value: fb.total, sub: PERIOD_TEXT[q.period] };

  const compliance = complianceRates(rounds);
  const quality = {
    contractor: showContractor ? { value: contractorAverage(rounds), sub: `${completed.length} جولة مكتملة` } : null,
    supervisor: showSupervisor ? { value: supervisorAverage(evaluations), sub: `${evaluations.length} تقييم` } : null,
    beneficiary: showBeneficiary
      ? {
          value: fb.satisfaction,
          sub: `${fb.total} تقييم · ممتاز ${FEEDBACK_WEIGHT.excellent} · جيد ${FEEDBACK_WEIGHT.good} · سيئ ${FEEDBACK_WEIGHT.bad}`,
          counts: { excellent: fb.excellent, good: fb.good, bad: fb.bad, total: fb.total },
          weights: FEEDBACK_WEIGHT,
          maxWeight: FEEDBACK_MAX_WEIGHT,
          formula: SATISFACTION_FORMULA,
        }
      : null,
    compliance: showContractor ? compliance : null,
  };

  const comparison = comparisonSeries(scopedRooms, rounds, evaluations, feedback).map((p) => ({
    ...p,
    contractor: showContractor ? p.contractor : null,
    supervisor: showSupervisor ? p.supervisor : null,
    satisfaction: source === 'beneficiary' ? p.satisfaction : null,
  }));
  const series: ComparisonSeriesKey[] =
    source === 'all' ? ['contractor', 'supervisor'] : source === 'contractor' ? ['contractor'] : source === 'supervisor' ? ['supervisor'] : ['beneficiary'];

  // أحدث الجولات: 4 عناصر فقط (تُستبعد pending)
  let recent: { title: string; kind: 'entries' | 'feedback'; items: unknown[] };
  if (source === 'beneficiary') {
    const svc = createServiceClient();
    let fq = svc
      .from('beneficiary_feedback')
      .select('id, restroom_id, rating, submitted_at')
      .gte('submitted_at', q.range.fromInstant.toISOString())
      .lt('submitted_at', q.range.toInstantExclusive.toISOString())
      .order('submitted_at', { ascending: false })
      .limit(RECENT_LIMIT);
    if (scope) fq = fq.in('restroom_id', [...scope]);
    const { data } = await fq;
    recent = {
      title: 'أحدث تقييمات المستفيدين',
      kind: 'feedback',
      items: (data ?? []).map((f) => ({ id: f.id, rating: f.rating, submittedAt: f.submitted_at, restroom: roomView(roomMap, f.restroom_id) })),
    };
  } else {
    const entries = recentEntries(showContractor ? rounds : [], showSupervisor ? evaluations : [], RECENT_LIMIT);
    const names = await namesById([
      ...rounds.flatMap((r) => [r.executed_by_id, r.assigned_monitor_id, r.on_behalf_of_id]),
      ...evaluations.map((e) => e.supervisor_id),
    ]);
    recent = {
      title: source === 'supervisor' ? 'أحدث تقييمات المشرفين' : 'أحدث الجولات',
      kind: 'entries',
      items: entries.map((e) =>
        e.kind === 'round'
          ? roundEntry(rounds.find((r) => r.id === e.id)!, roomMap, names, q.today, minute)
          : evaluationEntry(evaluations.find((v) => v.id === e.id)!, roomMap, names, instantDate),
      ),
    };
  }

  const performance = showContractor
    ? topByQuality(monitorPerformance(scopedMonitors, rounds, evaluations, source === 'contractor' ? 'contractor' : 'all'), TOP_PERFORMERS).map((p) => ({
        ...p,
        restroom: areaView(roomMap, scope ? p.restroomIds.filter((id) => scope.has(id)) : p.restroomIds),
      }))
    : null;

  const hour = riyadhParts(now).hour;
  return {
    serverNow: now.toISOString(),
    today: q.today,
    period: q.period,
    periodLabel: PERIOD_TEXT[q.period],
    source,
    sourceLabel: SOURCE_LABEL[source],
    greeting: hour < 12 ? 'صباح الخير' : 'مساء الخير',
    adminName: user.fullName,
    total,
    rounds: showContractor ? counts : null,
    quality,
    comparison: { series, points: comparison },
    recent,
    performance,
  };
}
