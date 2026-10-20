import 'server-only';
import { restroomLabel } from '@/lib/domain/format';
import { createHmac } from 'node:crypto';
import { FEEDBACK_WINDOW_MINUTES } from '@/lib/domain/catalog';
import { env } from './env';
import { createServiceClient } from './supabase';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
/** ترميز دورة المياه كما في ملف الجهة (مثل 100-HMR-HQ1003-00-0001) */
export const CODE_PATTERN = /^[A-Z0-9-]{2,40}$/;

export interface PublicRestroom {
  qrId: string;
  /** رمز QR العشوائي الفعال (للروابط القديمة ولتسجيل التقييم) */
  qrToken: string;
  restroomId: string;
  code: string;
  name: string;
  floor: string;
  building: string;
}

/**
 * يحدد دورة المياه من مرجع الرابط: ترميز دورة المياه (محتوى رمز QR الجديد)،
 * أو الرمز العشوائي في الروابط المطبوعة سابقًا. دورة المياه ورمزها يجب أن يكونا فعالين.
 */
export async function resolveRestroomRef(ref: string): Promise<PublicRestroom | null> {
  const svc = createServiceClient();
  const value = decodeURIComponent(ref).trim();
  let restroomId: string | null = null;
  let qr: { id: string; token: string } | null = null;
  if (CODE_PATTERN.test(value)) {
    const { data: room } = await svc.from('restrooms').select('id').eq('code', value).maybeSingle();
    restroomId = room?.id ?? null;
    if (restroomId) {
      const { data } = await svc.from('qr_codes').select('id, token').eq('restroom_id', restroomId).eq('is_active', true).maybeSingle();
      qr = data;
    }
  }
  if (!qr && TOKEN_PATTERN.test(value)) {
    const { data } = await svc.from('qr_codes').select('id, token, restroom_id, is_active').eq('token', value).maybeSingle();
    if (data?.is_active) {
      qr = { id: data.id, token: data.token };
      restroomId = data.restroom_id;
    }
  }
  if (!qr || !restroomId) return null;
  const { data: room } = await svc
    .from('restrooms')
    .select('id, code, name, floor_label, is_active, building_id')
    .eq('id', restroomId)
    .maybeSingle();
  if (!room || !room.is_active) return null;
  const { data: building } = await svc.from('buildings').select('name').eq('id', room.building_id).maybeSingle();
  return {
    qrId: qr.id,
    qrToken: qr.token,
    restroomId: room.id,
    code: room.code,
    name: restroomLabel(room.name),
    floor: room.floor_label,
    building: building?.name ?? '',
  };
}

/** بصمة غير قابلة للعكس للجهاز (كوكي عشوائي) أو لعنوان IP + المتصفح عند تعطيل الكوكيز */
export function clientHash(deviceId: string | undefined, ip: string, userAgent: string): string {
  const source = deviceId ? `dev:${deviceId}` : `ip:${ip}|ua:${userAgent.slice(0, 200)}`;
  return createHmac('sha256', env.appSecret).update(source).digest('hex');
}

/** بصمة حساب مسجّل (لا يُخزَّن معرّف المستخدم نفسه مع تقييم المستفيد) */
export function accountHash(userId: string): string {
  return createHmac('sha256', env.appSecret).update(`usr:${userId}`).digest('hex');
}

/**
 * هوية المستفيد لمنع إعادة التقييم: حسابه إن كان مسجلًا، وإلا جهازه.
 * يُفحص الجهاز أيضًا مع الحساب، فلا يعيد التقييم بتسجيل الخروج على الجهاز نفسه.
 */
export function feedbackIdentity(input: { userId: string | null; deviceId: string | undefined; ip: string; userAgent: string }) {
  const device = clientHash(input.deviceId, input.ip, input.userAgent);
  if (input.userId) return { primary: accountHash(input.userId), all: [accountHash(input.userId), device] };
  return { primary: device, all: [device] };
}

/** الثواني المتبقية قبل السماح بتقييم دورة المياه نفسها مرة أخرى (null = مسموح الآن) */
export async function feedbackRetryAfter(hashes: string[], restroomId: string, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - FEEDBACK_WINDOW_MINUTES * 60_000).toISOString();
  const { data } = await createServiceClient()
    .from('beneficiary_feedback')
    .select('submitted_at')
    .eq('restroom_id', restroomId)
    .in('client_hash', hashes)
    .gt('submitted_at', since)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const until = new Date(data.submitted_at).getTime() + FEEDBACK_WINDOW_MINUTES * 60_000;
  return Math.max(1, Math.ceil((until - now.getTime()) / 1000));
}

/** نص المدة المتبقية للمستفيد (ساعات ودقائق) */
export function retryText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes <= 2 ? 'دقيقتين' : `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : `${hours} ساعات`;
  return rest ? `${h} و${rest} دقيقة` : h;
}

export function tooSoonMessage(seconds: number): string {
  return `سبق أن قيّمت دورة المياه هذه خلال آخر 24 ساعة. يمكنك تقييمها مرة أخرى بعد ${retryText(seconds)}.`;
}
