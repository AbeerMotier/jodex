'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { IconAlert } from '@/components/ui/icons';

/** صفحة 403 مع زر العودة وإعادة توجيه تلقائية لصفحة الدور الصحيح */
export function ForbiddenView({ home }: { home: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(home), 5000);
    return () => clearTimeout(t);
  }, [home]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-[600px] items-center px-4 py-10">
      <section className="w-full animate-pop rounded-[22px] border border-line bg-white px-6 py-10 text-center" data-testid="forbidden">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-err-bg text-err-ink">
          <IconAlert size={32} />
        </div>
        <div className="tabular text-[13px] font-bold text-err-ink">403</div>
        <h1 className="m-0 mt-1 text-[22px] font-bold">لا تملك صلاحية الوصول لهذه الصفحة</h1>
        <p className="mt-2.5 text-[14px] text-muted">سيتم تحويلك إلى صفحتك خلال لحظات.</p>
        <Link
          href={home}
          className="touch-target mt-5 inline-flex items-center justify-center rounded-[13px] bg-ink px-6 py-3 text-[15px] font-semibold text-white no-underline hover:text-white"
        >
          العودة لصفحتك
        </Link>
      </section>
    </main>
  );
}
