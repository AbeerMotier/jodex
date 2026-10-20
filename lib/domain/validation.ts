/**
 * مخططات Zod المشتركة بين العميل والخادم + قوائم «قبل الإرسال».
 * نفس التحقق يُعاد على الخادم قبل أي كتابة.
 */
import { z } from 'zod';
import { FEEDBACK_REASONS, PHOTO_SLOTS, REQUIRED_PHOTO_SLOTS, type PhotoSlot } from './catalog';
import { isLowRating, type Answer } from './scoring';
import { summarizeWeights, SCORED_GROUPS } from './weights';

export const LOGIN_EMPTY_MESSAGE = 'أدخل اسم المستخدم وكلمة المرور.';
export const LOGIN_INVALID_MESSAGE = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

export const loginSchema = z.object({
  username: z.string(LOGIN_EMPTY_MESSAGE).trim().min(1, LOGIN_EMPTY_MESSAGE).max(64, LOGIN_INVALID_MESSAGE),
  password: z.string(LOGIN_EMPTY_MESSAGE).min(1, LOGIN_EMPTY_MESSAGE).max(256, LOGIN_INVALID_MESSAGE),
  next: z.string().max(200).optional(),
});

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

// ---------------------------------------------------------------------
// تقييم المستفيد
// ---------------------------------------------------------------------
const reasonKeys = FEEDBACK_REASONS.map((r) => r.key) as [string, ...string[]];

export const feedbackSchema = z
  .object({
    rating: z.enum(['excellent', 'good', 'bad'], 'اختر تقييمك لنظافة دورة المياه.'),
    reasons: z.array(z.enum(reasonKeys, 'سبب غير معروف.')).max(FEEDBACK_REASONS.length).default([]),
    otherText: z.string().trim().max(500, 'النص طويل جدًا (500 حرف كحد أقصى).').default(''),
  })
  .superRefine((v, ctx) => {
    if (v.rating === 'bad') {
      if (v.reasons.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'اختر سببًا واحدًا على الأقل لعدم رضاك.' });
      }
      if (v.reasons.includes('other') && v.otherText.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['otherText'], message: 'اكتب سبب عدم رضاك في حقل «أخرى».' });
      }
    } else if (v.reasons.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'أسباب عدم الرضا تُختار مع تقييم «سيئ» فقط.' });
    }
    if (new Set(v.reasons).size !== v.reasons.length) {
      ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'تكرار في الأسباب.' });
    }
  });
export type FeedbackInput = z.infer<typeof feedbackSchema>;

// ---------------------------------------------------------------------
// جولة المراقب
// ---------------------------------------------------------------------
export const answerSchema = z.enum(['done', 'partial', 'not_done'], 'إجابة غير صالحة.');
export const NOTE_MAX = 2000;
const noteSchema = z.string().trim().max(NOTE_MAX, 'الملاحظة طويلة جدًا (2000 حرف كحد أقصى).');

export const roundDraftSchema = z.object({
  answers: z.record(z.guid(), answerSchema).default({}),
  note: z.string().max(NOTE_MAX, 'الملاحظة طويلة جدًا (2000 حرف كحد أقصى).').default(''),
});
export type RoundDraft = z.infer<typeof roundDraftSchema>;

export const roundSubmitSchema = z.object({
  answers: z.record(z.guid(), answerSchema),
  note: noteSchema.default(''),
  idempotencyKey: z.guid('مفتاح الإرسال غير صالح.'),
});
export type RoundSubmitInput = z.infer<typeof roundSubmitSchema>;

export interface NamedItem {
  id: string;
  title: string;
}

export interface RoundIssues {
  missingItems: NamedItem[];
  missingDeep: NamedItem[];
  missingPhotos: PhotoSlot[];
  total: number;
}

/** قائمة «قبل الإرسال»: بنود بلا إجابة، بنود التنظيف العميق (في يومه فقط)، الصور الإلزامية الناقصة */
export function roundSubmissionIssues(input: {
  contractorItems: NamedItem[];
  deepItems: NamedItem[];
  deepRequired: boolean;
  answers: Record<string, Answer | undefined>;
  photos: Iterable<PhotoSlot>;
}): RoundIssues {
  const present = new Set(input.photos);
  const missingItems = input.contractorItems.filter((i) => !input.answers[i.id]);
  const missingDeep = input.deepRequired ? input.deepItems.filter((i) => !input.answers[i.id]) : [];
  const missingPhotos = REQUIRED_PHOTO_SLOTS.filter((s) => !present.has(s));
  return {
    missingItems,
    missingDeep,
    missingPhotos,
    total: missingItems.length + missingDeep.length + missingPhotos.length,
  };
}

