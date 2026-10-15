/**
 * معادلات الدرجات.
 * جودة جولة المراقب = Σ وزن البند × معامل الإجابة (تم=1، جزئي=نسبة الجزئي÷100، لم يتم=0)
 * درجة تقييم المشرف = Σ (التقييم ÷ 5) × وزن البند
 */
export type Answer = 'done' | 'partial' | 'not_done';
export const ANSWERS: Answer[] = ['done', 'partial', 'not_done'];

export interface WeightedItem {
  id: string;
  title: string;
  weight: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function answerFactor(answer: Answer, partialCreditPct: number): number {
  if (answer === 'done') return 1;
  if (answer === 'partial') return partialCreditPct / 100;
  return 0;
}

export interface ScoreRow {
  itemId: string;
  title: string;
  weight: number;
  points: number;
}

export function qualityBreakdown(
  items: WeightedItem[],
  answers: Record<string, Answer | undefined>,
  partialCreditPct: number,
): { rows: (ScoreRow & { answer: Answer | null })[]; total: number } {
  const rows = items.map((item) => {
    const answer = answers[item.id] ?? null;
    const points = answer ? round2(item.weight * answerFactor(answer, partialCreditPct)) : 0;
    return { itemId: item.id, title: item.title, weight: item.weight, answer, points };
  });
  const weightSum = items.reduce((s, i) => s + i.weight, 0);
  const raw = rows.reduce((s, r) => s + r.points, 0);
  // الأوزان الفعالة مجموعها 100 دائمًا؛ التطبيع حماية فقط عند اختلاف المجموع
  const total = weightSum > 0 ? round2((raw * 100) / weightSum) : 0;
  return { rows, total: Math.min(100, Math.max(0, total)) };
}

export function qualityScore(
  items: WeightedItem[],
  answers: Record<string, Answer | undefined>,
  partialCreditPct: number,
): number {
  return qualityBreakdown(items, answers, partialCreditPct).total;
}

export type Rating = 1 | 2 | 3 | 4 | 5;
export const RATINGS: Rating[] = [1, 2, 3, 4, 5];
/** أي بند تقييمه ≤ 2 يُعد منخفضًا */
export const LOW_RATING_THRESHOLD = 2;

export function isLowRating(rating: number | undefined | null): boolean {
  return typeof rating === 'number' && rating <= LOW_RATING_THRESHOLD;
}

export function supervisorBreakdown(
  items: WeightedItem[],
  ratings: Record<string, number | undefined>,
): { rows: (ScoreRow & { rating: number | null })[]; total: number } {
  const rows = items.map((item) => {
    const rating = ratings[item.id] ?? null;
    const points = rating ? round2((rating / 5) * item.weight) : 0;
    return { itemId: item.id, title: item.title, weight: item.weight, rating, points };
  });
  const weightSum = items.reduce((s, i) => s + i.weight, 0);
  const raw = rows.reduce((s, r) => s + r.points, 0);
  const total = weightSum > 0 ? round2((raw * 100) / weightSum) : 0;
  return { rows, total: Math.min(100, Math.max(0, total)) };
}

export function supervisorScore(items: WeightedItem[], ratings: Record<string, number | undefined>): number {
  return supervisorBreakdown(items, ratings).total;
}

export type NoteSeverity = 'high' | 'mid' | 'low';

/**
 * ملاحظة المشرف عند الإرسال [قرار مطلوب لاعتماد القاعدة]:
 * تُنشأ إذا وُجد نص ملاحظة أو بند منخفض. النص = الملاحظة أو «تقييم منخفض: {أسماء البنود}».
 * الأهمية: أكثر من بند منخفض = عالية، بند واحد = متوسطة، لا شيء = منخفضة.
 */
export function buildSupervisorNote(
  lowItemTitles: string[],
  noteText: string | null | undefined,
): { text: string; severity: NoteSeverity } | null {
  const note = (noteText ?? '').trim();
  if (!note && lowItemTitles.length === 0) return null;
  const severity: NoteSeverity = lowItemTitles.length > 1 ? 'high' : lowItemTitles.length === 1 ? 'mid' : 'low';
  const text = note || `تقييم منخفض: ${lowItemTitles.join('، ')}`;
  return { text, severity };
}
