/**
 * حساب المؤشرات من سجلات قاعدة البيانات (دوال نقية قابلة للاختبار).
 * - الجولة pending أو المسودة لا تُحتسب مكتملة ولا ملتزمة ولا تدخل متوسط الجودة.
 * - الجولة تدخل نسبة الالتزام فقط عندما تكون مُرسلة أو «فائتة» (درجة 0).
 * - قواعد الالتزام لا تُطبَّق على تقييمات المشرفين.
 */
import { FEEDBACK_MAX_WEIGHT, FEEDBACK_WEIGHT } from './catalog';
import { SHIFT_PLAN, isPendingLate, type ComplianceLevel, type RoundStatus, type Shift } from './schedule';
import { riyadhToInstant } from './time';

export interface MetricRound {
  id: string;
  restroom_id: string;
  round_date: string;
  shift: Shift;
  status: RoundStatus;
  compliance_level: ComplianceLevel | null;
  compliance_score: number | null;
  quality_score: number | null;
  assigned_monitor_id: string;
  executed_by_id: string | null;
  on_behalf_of_id: string | null;
  submitted_at: string | null;
}

export interface MetricEvaluation {
  id: string;
  restroom_id: string;
  supervisor_id: string;
  submitted_at: string;
  score: number | null;
  /** إجابة «هل جولة المراقب المسجلة مطابقة للواقع؟» */
  matches_round?: 'yes' | 'no' | null;
}

export interface FeedbackCount {
  restroom_id: string;
  rating: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return round2(nums.reduce((s, v) => s + v, 0) / nums.length);
}

export function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return round2((part * 100) / whole);
}

export const isDue = (r: MetricRound) => r.status === 'submitted' || r.status === 'missed';

export interface RoundCounts {
  required: number;
  completed: number;
  late: number;
  missed: number;
  completedPct: number | null;
  latePct: number | null;
  missedPct: number | null;
}

/**
 * المطلوبة = كل سجلات الجولات في الفترة، المكتملة = submitted،
 * المتأخرة = submitted بمستوى behind أو non + pending لليوم بعد «ملتزم تمامًا حتى»، الفائتة = missed.
 */
export function roundCounts(rounds: MetricRound[], today: string, minuteOfDay: number): RoundCounts {
  const required = rounds.length;
  const completed = rounds.filter((r) => r.status === 'submitted').length;
  const late = rounds.filter(
    (r) =>
      (r.status === 'submitted' && (r.compliance_level === 'behind' || r.compliance_level === 'non')) ||
      isPendingLate(r, today, minuteOfDay),
  ).length;
  const missed = rounds.filter((r) => r.status === 'missed').length;
  return {
    required,
    completed,
    late,
    missed,
    completedPct: percent(completed, required),
    latePct: percent(late, required),
    missedPct: percent(missed, required),
  };
}

/** متوسط نتيجة جولات مراقبي المقاول = متوسط quality_score للجولات المكتملة */
export function contractorAverage(rounds: MetricRound[]): number | null {
  return average(rounds.filter((r) => r.status === 'submitted').map((r) => r.quality_score));
}

/** متوسط التقييم العام للمشرفين الميدانيين */
export function supervisorAverage(evaluations: MetricEvaluation[]): number | null {
  return average(evaluations.map((e) => e.score));
}

export interface FeedbackStats {
  total: number;
  excellent: number;
  good: number;
  bad: number;
  satisfaction: number | null;
}

/**
 * مؤشر رضا المستفيدين بالأوزان: ممتاز 60، جيد 30، سيئ 10،
 * والنسبة على أساس أعلى وزن: مجموع الأوزان ÷ (عدد التقييمات × 60) × 100.
 */
export function satisfactionIndex(excellent: number, good: number, bad: number): number | null {
  const total = excellent + good + bad;
  const points = excellent * FEEDBACK_WEIGHT.excellent + good * FEEDBACK_WEIGHT.good + bad * FEEDBACK_WEIGHT.bad;
  return percent(points, total * FEEDBACK_MAX_WEIGHT);
}

