'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** شريط علوي لبوابة الموظفين (الاسم وزر الخروج) */
export function StaffHeader({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST', noAuthRedirect: true });
    } catch {
      /* الخروج محليًا على أي حال */
    }
    // انتقال كامل يمسح أي حالة في الذاكرة بعد الخروج
    window.location.assign(new URL('/login', window.location.origin).href);
  }
  return (
    <header className="sticky top-0 z-30 bg-white/95 shadow-[0_6px_20px_rgba(47,79,68,.06)] backdrop-blur-[12px]">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#BFE6D2]" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint-2" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F4C9B9]" />
          </span>
          <span className="rounded-full bg-mint-5 px-[13px] py-[5px] text-[13px] font-bold text-ink">بوابة الموظفين</span>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-semibold text-ink">{name}</span>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            data-testid="logout"
            className="touch-target rounded-[9px] border border-line bg-white px-3 py-1.5 text-[13px] text-ink hover:border-[#8FB8A2]"
          >
            خروج
          </button>
        </div>
      </div>
    </header>
  );
}
