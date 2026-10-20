import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InvalidToken } from '@/components/public/invalid-token';
import { RateExperience } from '@/components/public/rate-experience';
import { getSessionUser } from '@/lib/server/auth';
import { serverNow } from '@/lib/server/clock';
import { env } from '@/lib/server/env';
import { feedbackIdentity, feedbackRetryAfter, resolveRestroomRef, tooSoonMessage } from '@/lib/server/public';

export const metadata: Metadata = { title: 'تقييم نظافة دورة المياه' };
export const dynamic = 'force-dynamic';

/** عنوان العميل بنفس قاعدة clientIp في نقاط النهاية (عدد الوكلاء الموثوقين) */
function requestIp(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  if (xff && env.trustedProxyHops > 0) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const ip = parts[Math.max(0, parts.length - env.trustedProxyHops)];
    if (ip) return ip.slice(0, 64);
  }
  return h.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}

/** صفحة تقييم المستفيد: من ترميز دورة المياه (محتوى رمز QR) أو الرمز العشوائي في الروابط السابقة */
export default async function RatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await resolveRestroomRef(token);
  if (!info) return <InvalidToken />;
  const now = await serverNow();
  // من قيّم دورة المياه نفسها خلال 24 ساعة يرى رسالة المنع بدل النموذج (والخادم يرفض الإرسال أيضًا)
  const [h, c, user] = await Promise.all([headers(), cookies(), getSessionUser().catch(() => null)]);
  // المشرف الميداني أو المراقب المسجّل يمسح الرمز بكاميرا الجوال ← صفحة دوره على دورة المياه نفسها مباشرة
  if (user && (user.role === 'supervisor' || user.role === 'contractor_monitor')) redirect(`/go/${encodeURIComponent(info.code)}`);
  const identity = feedbackIdentity({ userId: user?.id ?? null, deviceId: c.get('jodex_device')?.value, ip: requestIp(h), userAgent: h.get('user-agent') ?? '' });
  const retry = await feedbackRetryAfter(identity.all, info.restroomId, now);
  return (
    <RateExperience
      token={info.code}
      restroom={{ code: info.code, name: info.name, floor: info.floor, building: info.building }}
      serverNow={now.toISOString()}
      blockedMessage={retry ? tooSoonMessage(retry) : null}
    />
  );
}