export function feedbackStats(counts: FeedbackCount[]): FeedbackStats {
  const sum = (rating: number) => counts.filter((c) => c.rating === rating).reduce((s, c) => s + c.total, 0);
  const excellent = sum(5);
  const good = sum(4);
  const bad = sum(1);
  const total = excellent + good + bad;
  return { total, excellent, good, bad, satisfaction: satisfactionIndex(excellent, good, bad) };
}

export interface ComplianceRates {
  am: number | null;
  pm: number | null;
  overall: number | null;
}

/** نسبة التزام الجولات = متوسط compliance_score للجولات المستحقة (submitted + missed) */
export function complianceRates(rounds: MetricRound[]): ComplianceRates {
  const due = rounds.filter(isDue);
  return {
    am: average(due.filter((r) => r.shift === 'am').map((r) => r.compliance_score)),
    pm: average(due.filter((r) => r.shift === 'pm').map((r) => r.compliance_score)),
    overall: average(due.map((r) => r.compliance_score)),
  };
}

export interface RestroomRef {
  id: string;
  code: string;
  name: string;
  floor_label: string;
  building_id: string;
  building_name: string;
}

export interface ComparisonPoint {
  restroomId: string;
  code: string;
  name: string;
  floor: string;
  building: string;
  contractor: number | null;
  supervisor: number | null;
  satisfaction: number | null;
}

/** مقارنة الأداء العام لكل دورة مياه: متوسط جودة جولات المراقب ومتوسط تقييم المشرف (ورضا المستفيدين) */
export function comparisonSeries(
  restrooms: RestroomRef[],
  rounds: MetricRound[],
  evaluations: MetricEvaluation[],
  feedback: FeedbackCount[],
): ComparisonPoint[] {
  return restrooms.map((rr) => ({
    restroomId: rr.id,
    code: rr.code,
    name: rr.name,
    floor: rr.floor_label,
    building: rr.building_name,
    contractor: contractorAverage(rounds.filter((r) => r.restroom_id === rr.id)),
    supervisor: supervisorAverage(evaluations.filter((e) => e.restroom_id === rr.id)),
    satisfaction: feedbackStats(feedback.filter((f) => f.restroom_id === rr.id)).satisfaction,
  }));
}

// ---------------------------------------------------------------------
// أداء المراقبين الأساسيين والمكافآت
// ---------------------------------------------------------------------
export type Classification = 'excellent' | 'regular' | 'needs_follow_up';

/** [قرار مطلوب] عتبات التصنيف */
export const CLASSIFICATION_THRESHOLDS = {
  excellent: { cp: 90, q: 85 },
  regular: { cp: 75, q: 70 },
} as const;

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  excellent: 'متميز',
  regular: 'منتظم',
  needs_follow_up: 'يحتاج متابعة',
};

export function classify(cp: number | null, q: number | null): Classification | null {
  if (cp === null || q === null) return null;
  if (cp >= CLASSIFICATION_THRESHOLDS.excellent.cp && q >= CLASSIFICATION_THRESHOLDS.excellent.q) return 'excellent';
  if (cp >= CLASSIFICATION_THRESHOLDS.regular.cp && q >= CLASSIFICATION_THRESHOLDS.regular.q) return 'regular';
  return 'needs_follow_up';
}

export interface MonitorRef {
  id: string;
  full_name: string;
  /** دورات المياه المسند إليه (المراقب الأساسي قد يكون مسؤولًا عن مبنى كامل) */
  restroom_ids: string[];
}

export interface MonitorPerformance {
  monitorId: string;
  name: string;
  restroomIds: string[];
  /** متوسط درجة الالتزام للجولات المستحقة */
  cp: number | null;
  /** متوسط جودة جولاته المكتملة */
  a: number | null;
  /** متوسط تقييم المشرف لنفس المواقع (عدا التقييمات التي أجاب فيها المشرف بعدم مطابقة جولة المراقب للواقع) */
  s: number | null;
  /** الجودة = متوسط المتاح من (a, s) — أو a فقط عند فلتر «تقييم المقاول» */
  q: number | null;
  completed: number;
  required: number;
  classification: Classification | null;
}

