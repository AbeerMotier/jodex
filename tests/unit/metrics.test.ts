import { describe, expect, it } from 'vitest';
import {
  bonusCandidates,
  classify,
  complianceRates,
  contractorAverage,
  feedbackStats,
  monitorPerformance,
  rankByTotal,
  recentEntries,
  roundCounts,
  supervisorAverage,
  topByQuality,
  type MetricEvaluation,
  type MetricRound,
} from '@/lib/domain/metrics';
import { periodRange } from '@/lib/domain/time';

let seq = 0;
const round = (p: Partial<MetricRound>): MetricRound => ({
  id: `r${++seq}`,
  restroom_id: 'A',
  round_date: '2026-10-15',
  shift: 'am',
  status: 'pending',
  compliance_level: null,
  compliance_score: null,
  quality_score: null,
  assigned_monitor_id: 'm1',
  executed_by_id: null,
  on_behalf_of_id: null,
  submitted_at: null,
  ...p,
});
const submitted = (p: Partial<MetricRound>) =>
  round({ status: 'submitted', compliance_level: 'full', compliance_score: 100, quality_score: 90, executed_by_id: 'm1', submitted_at: '2026-10-15T06:00:00.000Z', ...p });
const missed = (p: Partial<MetricRound>) => round({ status: 'missed', compliance_score: 0, ...p });

describe('الفترات', () => {
  it('اليوم/أسبوع/شهر شاملة اليوم', () => {
    expect(periodRange('today', '2026-10-15')).toMatchObject({ from: '2026-10-15', to: '2026-10-15' });
    expect(periodRange('week', '2026-10-15')).toMatchObject({ from: '2026-10-09', to: '2026-10-15' });
    expect(periodRange('month', '2026-10-15')).toMatchObject({ from: '2026-09-16', to: '2026-10-15' });
    expect(periodRange('today', '2026-10-15').fromInstant.toISOString()).toBe('2026-10-14T21:00:00.000Z');
    expect(periodRange('today', '2026-10-15').toInstantExclusive.toISOString()).toBe('2026-10-15T21:00:00.000Z');
  });
});

describe('الجولة pending أو المسودة لا تُحسب مكتملة ولا ملتزمة ولا تدخل متوسط الجودة', () => {
  const rounds = [
    submitted({ quality_score: 80, compliance_score: 100 }),
    round({ shift: 'pm' }), // pending (حتى لو لها مسودة)
  ];
  it('المكتملة = submitted فقط', () => {
    expect(roundCounts(rounds, '2026-10-15', 9 * 60).completed).toBe(1);
  });
  it('متوسط الجودة يتجاهل pending', () => {
    expect(contractorAverage(rounds)).toBe(80);
  });
  it('نسبة الالتزام تتجاهل pending', () => {
    expect(complianceRates(rounds)).toEqual({ am: 100, pm: null, overall: 100 });
  });
  it('الفائتة تدخل نسبة الالتزام بدرجة 0', () => {
    const rates = complianceRates([...rounds, missed({ shift: 'pm', round_date: '2026-10-14' })]);
    expect(rates).toEqual({ am: 100, pm: 0, overall: 50 });
  });
});

describe('عدادات الجولات', () => {
  it('المتأخرة = submitted behind/non + pending اليوم بعد «ملتزم تمامًا حتى»', () => {
    const rounds = [
      submitted({ compliance_level: 'behind', compliance_score: 75 }),
      submitted({ compliance_level: 'non', compliance_score: 30, shift: 'pm', round_date: '2026-10-14' }),
      submitted({ compliance_level: 'full', round_date: '2026-10-14' }),
      round({ restroom_id: 'B' }), // pending صباحية اليوم
      missed({ restroom_id: 'C', round_date: '2026-10-13' }),
    ];
    const at1000 = roundCounts(rounds, '2026-10-15', 10 * 60);
    expect(at1000).toMatchObject({ required: 5, completed: 3, late: 3, missed: 1 });
    expect(at1000.completedPct).toBe(60);
    const at0900 = roundCounts(rounds, '2026-10-15', 9 * 60);
    expect(at0900.late).toBe(2);
  });
  it('لا جولات ← النسب «—»', () => {
    expect(roundCounts([], '2026-10-15', 600)).toMatchObject({ required: 0, completedPct: null });
  });
});

describe('رضا المستفيدين والمشرفين', () => {
  it('الرضا = (ممتاز + جيد) ÷ الكل', () => {
    const s = feedbackStats([
      { restroom_id: 'A', rating: 5, total: 6 },
      { restroom_id: 'A', rating: 4, total: 2 },
      { restroom_id: 'B', rating: 1, total: 2 },
    ]);
    expect(s).toEqual({ total: 10, excellent: 6, good: 2, bad: 2, satisfaction: 80 });
  });
  it('متوسط المشرف', () => {
    const ev: MetricEvaluation[] = [
      { id: 'e1', restroom_id: 'A', supervisor_id: 's', submitted_at: '2026-10-15T07:00:00Z', score: 80 },
      { id: 'e2', restroom_id: 'A', supervisor_id: 's', submitted_at: '2026-10-15T08:00:00Z', score: 90 },
    ];
    expect(supervisorAverage(ev)).toBe(85);
  });
});

