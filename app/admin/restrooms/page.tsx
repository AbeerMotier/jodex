import type { Metadata } from 'next';
import { ForbiddenView } from '@/components/common/forbidden-view';
import { PlacesView } from '@/components/admin/places-view';
import { getSessionUser, isFullAdmin } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'المباني ودورات المياه' };

export const dynamic = 'force-dynamic';

/** للأدمن ذي الصلاحيات الكاملة فقط (الأدمن المحدود يُمنع من الصفحة ومن واجهاتها البرمجية) */
export default async function RestroomsPage() {
  if (!isFullAdmin(await getSessionUser())) return <ForbiddenView home="/admin" />;
  return <PlacesView />;
}
