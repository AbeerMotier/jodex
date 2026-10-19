import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffHeader } from '@/components/common/staff-header';
import { SupervisorApp } from '@/components/supervisor/supervisor-app';
import { getSessionUser } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'تقييم الموقع' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function SupervisorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/supervisor');
  if (user.role !== 'supervisor') redirect('/forbidden');
  // دورة المياه من رمز QR الممسوح (/go/[token])
  const { restroom } = await searchParams;
  return (
    <>
      <StaffHeader name={user.fullName} />
      <SupervisorApp userId={user.id} initialSiteId={UUID.test(String(restroom ?? '')) ? String(restroom) : null} />
    </>
  );
}
