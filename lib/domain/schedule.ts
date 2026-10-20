/**
 * الخطة الزمنية لجولات مراقب المقاول (لا تُطبَّق إطلاقًا على تقييمات المشرفين الميدانيين).
 * نافذة الجولة: الصباحية 07:30–10:00 والمسائية 12:00–14:30، ولا يُسمح ببدء الجولة أو إرسالها خارجها.
 * دقة المقارنة: الدقيقة بتوقيت الرياض (الدقيقة 07:30 كاملة مفتوحة، والدقيقة 10:00 كاملة مسموحة).
 */
import { minutesToHHMM } from './time';

export type Shift = 'am' | 'pm';
export const SHIFTS: Shift[] = ['am', 'pm'];

export interface ShiftPlan {
  /** بداية النافذة (لا يُسمح بالبدء قبلها) */
  start: number;
  /** ملتزم تمامًا حتى (شامل) */
  fullUntil: number;
  /** عدم التزام واضح من (شامل) */
  nonFrom: number;
  /** نهاية النافذة = آخر موعد للإنهاء (شامل) */
  deadline: number;
}

const hm = (h: number, m: number) => h * 60 + m;

/**
 * حدود «ملتزم تمامًا حتى» و«عدم التزام من» بقيت كما كانت حيث تقع داخل النافذة الجديدة:
 * الصباحية ملتزم حتى 09:30 ثم متأخر حتى 10:00، والمسائية ملتزم طوال نافذتها (حدها السابق 14:30 = نهايتها).
 */
export const SHIFT_PLAN: Record<Shift, ShiftPlan> = {
  am: { start: hm(7, 30), fullUntil: hm(9, 30), nonFrom: hm(10, 0), deadline: hm(10, 0) },
  pm: { start: hm(12, 0), fullUntil: hm(14, 30), nonFrom: hm(15, 0), deadline: hm(14, 30) },
};

export type WindowState = 'before' | 'open' | 'closed';

/** حالة نافذة الجولة في الدقيقة minuteOfDay بتوقيت الرياض */
export function shiftWindowState(shift: Shift, minuteOfDay: number): WindowState {
  const p = SHIFT_PLAN[shift];
  if (minuteOfDay < p.start) return 'before';
  if (minuteOfDay > p.deadline) return 'closed';
  return 'open';
}

export function windowText(shift: Shift): string {
  return `${minutesToHHMM(SHIFT_PLAN[shift].start)}–${minutesToHHMM(SHIFT_PLAN[shift].deadline)}`;
}

/** [قرار مطلوب] منحنى الدرجة: متأخر 100→50 خطيًا، غير ملتزم 50→20 خطيًا */
export const COMPLIANCE_CURVE = {
  behindFrom: 100,
  behindTo: 50,
  nonFrom: 50,
  nonTo: 20,
} as const;

export type ComplianceLevel = 'full' | 'behind' | 'non';