export type PerformanceMode = 'all' | 'contractor';

export function monitorPerformance(
  monitors: MonitorRef[],
  rounds: MetricRound[],
  evaluations: MetricEvaluation[],
  mode: PerformanceMode = 'all',
): MonitorPerformance[] {
  return monitors.map((m) => {
    const mine = rounds.filter((r) => r.assigned_monitor_id === m.id);
    const cp = average(mine.filter(isDue).map((r) => r.compliance_score));
    const a = contractorAverage(mine);
    const rooms = new Set(m.restroom_ids);
    // تقييم المشرف للمتميزين: فقط ما أجاب فيه المشرف بأن جولة المراقب مطابقة للواقع
    // («غير مطابقة» لا تدخل ولا تخفض التقييم)
    const s = supervisorAverage(evaluations.filter((e) => rooms.has(e.restroom_id) && e.matches_round !== 'no'));
    const q = mode === 'contractor' ? a : average([a, s]);
    return {
      monitorId: m.id,
      name: m.full_name,
      restroomIds: m.restroom_ids,
      cp,
      a,
      s,
      q,
      completed: mine.filter((r) => r.status === 'submitted').length,
      required: mine.length,
      classification: classify(cp, q),
    };
  });
}

/** الترتيب حسب (cp + q) تنازليًا، والقيم غير المتاحة في الأسفل */
export function rankByTotal(perf: MonitorPerformance[]): MonitorPerformance[] {
  const key = (p: MonitorPerformance) => (p.cp === null && p.q === null ? -1 : (p.cp ?? 0) + (p.q ?? 0));
  return [...perf].sort((x, y) => key(y) - key(x) || x.name.localeCompare(y.name, 'ar'));
}

/** أعلى المراقبين حسب الجودة q */
export function topByQuality(perf: MonitorPerformance[], n: number): MonitorPerformance[] {
  return [...perf]
    .filter((p) => p.q !== null)
    .sort((x, y) => (y.q ?? 0) - (x.q ?? 0) || (y.cp ?? 0) - (x.cp ?? 0) || x.name.localeCompare(y.name, 'ar'))
    .slice(0, n);
}

export const BONUS_TOP_N = 3;

/**
 * المرشحون للمكافأة: أعلى 3 حسب (الالتزام cp + تقييم المشرف s)، وتقييم المشرف يشمل فقط التقييمات
 * التي أجاب فيها المشرف بأن جولة المراقب مطابقة للواقع. يلزم توفر القيمتين.
 */
export function bonusCandidates(perf: MonitorPerformance[]): MonitorPerformance[] {
  return perf
    .filter((p) => p.cp !== null && p.s !== null)
    .sort((x, y) => (y.cp! + y.s!) - (x.cp! + x.s!) || (y.cp! - x.cp!) || x.name.localeCompare(y.name, 'ar'))
    .slice(0, BONUS_TOP_N);
}

// ---------------------------------------------------------------------
// أحدث الجولات
// ---------------------------------------------------------------------
export interface RecentEntry {
  kind: 'round' | 'supervisor';
  id: string;
  at: string;
}

/** وقت ترتيب الجولة: الإرسال، أو آخر موعد إن كانت فائتة */
export function roundEventTime(r: MetricRound): string | null {
  if (r.status === 'submitted' && r.submitted_at) return r.submitted_at;
  if (r.status === 'missed') return riyadhToInstant(r.round_date, SHIFT_PLAN[r.shift].deadline).toISOString();
  return null;
}

/** أحدث العناصر: جولات مرسلة/فائتة + تقييمات المشرفين (تُستبعد pending) */
export function recentEntries(
  rounds: MetricRound[],
  evaluations: MetricEvaluation[],
  limit: number,
): RecentEntry[] {
  const items: RecentEntry[] = [];
  for (const r of rounds) {
    const at = roundEventTime(r);
    if (at) items.push({ kind: 'round', id: r.id, at });
  }
  for (const e of evaluations) items.push({ kind: 'supervisor', id: e.id, at: e.submitted_at });
  items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return items.slice(0, limit);
}
