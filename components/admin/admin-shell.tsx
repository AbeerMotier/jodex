'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Decor } from '@/components/ui/decor';
import { IconMenu } from '@/components/ui/icons';
import { Logo } from '@/components/ui/logo';
import { api } from '@/lib/client/api';
import { isPeriod, useStoredPeriod } from './filters-context';

const NAV = [
  { href: '/admin', label: 'لوحة المؤشرات', count: null },
  { href: '/admin/rounds', label: 'سجل الجولات', count: 'log' },
  { href: '/admin/feedback', label: 'تقييمات المستفيدين', count: 'feedback' },
  { href: '/admin/notes', label: 'الملاحظات والإجراءات', count: 'notes' },
  { href: '/admin/staff', label: 'أداء الموظفين المتميزين', count: 'staff' },
  { href: '/admin/qr', label: 'رموز QR', count: 'qr' },
  { href: '/admin/users', label: 'المستخدمون والصلاحيات', count: null, fullOnly: true },
  { href: '/admin/restrooms', label: 'المباني ودورات المياه', count: null, fullOnly: true },
  { href: '/admin/settings', label: 'الإعدادات والأوزان', count: null, fullOnly: true },
] as const;

type Counts = Record<'log' | 'feedback' | 'notes' | 'staff' | 'qr', number>;

function Sidebar({ adminName, fullAccess }: { adminName: string; fullAccess: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const storedPeriod = useStoredPeriod();
  const urlPeriod = sp.get('period');
  const period = isPeriod(urlPeriod) ? urlPeriod : storedPeriod;
  const [counts, setCounts] = useState<Counts | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Counts>(`/api/admin/sidebar?period=${period}`)
      .then((c) => !cancelled && setCounts(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [period, pathname]);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', noAuthRedirect: true });
    } catch {
      /* تجاهل */
    }
    // انتقال كامل يمسح أي حالة في الذاكرة بعد الخروج
    window.location.assign(new URL('/login', window.location.origin).href);
  }

  return (
    <aside
      className="relative isolate flex flex-col gap-5 overflow-hidden bg-brand px-3.5 py-[22px] text-white md:sticky md:top-0 md:h-dvh md:w-[260px] md:flex-none md:overflow-y-auto"
      data-testid="admin-sidebar"
    >
      <Decor variant="sidebar" />
      <div className="relative z-[1] flex items-center justify-between md:justify-center">
        <Logo size="md" className="px-2 pt-2 pb-1.5" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="admin-nav"
          aria-label="القائمة"
          className="touch-target flex items-center justify-center rounded-[12px] border border-white/40 text-white md:hidden"
        >
          <IconMenu size={22} />
        </button>
      </div>
      <nav id="admin-nav" className={`relative z-[1] flex-col gap-1 ${open ? 'flex' : 'hidden'} md:flex`} aria-label="لوحة التحكم">
        {NAV.filter((n) => fullAccess || !('fullOnly' in n)).map((n) => {
          const active = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
          const value = n.count && counts ? counts[n.count] : null;
          return (
            <Link
              key={n.href}
              href={`${n.href}?period=${period}`}
              onClick={() => setOpen(false)}
              aria-current={active ? 'page' : undefined}
              className="flex min-h-11 items-center justify-between gap-2 rounded-[12px] px-3.5 py-[11px] text-right text-[14px] text-white no-underline transition-colors hover:text-white hover:opacity-90"
              style={{ background: active ? 'rgba(255,255,255,.22)' : 'transparent', fontWeight: active ? 700 : 500 }}
            >
              <span>{n.label}</span>
              {n.count && (
                <span
                  className="tabular min-w-6 rounded-full px-[7px] py-px text-center text-[11.5px]"
                  style={{ background: active ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.08)' }}
                  data-testid={`nav-count-${n.count}`}
                >
                  {value ?? '…'}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className={`relative z-[1] mt-auto ${open ? 'flex' : 'hidden'} items-center justify-between gap-2 px-1 text-[12.5px] md:flex`}>
        <span className="text-white">م. {adminName}</span>
        <button type="button" onClick={logout} className="border-0 bg-transparent text-[12.5px] font-semibold text-white underline underline-offset-[3px]" data-testid="logout">
          خروج
        </button>
      </div>
    </aside>
  );
}

/** لوحة الأدمن: شريط جانبي أخضر يمين الشاشة ومحتوى مرن */
export function AdminShell({ adminName, fullAccess = true, children }: { adminName: string; fullAccess?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh animate-[fadeIn_.3s_ease_both] flex-col md:flex-row">
      <Suspense fallback={<aside className="bg-brand md:h-dvh md:w-[260px]" />}>
        <Sidebar adminName={adminName} fullAccess={fullAccess} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] px-4 pt-[22px] pb-[60px] md:px-[22px]">{children}</div>
    </div>
  );
}
