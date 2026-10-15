import { describe, expect, it } from 'vitest';
import { buildSupervisorNote, qualityBreakdown, qualityScore, supervisorScore } from '@/lib/domain/scoring';

const contractorItems = [
  { id: 'c1', title: 'نظافة دورات المياه — الأرضيات والأحواض والأدوات الصحية', weight: 25 },
  { id: 'c2', title: 'رائحة دورات المياه', weight: 15 },
  { id: 'c3', title: 'تعبئة الفواحات', weight: 10 },
  { id: 'c4', title: 'نظافة المرايا والأبواب ومقابضها', weight: 12 },
  { id: 'c5', title: 'نظافة الزجاج والقواطع', weight: 10 },
  { id: 'c6', title: 'جمع النفايات وتفريغ السلال', weight: 15 },
  { id: 'c7', title: 'الالتزام بخطة العمل', weight: 13 },
];

describe('معادلة جودة جولة المراقب', () => {
  it('كل البنود «تم» = 100', () => {
    const answers = Object.fromEntries(contractorItems.map((i) => [i.id, 'done' as const]));
    expect(qualityScore(contractorItems, answers, 50)).toBe(100);
  });
  it('كل البنود «لم يتم» = 0', () => {
    const answers = Object.fromEntries(contractorItems.map((i) => [i.id, 'not_done' as const]));
    expect(qualityScore(contractorItems, answers, 50)).toBe(0);
  });
  it('جزئي بنسبة 50% (الافتراضي)', () => {
    const answers = { c1: 'partial', c2: 'done', c3: 'done', c4: 'done', c5: 'done', c6: 'not_done', c7: 'done' } as const;
    // 25*0.5 + 15 + 10 + 12 + 10 + 0 + 13 = 72.5
    expect(qualityScore(contractorItems, answers, 50)).toBe(72.5);
  });
  it('جزئي بنسبة مختلفة (25%)', () => {
    const answers = { c1: 'partial', c2: 'done', c3: 'done', c4: 'done', c5: 'done', c6: 'not_done', c7: 'done' } as const;
    // 25*0.25 + 60 = 66.25
    expect(qualityScore(contractorItems, answers, 25)).toBe(66.25);
  });
  it('جزئي بنسبة 100% يساوي «تم»', () => {
    const answers = Object.fromEntries(contractorItems.map((i) => [i.id, 'partial' as const]));
    expect(qualityScore(contractorItems, answers, 100)).toBe(100);
  });
  it('جزئي بنسبة 0% يساوي «لم يتم»', () => {
    const answers = Object.fromEntries(contractorItems.map((i) => [i.id, 'partial' as const]));
    expect(qualityScore(contractorItems, answers, 0)).toBe(0);
  });
  it('تفصيل النقاط لكل بند', () => {
    const { rows } = qualityBreakdown(contractorItems, { c1: 'partial', c2: 'done' }, 40);
    expect(rows[0]).toMatchObject({ weight: 25, points: 10, answer: 'partial' });
    expect(rows[1]).toMatchObject({ weight: 15, points: 15, answer: 'done' });
    expect(rows[2]).toMatchObject({ points: 0, answer: null });
  });
});

const supervisorItems = [
  { id: 's1', title: 'نظافة دورات المياه ومحتوياتها', weight: 30 },
  { id: 's2', title: 'الاستجابة لتعليمات المهندس المشرف', weight: 15 },
  { id: 's3', title: 'الاستجابة السريعة لأي حالة طارئة', weight: 15 },
  { id: 's4', title: 'صيانة الأجهزة الصحية وتأمين قطع الغيار', weight: 18 },
  { id: 's5', title: 'صيانة الإنارة والكشافات', weight: 12 },
  { id: 's6', title: 'صيانة مراوح الشفط', weight: 10 },
];

describe('معادلة تقييم المشرف', () => {
  it('كل البنود 5 = 100', () => {
    expect(supervisorScore(supervisorItems, { s1: 5, s2: 5, s3: 5, s4: 5, s5: 5, s6: 5 })).toBe(100);
  });
  it('كل البنود 1 = 20', () => {
    expect(supervisorScore(supervisorItems, { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1, s6: 1 })).toBe(20);
  });
  it('مزيج = Σ (التقييم ÷ 5) × الوزن', () => {
    // 4/5*30=24, 3/5*15=9, 5/5*15=15, 2/5*18=7.2, 4/5*12=9.6, 1/5*10=2 → 66.8
    expect(supervisorScore(supervisorItems, { s1: 4, s2: 3, s3: 5, s4: 2, s5: 4, s6: 1 })).toBe(66.8);
  });
});

describe('ملاحظة المشرف وأهميتها', () => {
  it('لا ملاحظة ولا بند منخفض ← لا تُنشأ ملاحظة', () => {
    expect(buildSupervisorNote([], '')).toBeNull();
  });
  it('ملاحظة نصية بلا بنود منخفضة ← أهمية منخفضة', () => {
    expect(buildSupervisorNote([], 'المرايا تحتاج تلميع')).toEqual({ text: 'المرايا تحتاج تلميع', severity: 'low' });
  });
  it('بند منخفض واحد بلا نص ← «تقييم منخفض: …» متوسطة', () => {
    expect(buildSupervisorNote(['صيانة مراوح الشفط'], '  ')).toEqual({
      text: 'تقييم منخفض: صيانة مراوح الشفط',
      severity: 'mid',
    });
  });
  it('أكثر من بند منخفض ← عالية، والنص = الملاحظة إن وُجدت', () => {
    expect(buildSupervisorNote(['أ', 'ب'], 'تسرب مياه')).toEqual({ text: 'تسرب مياه', severity: 'high' });
    expect(buildSupervisorNote(['أ', 'ب'], '')).toEqual({ text: 'تقييم منخفض: أ، ب', severity: 'high' });
  });
});