describe('أداء المراقبين والمكافآت', () => {
  const monitors = [
    // m1 مسؤول عن دورتين (A و E): تقييم المشرف = متوسط تقييمات الدورتين
    { id: 'm1', full_name: 'خالد', restroom_ids: ['A', 'E'] },
    { id: 'm2', full_name: 'نورة', restroom_ids: ['B'] },
    { id: 'm3', full_name: 'فهد', restroom_ids: ['C'] },
    { id: 'm4', full_name: 'سعيد', restroom_ids: ['D'] },
  ];
  const rounds = [
    submitted({ assigned_monitor_id: 'm1', restroom_id: 'A', quality_score: 96, compliance_score: 100 }),
    submitted({ assigned_monitor_id: 'm1', restroom_id: 'A', shift: 'pm', quality_score: 94, compliance_score: 95 }),
    submitted({ assigned_monitor_id: 'm2', restroom_id: 'B', quality_score: 88, compliance_score: 92 }),
    missed({ assigned_monitor_id: 'm2', restroom_id: 'B', shift: 'pm' }),
    submitted({ assigned_monitor_id: 'm3', restroom_id: 'C', quality_score: 90, compliance_score: 92 }),
    round({ assigned_monitor_id: 'm3', restroom_id: 'C', shift: 'pm' }),
  ];
  const evals: MetricEvaluation[] = [
    { id: 'e1', restroom_id: 'A', supervisor_id: 's', submitted_at: '2026-10-15T07:00:00Z', score: 90 },
    { id: 'e2', restroom_id: 'C', supervisor_id: 's', submitted_at: '2026-10-15T07:00:00Z', score: 80 },
    { id: 'e3', restroom_id: 'E', supervisor_id: 's', submitted_at: '2026-10-15T08:00:00Z', score: 100 },
  ];
  const perf = monitorPerformance(monitors, rounds, evals);

  it('cp و a و s و q', () => {
    const m1 = perf.find((p) => p.monitorId === 'm1')!;
    expect(m1).toMatchObject({ cp: 97.5, a: 95, s: 95, q: 95, completed: 2, required: 2, classification: 'excellent' });
    const m2 = perf.find((p) => p.monitorId === 'm2')!;
    expect(m2).toMatchObject({ cp: 46, a: 88, s: null, q: 88, classification: 'needs_follow_up' });
    const m3 = perf.find((p) => p.monitorId === 'm3')!;
    expect(m3).toMatchObject({ cp: 92, a: 90, s: 80, q: 85, completed: 1, required: 2, classification: 'excellent' });
    const m4 = perf.find((p) => p.monitorId === 'm4')!;
    expect(m4).toMatchObject({ cp: null, q: null, classification: null });
  });
  it('وضع «تقييم المقاول» يستخدم a فقط', () => {
    const m3 = monitorPerformance(monitors, rounds, evals, 'contractor').find((p) => p.monitorId === 'm3')!;
    expect(m3.q).toBe(90);
  });
  it('التصنيف حسب العتبات', () => {
    expect(classify(90, 85)).toBe('excellent');
    expect(classify(89.99, 95)).toBe('regular');
    expect(classify(75, 70)).toBe('regular');
    expect(classify(74, 99)).toBe('needs_follow_up');
  });
  it('المرشحون للمكافأة: cp ≥ 90 و q ≥ 85 مرتبون بـ cp+q، أعلى 3', () => {
    expect(bonusCandidates(perf).map((p) => p.monitorId)).toEqual(['m1', 'm3']);
  });
  it('لا مرشحين', () => {
    expect(bonusCandidates([])).toEqual([]);
  });
  it('الترتيب حسب cp + q والقيم غير المتاحة في الأسفل', () => {
    expect(rankByTotal(perf).map((p) => p.monitorId)).toEqual(['m1', 'm3', 'm2', 'm4']);
  });
  it('أعلى 4 حسب الجودة', () => {
    expect(topByQuality(perf, 4).map((p) => p.monitorId)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('أحدث الجولات', () => {
  it('تُستبعد pending، وتُرتب من الأحدث', () => {
    const rounds = [
      submitted({ id: 'x1', submitted_at: '2026-10-15T06:10:00.000Z' }),
      round({ id: 'x2', shift: 'pm' }),
      missed({ id: 'x3', round_date: '2026-10-14', shift: 'pm' }),
    ];
    const evals: MetricEvaluation[] = [
      { id: 'e9', restroom_id: 'A', supervisor_id: 's', submitted_at: '2026-10-15T09:00:00.000Z', score: 70 },
    ];
    expect(recentEntries(rounds, evals, 4).map((e) => e.id)).toEqual(['e9', 'x1', 'x3']);
  });
});
