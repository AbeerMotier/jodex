import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/server/auth';
import { resolveRestroomRef } from '@/lib/server/public';

export const dynamic = 'force-dynamic';

/**
 * دخول الموظف من رمز QR لدورة مياه (ترميزها، أو الرمز العشوائي في الروابط السابقة):
 * بعد تسجيل الدخول تُفتح صفحة دوره على دورة المياه نفسها
 * (المراقب ← جولتها، المشرف ← تقييمها، الأدمن ← سجلها، المقاول ← قائمته). رمز غير صالح ← صفحة الرمز.
 */
export default async function QrStaffEntry({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/go/${token}`)}`);
  const info = await resolveRestroomRef(token);
  if (!info) redirect(`/r/${encodeURIComponent(token)}`);
  if (user.role === 'contractor_monitor') redirect(`/monitor?restroom=${info.restroomId}`);
  if (user.role === 'supervisor') redirect(`/supervisor?restroom=${info.restroomId}`);
  if (user.role === 'contractor') redirect('/contractor');
  redirect(`/admin/rounds?period=today&restroom=${info.restroomId}`);
}
