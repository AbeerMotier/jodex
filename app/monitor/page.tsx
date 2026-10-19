import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffHeader } from '@/components/common/staff-header';
import { MonitorApp } from '@/components/monitor/monitor-app';
import { getSessionUser } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'جولة المراقب' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function MonitorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/monitor');
  if (user.role !== 'contractor_monitor') redirect('/forbidden');
  // دورة المياه من رمز QR الممسوح (/go/[token])
  const { restroom } = await searchParams;
  return (
    <>
      <StaffHeader name={user.fullName} />
      <MonitorApp userId={user.id} initialRestroomId={UUID.test(String(restroom ?? '')) ? String(restroom) : null} />
    </>
  );
}
