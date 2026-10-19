/**
 * نتيجة زيارة المشرف الميداني حسب «نموذج التقييم الميداني لأعمال النظافة والصيانة»:
 * مساهمة البند = (التقييم ÷ 5) × وزنه، ومجموع كل مجال (النظافة/الصيانة) = مجموع مساهمات بنوده،
 * والنتيجة النهائية = مجموع المجالات، ثم التصنيف وحالة كل بند.
 */
import type { Tone } from './catalog';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** التصنيف النهائي: ممتاز ≥90 | جيد جداً 80–89.9 | جيد 70–79.9 | مقبول 60–69.9 | غير مرضي <60 */
export const VISIT_CLASSES: { min: number; label: string; tone: Tone }[] = [
  { min: 90, label: 'ممتاز', tone: 'success' },
  { min: 80, label: 'جيد جداً', tone: 'success' },
  { min: 70, label: 'جيد', tone: 'warning' },
  { min: 60, label: 'مقبول', tone: 'warning' },
  { min: Number.NEGATIVE_INFINITY, label: 'غير مرضي', tone: 'error' },
];

export function visitClassification(score: number | null): { label: string; tone: Tone } | null {
  if (score === null || !Number.isFinite(score)) return null;
  const c = VISIT_CLASSES.find((x) => score >= x.min)!;
  return { label: c.label, tone: c.tone };
}

/** حالة البند في النموذج: 5 و4 مطابق، 3 مقبول، 2 و1 يحتاج إجراء */
export function ratingStatus(rating: number | null): { label: string; tone: Tone } | null {
  if (!rating) return null;
  if (rating >= 4) return { label: 'مطابق', tone: 'success' };
  if (rating === 3) return { label: 'مقبول', tone: 'warning' };
  return { label: 'يحتاج إجراء', tone: 'error' };
}

export interface CategoryRow {
  category: string | null;
  weight: number;
  points: number;
}

/** مجموع كل مجال بترتيب ظهوره (البنود بلا مجال تُجمع تحت «عام») */
export function categorySubtotals(rows: CategoryRow[]): { category: string; weight: number; points: number }[] {
  const out = new Map<string, { category: string; weight: number; points: number }>();
  for (const r of rows) {
    const key = r.category?.trim() || 'عام';
    const cur = out.get(key) ?? { category: key, weight: 0, points: 0 };
    cur.weight = round2(cur.weight + r.weight);
    cur.points = round2(cur.points + r.points);
    out.set(key, cur);
  }
  return [...out.values()];
}
