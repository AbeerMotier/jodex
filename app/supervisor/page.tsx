import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffHeader } from '@/components/common/staff-header';
import { SupervisorApp } from '@/components/supervisor/supervisor-app';
import { getSessionUser } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'تقييم الموقع' };
export const dynamic = 'force-dynamic';

export default async function SupervisorPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/supervisor');
  if (user.role !== 'supervisor') redirect('/forbidden');
  return (
    <>
      <StaffHeader name={user.fullName} />
      <SupervisorApp userId={user.id} />
    </>
  );
}
