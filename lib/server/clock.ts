import 'server-only';
import { headers } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * وقت الخادم — المرجع الوحيد لكل القواعد الزمنية.
 * لأغراض الاختبار الآلي فقط: يمكن تثبيت الساعة عبر ترويسة x-jodex-test-now
 * بشرط تفعيل JODEX_ALLOW_TEST_CLOCK=true وتطابق السر JODEX_TEST_CLOCK_SECRET.
 * يُمنع ضبط هذين المتغيرين في الإنتاج.
 */
export async function serverNow(): Promise<Date> {
  const secret = env.testClock;
  if (secret) {
    try {
      const h = await headers();
      const override = h.get('x-jodex-test-now');
      const provided = h.get('x-jodex-test-secret');
      if (override && provided && safeEqual(provided, secret)) {
        const d = new Date(override);
        if (!Number.isNaN(d.getTime())) return d;
      }
    } catch {
      // خارج سياق الطلب
    }
  }
  return new Date();
}
