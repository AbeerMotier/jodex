import type { Metadata } from 'next';
import { ForbiddenView } from '@/components/common/forbidden-view';

export const metadata: Metadata = { title: 'لا تملك صلاحية' };

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const home = typeof sp.home === 'string' && /^\/(admin|supervisor|monitor)$/.test(sp.home) ? sp.home : '/login';
  return <ForbiddenView home={home} />;
}
