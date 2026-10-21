import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * إثبات مسح رمز QR لدورة المياه: المراقب لا يفتح جولة دورة مياه إلا بعد مسح رمزها في الموقع.
 * كوكي موقّعة (HMAC) تخص المستخدم نفسه، فيها دورات المياه الممسوحة وانتهاء صلاحية كل مسح.
 */
export const SCAN_COOKIE = 'jodex_scan';
/** صلاحية المسح: تكفي جولة كاملة من بدايتها إلى آخر موعدها */
export const SCAN_TTL_MS = 3 * 60 * 60 * 1000;
/** أقصى عدد دورات مياه محفوظة في الكوكي (الأحدث أولًا) */
const MAX_SCANS = 30;

type Scans = Record<string, number>;

function sign(userId: string, body: string) {
  return createHmac('sha256', env.appSecret).update(`scan:${userId}:${body}`).digest('base64url');
}

function decode(userId: string, value: string | undefined, now: Date): Scans {
  if (!value) return {};
  const [body, sig] = value.split('.');
  if (!body || !sig) return {};
  const expected = Buffer.from(sign(userId, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return {};
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Scans;
    return Object.fromEntries(Object.entries(parsed).filter(([, exp]) => typeof exp === 'number' && exp > now.getTime()));
  } catch {
    return {};
  }
}

/** دورات المياه التي مسح المستخدم رمزها وما زال مسحها صالحًا */
export async function scannedRestrooms(userId: string, now: Date): Promise<Set<string>> {
  const jar = await cookies();
  return new Set(Object.keys(decode(userId, jar.get(SCAN_COOKIE)?.value, now)));
}

/** قيمة الكوكي بعد إضافة مسح جديد لدورة مياه */
export function withScan(userId: string, current: string | undefined, restroomId: string, now: Date): string {
  const scans = decode(userId, current, now);
  delete scans[restroomId];
  const next = Object.fromEntries([[restroomId, now.getTime() + SCAN_TTL_MS], ...Object.entries(scans)].slice(0, MAX_SCANS));
  const body = Buffer.from(JSON.stringify(next)).toString('base64url');
  return `${body}.${sign(userId, body)}`;
}
