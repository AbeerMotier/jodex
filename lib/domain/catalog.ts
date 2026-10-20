/** القوائم الثابتة والتسميات العربية المعتمدة في المواصفات */
import type { Answer, NoteSeverity, Rating } from './scoring';
import type { BadgeState, RoundDisplayStatus, Shift } from './schedule';

export type Role = 'admin' | 'supervisor' | 'contractor_monitor' | 'contractor';
/** نطاق صلاحية الأدمن: الكامل، أو المحدود (بدون المستخدمين والصلاحيات والمباني ودورات المياه والإعدادات والأوزان) */
export type AdminScope = 'full' | 'limited';
export type MonitorKind = 'primary' | 'substitute';
export type ItemGroup = 'contractor' | 'deep' | 'supervisor';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'الأدمن',
  supervisor: 'المشرف الميداني',
  contractor_monitor: 'مراقب المقاول',
  contractor: 'المقاول',
};

export const ADMIN_SCOPE_LABEL: Record<AdminScope, string> = {
  full: 'صلاحيات كاملة',
  limited: 'بدون إدارة المستخدمين والمباني والإعدادات',
};

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  supervisor: '/supervisor',
  contractor_monitor: '/monitor',
  contractor: '/contractor',
};

export const SHIFT_LABEL: Record<Shift, string> = { am: 'الجولة الصباحية', pm: 'الجولة المسائية' };
export const SHIFT_SHORT_LABEL: Record<Shift, string> = { am: 'صباحية', pm: 'مسائية' };

export const ANSWER_LABEL: Record<Answer, string> = { done: 'تم', partial: 'جزئي', not_done: 'لم يتم' };

export const RATING_LABEL: Record<Rating, string> = {
  1: 'غير مرضي',
  2: 'ضعيف',
  3: 'جيد',
  4: 'جيد جدًا',
  5: 'ممتاز',
};

export const SEVERITY_LABEL: Record<NoteSeverity, string> = { high: 'أهمية عالية', mid: 'أهمية متوسطة', low: 'أهمية منخفضة' };

export type Tone = 'success' | 'warning' | 'error' | 'neutral';

export const DISPLAY_STATUS: Record<RoundDisplayStatus, { label: string; tone: Tone }> = {
  full: { label: 'ملتزم تمامًا', tone: 'success' },
  behind: { label: 'متأخر عن الخطة', tone: 'warning' },
  non: { label: 'غير ملتزم بالخطة', tone: 'error' },
  missed: { label: 'فائتة', tone: 'error' },
  not_started: { label: 'لم تبدأ', tone: 'neutral' },
  in_progress: { label: 'لم تكتمل', tone: 'neutral' },
  late: { label: 'متأخرة · لم تكتمل', tone: 'warning' },
};

export const BADGE_STATUS: Record<BadgeState, { label: string; tone: Tone }> = {
  full: { label: 'ملتزم تمامًا', tone: 'success' },
  on_time: { label: 'ضمن الوقت', tone: 'neutral' },
  behind: { label: 'متأخر عن الخطة', tone: 'warning' },
  non: { label: 'غير ملتزم بالخطة', tone: 'error' },
};

export type PhotoSlot = 'tools' | 'entry' | 'sinks' | 'toilets' | 'general' | 'labor';

/**
 * مرفقات الجولة الحالية. «المراحيض» أُزيلت بطلب الجهة (تبقى تسميتها لعرض الجولات السابقة فقط)،
 * و«العمالة» إلزامية وتُلتقط بالكاميرا مباشرة (cameraOnly) دون رفع صورة محفوظة.
 */
export const PHOTO_SLOTS: { slot: PhotoSlot; label: string; required: boolean; cameraOnly?: boolean }[] = [
  { slot: 'tools', label: 'الأدوات المستخدمة', required: true },
  { slot: 'entry', label: 'المدخل', required: true },
  { slot: 'sinks', label: 'المغاسل', required: true },
  { slot: 'general', label: 'الوضع العام لدورة المياه', required: true },
  { slot: 'labor', label: 'العمالة', required: true, cameraOnly: true },
];
export const REQUIRED_PHOTO_SLOTS = PHOTO_SLOTS.filter((s) => s.required).map((s) => s.slot);
export const CAMERA_ONLY_SLOTS = PHOTO_SLOTS.filter((s) => s.cameraOnly).map((s) => s.slot);
export const PHOTO_SLOT_LABEL: Record<PhotoSlot, string> = {
  ...(Object.fromEntries(PHOTO_SLOTS.map((s) => [s.slot, s.label])) as Record<PhotoSlot, string>),
  toilets: 'المراحيض',
};

