import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/server/auth';
import { resolveQrToken } from '@/lib/server/public';

export const dynamic = 'force-dynamic';

/**
 * دخول الموظف من رمز QR لدورة مياه: بعد تسجيل الدخول تُفتح صفحة دوره على دورة المياه نفسها
 * (المراقب ← جولتها، المشرف ← تقييمها، الأدمن ← سجلها). رمز غير صالح ← صفحة الرمز.
 */
export default async function QrStaffEntry({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/go/${token}`)}`);
  const info = await resolveQrToken(token);
  if (!info) redirect(`/r/${encodeURIComponent(token)}`);
  if (user.role === 'contractor_monitor') redirect(`/monitor?restroom=${info.restroomId}`);
  if (user.role === 'supervisor') redirect(`/supervisor?restroom=${info.restroomId}`);
  redirect(`/admin/rounds?period=today&restroom=${info.restroomId}`);
}
