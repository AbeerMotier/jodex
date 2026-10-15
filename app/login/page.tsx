import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { ROLE_LABEL, type Role } from '@/lib/domain/catalog';
import { env } from '@/lib/server/env';
import { createServiceClient } from '@/lib/server/supabase';

export const metadata: Metadata = { title: 'تسجيل الدخول' };
export const dynamic = 'force-dynamic';

const DEMO_ORDER = ['khaled', 'yaser', 'omar.z', 'reem', 'salman', 'admin'];

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  const expired = sp.expired === '1';

  // قائمة الحسابات التجريبية تظهر فقط مع DEMO_MODE=true (ممنوعة في الإنتاج)
  let demoAccounts: { username: string; label: string }[] = [];
  if (env.demoMode) {
    const { data } = await createServiceClient()
      .from('users')
      .select('username, role, monitor_kind')
      .eq('is_active', true)
      .in('username', DEMO_ORDER);
    demoAccounts = (data ?? [])
      .sort((a, b) => DEMO_ORDER.indexOf(a.username) - DEMO_ORDER.indexOf(b.username))
      .map((u) => ({
        username: u.username,
        label: u.monitor_kind === 'substitute' ? 'مراقب نائب' : ROLE_LABEL[u.role as Role],
      }));
  }

  return <LoginForm next={next} expired={expired} demoAccounts={demoAccounts} />;
}