/** خانة صورة متاحة للرفع في الجولات الحالية */
export function isPhotoSlot(v: unknown): v is PhotoSlot {
  return typeof v === 'string' && PHOTO_SLOTS.some((s) => s.slot === v);
}

/** [قرار مطلوب] الحد الأقصى لحجم الصورة المرفوعة */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
/** [قرار] الحد الأقصى لصور تقييم المشرف */
export const MAX_SUPERVISOR_PHOTOS = 10;

export type FeedbackRating = 'excellent' | 'good' | 'bad';
export const FEEDBACK_RATING_VALUE: Record<FeedbackRating, 1 | 4 | 5> = { excellent: 5, good: 4, bad: 1 };
export const FEEDBACK_VALUE_RATING: Record<number, FeedbackRating> = { 5: 'excellent', 4: 'good', 1: 'bad' };
export const FEEDBACK_RATING_LABEL: Record<FeedbackRating, string> = { excellent: 'ممتاز', good: 'جيد', bad: 'سيئ' };
/** أوزان الوجوه في مؤشر رضا المستفيدين، والنسبة تُحسب على أساس أعلى وزن (60) */
export const FEEDBACK_WEIGHT: Record<FeedbackRating, number> = { excellent: 60, good: 30, bad: 10 };
export const FEEDBACK_MAX_WEIGHT = 60;
export const SATISFACTION_FORMULA = 'مؤشر الرضا = (ممتاز × 60 + جيد × 30 + سيئ × 10) ÷ (عدد التقييمات × 60) × 100';
export const FEEDBACK_SELECTION_MESSAGE: Record<FeedbackRating, string> = {
  excellent: 'رائع! يسعدنا أن المكان نال رضاك.',
  good: 'شكرًا لك، يسعدنا أن المكان بحالة جيدة.',
  bad: 'نعتذر عن تجربتك. أخبرنا بسبب عدم رضاك.',
};

export type FeedbackReasonKey = 'not_clean' | 'odors' | 'floor_dirty_wet' | 'supplies_missing' | 'other';
export const FEEDBACK_REASONS: { key: FeedbackReasonKey; label: string }[] = [
  { key: 'not_clean', label: 'دورة المياه غير نظيفة' },
  { key: 'odors', label: 'فيه روائح' },
  { key: 'floor_dirty_wet', label: 'الأرضية متسخة أو مبللة' },
  { key: 'supplies_missing', label: 'المستلزمات ناقصة' },
  { key: 'other', label: 'أخرى' },
];
export const FEEDBACK_REASON_LABEL = Object.fromEntries(FEEDBACK_REASONS.map((r) => [r.key, r.label])) as Record<
  FeedbackReasonKey,
  string
>;

/** تقييم واحد لكل مستفيد (حسابه إن كان مسجلًا، وإلا جهازه) لكل دورة مياه كل 24 ساعة */
export const FEEDBACK_WINDOW_MINUTES = 24 * 60;

export const WEEKDAY_LABEL = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const ITEM_GROUP_LABEL: Record<ItemGroup, string> = {
  contractor: 'بنود جولة المقاول',
  deep: 'بنود التنظيف العميق',
  supervisor: 'بنود تقييم المشرف',
};

/** نوع التقييم الذي ينتمي إليه البند (مشتق من المجموعة) */
export const ITEM_GROUP_EVALUATION: Record<ItemGroup, 'contractor_round' | 'supervisor_evaluation'> = {
  contractor: 'contractor_round',
  deep: 'contractor_round',
  supervisor: 'supervisor_evaluation',
};
export const EVALUATION_TYPE_LABEL = {
  contractor_round: 'جولة مراقب المقاول',
  supervisor_evaluation: 'تقييم المشرف الميداني',
} as const;
/** نوع البند: محتسب في الدرجة (بوزن) أو قائمة تحقق مستقلة */
export const ITEM_GROUP_SCORED: Record<ItemGroup, boolean> = { contractor: true, deep: false, supervisor: true };

export type Source = 'all' | 'contractor' | 'supervisor' | 'beneficiary';
export const SOURCE_LABEL: Record<Source, string> = {
  all: 'الكل',
  contractor: 'تقييم المقاول',
  supervisor: 'تقييم المشرف',
  beneficiary: 'تقييم المستفيد',
};
export function isSource(v: unknown): v is Source {
  return v === 'all' || v === 'contractor' || v === 'supervisor' || v === 'beneficiary';
}

export const PERIOD_LABEL = { today: 'اليوم', week: 'أسبوع', month: 'شهر' } as const;
