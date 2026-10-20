import type { Metadata } from 'next';
import { ForbiddenView } from '@/components/common/forbidden-view';
import { SettingsView } from '@/components/admin/settings-view';
import { getSessionUser, isFullAdmin } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'الإعدادات والأوزان' };

export const dynamic = 'force-dynamic';

/** للأدمن ذي الصلاحيات الكاملة فقط (الأدمن المحدود يُمنع من الصفحة ومن واجهاتها البرمجية) */
export default async function SettingsPage() {
  if (!isFullAdmin(await getSessionUser())) return <ForbiddenView home="/admin" />;
  return <SettingsView />;
}
