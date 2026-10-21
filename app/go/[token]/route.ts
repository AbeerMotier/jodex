import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { serverNow } from '@/lib/server/clock';
import { resolveRestroomRef } from '@/lib/server/public';
import { SCAN_COOKIE, SCAN_TTL_MS, withScan } from '@/lib/server/scan';

export const dynamic = 'force-dynamic';

/** إعادة توجيه بمسار نسبي (يصح خلف أي وكيل أو نطاق) */
function go(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

/**
 * دخول الموظف من رمز QR لدورة مياه (ترميزها، أو الرمز العشوائي في الروابط السابقة):
 * بعد تسجيل الدخول تُفتح صفحة دوره على دورة المياه نفسها
 * (المراقب ← جولتها، المشرف ← تقييمها، الأدمن ← سجلها، المقاول ← قائمته). رمز غير صالح ← صفحة الرمز.
 * المراقب لا يفتح بنود جولة إلا بعد هذا المسح: يُسجَّل المسح في كوكي موقّعة صالحة لساعات الجولة.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) return go(`/login?next=${encodeURIComponent(`/go/${token}`)}`);
  const info = await resolveRestroomRef(token);
  if (!info) return go(`/r/${encodeURIComponent(token)}`);
  if (user.role === 'contractor_monitor') {
    const res = go(`/monitor?restroom=${info.restroomId}`);
    res.cookies.set(SCAN_COOKIE, withScan(user.id, req.cookies.get(SCAN_COOKIE)?.value, info.restroomId, await serverNow()), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true',
      path: '/',
      maxAge: Math.round(SCAN_TTL_MS / 1000),
    });
    return res;
  }
  if (user.role === 'supervisor') return go(`/supervisor?restroom=${info.restroomId}`);
  if (user.role === 'contractor') return go('/contractor');
  return go(`/admin/rounds?period=today&restroom=${info.restroomId}`);
}
