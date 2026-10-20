import type { Metadata } from 'next';
import { ScanView } from '@/components/public/scan-view';
import { getSessionUser } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'مسح رمز دورة المياه' };
export const dynamic = 'force-dynamic';

/**
 * رمز QR على دورة المياه يحتوي ترميزها فقط، فيُقرأ من هذه الصفحة:
 * المستفيد ← صفحة التقييم، والموظف المسجّل ← صفحة دوره على دورة المياه نفسها.
 */
export default async function ScanPage() {
  const user = await getSessionUser().catch(() => null);
  return <ScanView staff={Boolean(user)} />;
}
