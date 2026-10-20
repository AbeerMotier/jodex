import type { Metadata } from 'next';
import { ForbiddenView } from '@/components/common/forbidden-view';
import { UsersView } from '@/components/admin/users-view';
import { getSessionUser, isFullAdmin } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'المستخدمون والصلاحيات' };

export const dynamic = 'force-dynamic';

/** للأدمن ذي الصلاحيات الكاملة فقط (الأدمن المحدود يُمنع من الصفحة ومن واجهاتها البرمجية) */
export default async function UsersPage() {
  if (!isFullAdmin(await getSessionUser())) return <ForbiddenView home="/admin" />;
  return <UsersView />;
}
