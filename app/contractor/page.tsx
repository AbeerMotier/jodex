import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffHeader } from '@/components/common/staff-header';
import { ContractorView } from '@/components/contractor/contractor-view';
import { getSessionUser } from '@/lib/server/auth';
import { serverNow } from '@/lib/server/clock';
import { contractorRestrooms } from '@/lib/server/contractor';

export const metadata: Metadata = { title: 'دورات المياه المسندة' };
export const dynamic = 'force-dynamic';

export default async function ContractorPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/contractor');
  if (user.role !== 'contractor') redirect('/forbidden');
  const data = await contractorRestrooms(user, await serverNow());
  return (
    <>
      <StaffHeader name={user.fullName} />
      <ContractorView name={user.fullName} data={data} />
    </>
  );
}
