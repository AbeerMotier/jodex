import { describe, expect, it } from 'vitest';
import {
  evaluationIssues,
  evaluationSubmitSchema,
  feedbackSchema,
  loginSchema,
  roundSubmissionIssues,
  settingsSaveSchema,
} from '@/lib/domain/validation';
import { summarizeWeights } from '@/lib/domain/weights';
import { weekdayOfDate } from '@/lib/domain/time';

describe('تقييم المستفيد', () => {
  it('«سيئ» بلا سبب يُرفض', () => {
    const r = feedbackSchema.safeParse({ rating: 'bad', reasons: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain('سببًا واحدًا');
  });
  it('«أخرى» بلا نص يُرفض', () => {
    const r = feedbackSchema.safeParse({ rating: 'bad', reasons: ['other'], otherText: '   ' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join('.') === 'otherText')).toBe(true);
  });
  it('«سيئ» مع سبب يُقبل', () => {
    expect(feedbackSchema.safeParse({ rating: 'bad', reasons: ['odors'] }).success).toBe(true);
  });
  it('«أخرى» مع نص يُقبل', () => {
    expect(feedbackSchema.safeParse({ rating: 'bad', reasons: ['other'], otherText: 'الصابون ناقص' }).success).toBe(true);
  });
  it('ممتاز/جيد بلا أسباب يُقبل', () => {
    expect(feedbackSchema.safeParse({ rating: 'excellent' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ rating: 'good' }).success).toBe(true);
  });
  it('أسباب مع «جيد» تُرفض', () => {
    expect(feedbackSchema.safeParse({ rating: 'good', reasons: ['odors'] }).success).toBe(false);
  });
  it('سبب غير معروف يُرفض', () => {
    expect(feedbackSchema.safeParse({ rating: 'bad', reasons: ['hack'] }).success).toBe(false);
  });
});

describe('تسجيل الدخول', () => {
  it('حقل فارغ ← «أدخل اسم المستخدم وكلمة المرور.»', () => {
    const r = loginSchema.safeParse({ username: '  ', password: '' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('أدخل اسم المستخدم وكلمة المرور.');
  });
});

describe('قائمة «قبل الإرسال» لجولة المراقب', () => {
  const contractorItems = [
    { id: 'a', title: 'أ' },
    { id: 'b', title: 'ب' },
  ];
  const deepItems = [{ id: 'd', title: 'د' }];
  const allPhotos = ['tools', 'entry', 'sinks', 'toilets', 'general'] as const;

  it('بنود بلا إجابة وصور ناقصة تُعد', () => {
    const r = roundSubmissionIssues({ contractorItems, deepItems, deepRequired: false, answers: { a: 'done' }, photos: ['tools'] });
    expect(r.missingItems.map((i) => i.id)).toEqual(['b']);
    expect(r.missingPhotos).toEqual(['entry', 'sinks', 'toilets', 'general']);
    expect(r.total).toBe(5);
  });
  it('التنظيف العميق إلزامي في يومه فقط', () => {
    const base = { contractorItems, deepItems, answers: { a: 'done', b: 'partial' } as const, photos: allPhotos };
    expect(roundSubmissionIssues({ ...base, deepRequired: true }).missingDeep).toHaveLength(1);
    expect(roundSubmissionIssues({ ...base, deepRequired: false }).total).toBe(0);
  });
  it('«العمالة» اختيارية', () => {
    const r = roundSubmissionIssues({ contractorItems, deepItems, deepRequired: false, answers: { a: 'done', b: 'done' }, photos: allPhotos });
    expect(r.total).toBe(0);
  });
});

describe('تقييم المشرف — قائمة الناقص', () => {
  const items = [
    { id: 'x', title: 'س' },
    { id: 'y', title: 'ص' },
  ];
  it('ملاحظة إلزامية مع تقييم ≤ 2', () => {
    const r = evaluationIssues({ items, ratings: { x: 2, y: 5 }, viewed: true, matchesRound: 'yes', needsUrgent: 'no', note: '' });
    expect(r.noteRequired).toBe(true);
    expect(r.lowItems.map((i) => i.id)).toEqual(['x']);
    expect(r.total).toBe(1);
  });
  it('تقييم 3 لا يجعل الملاحظة إلزامية', () => {
    const r = evaluationIssues({ items, ratings: { x: 3, y: 5 }, viewed: true, matchesRound: 'no', needsUrgent: 'yes', note: '' });
    expect(r.total).toBe(0);
  });
  it('سؤال المطابقة والمعالجة الفورية إلزاميان', () => {
    const r = evaluationIssues({ items, ratings: { x: 4, y: 4 }, viewed: false, matchesRound: null, needsUrgent: null, note: '' });
    expect(r.needsView).toBe(true);
    expect(r.missingMatch).toBe(true);
    expect(r.missingUrgent).toBe(true);
    expect(r.total).toBe(2);
  });
  it('مخطط الإرسال يرفض تقييمًا خارج 1–5', () => {
    const r = evaluationSubmitSchema.safeParse({
      evaluationId: '6a0b0f0e-1d2c-4b3a-9f8e-7d6c5b4a3f21',
      ratings: { '6a0b0f0e-1d2c-4b3a-9f8e-7d6c5b4a3f22': 6 },
      matchesRound: 'yes',
      needsUrgent: 'no',
      idempotencyKey: '6a0b0f0e-1d2c-4b3a-9f8e-7d6c5b4a3f23',
    });
    expect(r.success).toBe(false);
  });
});

describe('الأوزان', () => {
  const item = (group: 'contractor' | 'supervisor' | 'deep', weight: number | null, isActive = true) => ({
    group,
    weight,
    isActive,
    title: 'بند تجريبي',
  });
  const validItems = [item('contractor', 60), item('contractor', 40), item('supervisor', 100), item('deep', null)];

  it('مجموع 100 لكل مجموعة يُقبل', () => {
    const r = settingsSaveSchema.safeParse({ partialCreditPct: 50, deepCleanWeekday: 1, items: validItems });
    expect(r.success).toBe(true);
  });
  it('منع الحفظ عند مجموع ≠ 100', () => {
    const r = settingsSaveSchema.safeParse({
      partialCreditPct: 50,
      deepCleanWeekday: 1,
      items: [item('contractor', 60), item('contractor', 39), item('supervisor', 100)],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join('.') === 'weights.contractor')).toBe(true);
  });
  it('البنود المعطلة لا تدخل المجموع', () => {
    const s = summarizeWeights([item('contractor', 60), item('contractor', 40), item('contractor', 25, false)]);
    expect(s.contractor).toMatchObject({ sum: 100, remaining: 0, valid: true });
  });
  it('المتبقي يُحسب', () => {
    const s = summarizeWeights([item('supervisor', 70)]);
    expect(s.supervisor).toMatchObject({ sum: 70, remaining: 30, valid: false });
  });
  it('نسبة جزئي خارج 0–100 تُرفض', () => {
    expect(settingsSaveSchema.safeParse({ partialCreditPct: 120, deepCleanWeekday: 1, items: validItems }).success).toBe(false);
  });
  it('يوم التنظيف العميق 0..6', () => {
    expect(settingsSaveSchema.safeParse({ partialCreditPct: 50, deepCleanWeekday: 7, items: validItems }).success).toBe(false);
    expect(weekdayOfDate('2026-10-19')).toBe(1); // الاثنين
  });
});