export const photoSlotSchema = z.enum(PHOTO_SLOTS.map((s) => s.slot) as [PhotoSlot, ...PhotoSlot[]]);

// ---------------------------------------------------------------------
// تقييم المشرف الميداني
// ---------------------------------------------------------------------
export const evaluationStartSchema = z.object({ restroomId: z.guid('اختر الموقع.') });

export const evaluationSubmitSchema = z.object({
  evaluationId: z.guid(),
  ratings: z.record(z.guid(), z.number().int().min(1, 'تقييم غير صالح.').max(5, 'تقييم غير صالح.')),
  matchesRound: z.enum(['yes', 'no']).nullable().default(null),
  needsUrgent: z.enum(['yes', 'no']).nullable().default(null),
  note: noteSchema.default(''),
  idempotencyKey: z.guid('مفتاح الإرسال غير صالح.'),
});
export type EvaluationSubmitInput = z.infer<typeof evaluationSubmitSchema>;

export interface EvaluationIssues {
  missingRatings: NamedItem[];
  lowItems: NamedItem[];
  needsView: boolean;
  missingMatch: boolean;
  missingUrgent: boolean;
  noteRequired: boolean;
  total: number;
}

export function evaluationIssues(input: {
  items: NamedItem[];
  ratings: Record<string, number | undefined>;
  viewed: boolean;
  matchesRound: 'yes' | 'no' | null;
  needsUrgent: 'yes' | 'no' | null;
  note: string;
}): EvaluationIssues {
  const missingRatings = input.items.filter((i) => !input.ratings[i.id]);
  const lowItems = input.items.filter((i) => isLowRating(input.ratings[i.id]));
  const needsView = !input.viewed;
  const missingMatch = input.matchesRound === null;
  const missingUrgent = input.needsUrgent === null;
  const noteRequired = lowItems.length > 0 && input.note.trim().length === 0;
  const total =
    missingRatings.length + (missingMatch ? 1 : 0) + (missingUrgent ? 1 : 0) + (noteRequired ? 1 : 0);
  return { missingRatings, lowItems, needsView, missingMatch, missingUrgent, noteRequired, total };
}

// ---------------------------------------------------------------------
// الإعدادات والأوزان
// ---------------------------------------------------------------------
export const settingsItemSchema = z.object({
  id: z.guid().nullable().optional(),
  group: z.enum(['contractor', 'deep', 'supervisor'], 'اختر مجموعة البند.'),
  title: z.string('أدخل اسم البند.').trim().min(2, 'اسم البند قصير جدًا.').max(200, 'اسم البند طويل جدًا.'),
  description: z.string().trim().max(500, 'الوصف طويل جدًا.').nullable().optional(),
  category: z.string().trim().max(60, 'اسم المجال طويل جدًا (60 حرفًا كحد أقصى).').nullable().optional(),
  weight: z.number('أدخل وزنًا رقميًا.').min(0, 'الوزن بين 0 و100.').max(100, 'الوزن بين 0 و100.').nullable().optional(),
  isActive: z.boolean(),
  delete: z.boolean().optional(),
});
export type SettingsItemInput = z.infer<typeof settingsItemSchema>;

export const RECALC_OPTIONS = ['none', 'today', 'week', 'month'] as const;
export type RecalcOption = (typeof RECALC_OPTIONS)[number];

export const GROUP_SUM_MESSAGE: Record<(typeof SCORED_GROUPS)[number], string> = {
  contractor: 'مجموع أوزان بنود جولة المقاول الفعالة يجب أن يساوي 100%.',
  supervisor: 'مجموع أوزان بنود تقييم المشرف الفعالة يجب أن يساوي 100%.',
};

export const settingsSaveSchema = z
  .object({
    partialCreditPct: z.number('أدخل نسبة رقمية.').min(0, 'النسبة بين 0 و100.').max(100, 'النسبة بين 0 و100.'),
    deepCleanWeekday: z.number().int().min(0, 'اختر يومًا صحيحًا.').max(6, 'اختر يومًا صحيحًا.'),
    items: z.array(settingsItemSchema).max(300),
    recalc: z.enum(RECALC_OPTIONS).default('none'),
  })
  .superRefine((v, ctx) => {
    v.items.forEach((item, index) => {
      if (item.group !== 'deep' && !item.delete && (item.weight === null || item.weight === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'weight'], message: 'أدخل وزن البند.' });
      }
      if (item.delete && !item.id) {
        ctx.addIssue({ code: 'custom', path: ['items', index], message: 'لا يمكن حذف بند غير محفوظ.' });
      }
    });
    const summary = summarizeWeights(v.items);
    for (const group of SCORED_GROUPS) {
      if (!summary[group].valid) {
        ctx.addIssue({ code: 'custom', path: ['weights', group], message: GROUP_SUM_MESSAGE[group] });
      }
    }
  });
