import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffHeader } from '@/components/common/staff-header';
import { MonitorApp } from '@/components/monitor/monitor-app';
import { getSessionUser } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'جولة المراقب' };
export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/monitor');
  if (user.role !== 'contractor_monitor') redirect('/forbidden');
  return (
    <>
      <StaffHeader name={user.fullName} />
      <MonitorApp userId={user.id} />
    </>
  );
}
