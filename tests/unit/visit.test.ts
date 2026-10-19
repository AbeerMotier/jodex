import { describe, expect, it } from 'vitest';
import { supervisorBreakdown } from '@/lib/domain/scoring';
import { categorySubtotals, ratingStatus, visitClassification } from '@/lib/domain/visit';

// نموذج التقييم الميداني: النظافة 60% والصيانة 40% (وزن البند داخل مجاله × وزن المجال)
const CLEANING: [number, number][] = [[0.18, 5], [0.17, 4], [0.15, 3], [0.13, 5], [0.12, 4], [0.05, 4], [0.1, 5], [0.05, 5], [0.05, 5]];
const MAINTENANCE: [number, number][] = [[0.12, 5], [0.05, 4], [0.1, 5], [0.06, 5], [0.12, 5], [0.15, 4], [0.15, 5], [0.05, 3], [0.05, 5], [0.1, 5], [0, 2], [0.05, 5]];

describe('نتيجة الزيارة الميدانية', () => {
  const items = [
    ...CLEANING.map(([w], i) => ({ id: `c${i}`, title: `c${i}`, weight: Math.round(w * 60 * 100) / 100, category: 'النظافة' })),
    ...MAINTENANCE.map(([w], i) => ({ id: `m${i}`, title: `m${i}`, weight: Math.round(w * 40 * 100) / 100, category: 'الصيانة' })),
  ];
  const ratings = Object.fromEntries([...CLEANING.map(([, r], i) => [`c${i}`, r]), ...MAINTENANCE.map(([, r], i) => [`m${i}`, r])]);

  it('يطابق مثال النموذج: النظافة 52.32 والصيانة 37.60 والنهائية 89.92 «جيد جداً»', () => {
    expect(items.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(100, 6);
    const { rows, total } = supervisorBreakdown(items, ratings);
    const subtotals = categorySubtotals(rows.map((r, i) => ({ category: items[i].category, weight: r.weight, points: r.points })));
    expect(subtotals).toEqual([
      { category: 'النظافة', weight: 60, points: 52.32 },
      { category: 'الصيانة', weight: 40, points: 37.6 },
    ]);
    expect(total).toBeCloseTo(89.92, 2);
    expect(visitClassification(total)?.label).toBe('جيد جداً');
  });

  it('حدود التصنيف وحالة البند', () => {
    expect(visitClassification(90)?.label).toBe('ممتاز');
    expect(visitClassification(89.99)?.label).toBe('جيد جداً');
    expect(visitClassification(70)?.label).toBe('جيد');
    expect(visitClassification(60)?.label).toBe('مقبول');
    expect(visitClassification(59.99)?.label).toBe('غير مرضي');
    expect(visitClassification(null)).toBeNull();
    expect([5, 4, 3, 2, 1].map((r) => ratingStatus(r)?.label)).toEqual(['مطابق', 'مطابق', 'مقبول', 'يحتاج إجراء', 'يحتاج إجراء']);
  });
});