export type ComplianceResult =
  | { ok: true; level: ComplianceLevel; score: number }
  | { ok: false; reason: 'deadline_passed'; deadline: string }
  | { ok: false; reason: 'not_open'; start: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * درجة الالتزام عند الإرسال في الدقيقة minuteOfDay.
 * الإرسال مسموح داخل نافذة الجولة فقط: قبل بدايتها أو بعد نهايتها مرفوض.
 */
export function computeCompliance(shift: Shift, minuteOfDay: number): ComplianceResult {
  const p = SHIFT_PLAN[shift];
  if (minuteOfDay < p.start) return { ok: false, reason: 'not_open', start: minutesToHHMM(p.start) };
  if (minuteOfDay > p.deadline) return { ok: false, reason: 'deadline_passed', deadline: minutesToHHMM(p.deadline) };
  if (minuteOfDay <= p.fullUntil) return { ok: true, level: 'full', score: 100 };
  if (minuteOfDay < p.nonFrom) {
    const frac = (minuteOfDay - p.fullUntil) / (p.nonFrom - p.fullUntil);
    const score = COMPLIANCE_CURVE.behindFrom - (COMPLIANCE_CURVE.behindFrom - COMPLIANCE_CURVE.behindTo) * frac;
    return { ok: true, level: 'behind', score: round2(score) };
  }
  // عندما تنتهي النافذة عند بداية «عدم الالتزام» (الصباحية 10:00) تكون الدقيقة الأخيرة بداية المنحنى
  const frac = p.deadline > p.nonFrom ? (minuteOfDay - p.nonFrom) / (p.deadline - p.nonFrom) : 0;
  const score = COMPLIANCE_CURVE.nonFrom - (COMPLIANCE_CURVE.nonFrom - COMPLIANCE_CURVE.nonTo) * frac;
  return { ok: true, level: 'non', score: round2(score) };
}

export type PendingState = 'not_started' | 'in_progress' | 'late' | 'missed';

/** حالة جولة غير مرسلة حسب اليوم والدقيقة الحالية بتوقيت الرياض */
export function pendingState(shift: Shift, roundDate: string, today: string, minuteOfDay: number): PendingState {
  if (roundDate < today) return 'missed';
  if (roundDate > today) return 'not_started';
  const p = SHIFT_PLAN[shift];
  if (minuteOfDay < p.start) return 'not_started';
  if (minuteOfDay <= p.fullUntil) return 'in_progress';
  if (minuteOfDay <= p.deadline) return 'late';
  return 'missed';
}

export type RoundStatus = 'pending' | 'submitted' | 'missed';

export interface RoundLike {
  shift: Shift;
  round_date: string;
  status: RoundStatus;
  compliance_level: ComplianceLevel | null;
}

/** حالة العرض الموحّدة لأي جولة */
export type RoundDisplayStatus = ComplianceLevel | 'missed' | 'not_started' | 'in_progress' | 'late';

export function roundDisplayStatus(round: RoundLike, today: string, minuteOfDay: number): RoundDisplayStatus {
  if (round.status === 'submitted') return round.compliance_level ?? 'full';
  if (round.status === 'missed') return 'missed';
  return pendingState(round.shift, round.round_date, today, minuteOfDay);
}

/** هل الجولة pending متأخرة الآن (بعد «ملتزم تمامًا حتى» ولم يتجاوز آخر موعد) */
export function isPendingLate(round: RoundLike, today: string, minuteOfDay: number): boolean {
  return round.status === 'pending' && pendingState(round.shift, round.round_date, today, minuteOfDay) === 'late';
}

/** شارة الالتزام في رأس صفحة المراقب = أسوأ حالة بين جولتي اليوم */
export type BadgeState = 'full' | 'on_time' | 'behind' | 'non';
const BADGE_ORDER: Record<BadgeState, number> = { full: 0, on_time: 1, behind: 2, non: 3 };

export function roundBadgeState(round: RoundLike, today: string, minuteOfDay: number): BadgeState {
  const s = roundDisplayStatus(round, today, minuteOfDay);
  switch (s) {
    case 'full':
      return 'full';
    case 'behind':
    case 'late':
      return 'behind';
    case 'non':
    case 'missed':
      return 'non';
    default:
      return 'on_time';
  }
}

export function worstBadge(states: BadgeState[]): BadgeState {
  return states.reduce<BadgeState>((worst, s) => (BADGE_ORDER[s] > BADGE_ORDER[worst] ? s : worst), 'full');
}

/** حد اختيار الجولة المعروضة افتراضيًا = بداية نافذة الجولة المسائية */
export const DEFAULT_SHIFT_SWITCH_MINUTE = SHIFT_PLAN.pm.start;

/**
 * الجولة المعروضة افتراضيًا: الصباحية قبل 12:00 والمسائية بعدها، وإن كانت مُرسلة تُعرض الأخرى.
 * (امتداد موثّق: إن كانت فائتة والأخرى ما زالت مفتوحة تُعرض الأخرى أيضًا.)
 */
export function defaultShift(minuteOfDay: number, rounds: { shift: Shift; status: RoundStatus }[]): Shift {
  const preferred: Shift = minuteOfDay < DEFAULT_SHIFT_SWITCH_MINUTE ? 'am' : 'pm';
  const other: Shift = preferred === 'am' ? 'pm' : 'am';
  const pref = rounds.find((r) => r.shift === preferred);
  const alt = rounds.find((r) => r.shift === other);
  if (!pref || !alt) return preferred;
  if (pref.status === 'submitted') return other;
  if (pref.status === 'missed' && alt.status === 'pending') return other;
  return preferred;
}