export type SettingsSaveInput = z.infer<typeof settingsSaveSchema>;

/** أول رسالة خطأ لكل مسار (للعرض بجانب الحقول) */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------
// إدارة المستخدمين والمباني ودورات المياه (الأدمن)
// ---------------------------------------------------------------------
export const USERNAME_PATTERN = /^[a-z0-9._-]{2,32}$/;
export const RESTROOM_CODE_PATTERN = /^[A-Z0-9-]{2,40}$/;

export const usernameField = z
  .string('أدخل اسم المستخدم.')
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'اسم المستخدم: من 2 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا أو . _ -');
const fullNameField = z.string('أدخل الاسم.').trim().min(2, 'الاسم قصير جدًا.').max(120, 'الاسم طويل جدًا (120 حرفًا كحد أقصى).');
const roleField = z.enum(['admin', 'supervisor', 'contractor_monitor', 'contractor'], 'اختر الدور.');
const adminScopeField = z.enum(['super', 'restricted', 'viewer'], 'اختر مستوى صلاحية الأدمن.');
const monitorKindField = z.enum(['primary', 'substitute'], 'اختر نوع المراقب.').nullable();
const idField = (message: string) => z.guid(message);

/** شكل المراقب: الأساسي بلا «ينوب عن»، والنائب ينوب عن مراقب أساسي، وغير المراقب بلا نوع */
function refineMonitorShape(
  v: { role?: string; monitorKind?: string | null; substituteForId?: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.role === undefined) return;
  if (v.role === 'contractor_monitor') {
    if (!v.monitorKind) ctx.addIssue({ code: 'custom', path: ['monitorKind'], message: 'اختر نوع المراقب (أساسي أو نائب).' });
    if (v.monitorKind === 'substitute' && !v.substituteForId) {
      ctx.addIssue({ code: 'custom', path: ['substituteForId'], message: 'اختر المراقب الأساسي الذي ينوب عنه.' });
    }
  }
}

export const userCreateSchema = z
  .object({
    username: usernameField,
    fullName: fullNameField,
    role: roleField,
    monitorKind: monitorKindField.default(null),
    substituteForId: idField('اختر المراقب الأساسي.').nullable().default(null),
    adminScope: adminScopeField.default('restricted'),
  })
  .superRefine(refineMonitorShape);
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z
  .object({
    username: usernameField.optional(),
    fullName: fullNameField.optional(),
    role: roleField.optional(),
    monitorKind: monitorKindField.optional(),
    substituteForId: idField('اختر المراقب الأساسي.').nullable().optional(),
    isActive: z.boolean().optional(),
    adminScope: adminScopeField.optional(),
  })
  .superRefine(refineMonitorShape);
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/** كلمة مرور يحددها الأدمن (اختيارية — بدونها تُنشأ كلمة عشوائية قوية) */
export const passwordSetSchema = z.object({
  password: z
    .string()
    .min(8, 'كلمة المرور 8 أحرف على الأقل.')
    .max(72, 'كلمة المرور طويلة جدًا.')
    .refine((v) => !/\s/.test(v), 'كلمة المرور بلا مسافات.')
    .optional(),
});

export const restroomIdsSchema = z.object({
  restroomIds: z.array(idField('دورة مياه غير صالحة.')).max(1000, 'عدد دورات المياه كبير جدًا.'),
});

export const buildingSchema = z.object({
  name: z.string('أدخل اسم المبنى.').trim().min(2, 'اسم المبنى قصير جدًا.').max(120, 'اسم المبنى طويل جدًا.'),
});

export const restroomSchema = z.object({
  code: z
    .string('أدخل الترميز.')
    .trim()
    .toUpperCase()
    .regex(RESTROOM_CODE_PATTERN, 'الترميز: من 2 إلى 40 حرفًا إنجليزيًا كبيرًا أو رقمًا أو -'),
  name: z.string('أدخل اسم دورة المياه.').trim().min(2, 'الاسم قصير جدًا.').max(120, 'الاسم طويل جدًا.'),
  floor: z.string('أدخل الدور.').trim().min(1, 'أدخل الدور.').max(60, 'اسم الدور طويل جدًا.'),
  buildingId: idField('اختر المبنى.'),
  monitorId: idField('اختر المراقب.').nullable().default(null),
  isActive: z.boolean().default(true),
});
export type RestroomInput = z.infer<typeof restroomSchema>;

export const bulkMonitorSchema = z.object({
  restroomIds: z.array(idField('دورة مياه غير صالحة.')).min(1, 'اختر دورة مياه واحدة على الأقل.').max(1000),
  monitorId: idField('اختر المراقب.').nullable(),
});
