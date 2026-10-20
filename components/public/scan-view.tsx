'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RESTROOM_CODE_PATTERN, QrScanner } from '@/components/common/qr-scanner';
import { Decor } from '@/components/ui/decor';
import { Logo } from '@/components/ui/logo';

/** صفحة مسح رمز دورة المياه بالكاميرا (مع إدخال الترميز يدويًا عند تعذّر الكاميرا) */
export function ScanView({ staff }: { staff: boolean }) {
  const router = useRouter();
  const [found, setFound] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');

  function open(ref: string) {
    setFound(ref);
    router.push(`/${staff ? 'go' : 'r'}/${encodeURIComponent(ref)}`);
  }

  function submitManual() {
    const code = manual.trim().toUpperCase();
    if (!RESTROOM_CODE_PATTERN.test(code)) {
      setError('اكتب الترميز كما هو مكتوب أسفل الرمز (مثل 100-HMR-HQ1003-00-0001).');
      return;
    }
    setError('');
    open(code);
  }

  return (
    <main className="mx-auto flex max-w-[600px] animate-fade-up flex-col gap-3.5 px-4 pt-6 pb-[72px]">
      <div className="relative isolate overflow-hidden rounded-[24px] bg-brand px-[22px] py-6 text-white shadow-[0_16px_36px_rgba(47,79,68,.18)]">
        <Decor variant="hero" />
        <div className="relative z-[1] flex flex-col items-center gap-2 text-center">
          <Logo size="sm" />
          <h1 className="m-0 text-[22px] font-bold">امسح رمز دورة المياه</h1>
          <div className="text-[14px] text-white">{staff ? 'لفتح دورة المياه في صفحتك' : 'لتقييم نظافة دورة المياه'}</div>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-white px-4 py-5">
        {found ? (
          <div className="py-10 text-center text-[14px] text-muted" role="status" data-testid="scan-found">
            تمت قراءة الرمز <b dir="ltr" className="tabular text-ink">{found}</b>… جارٍ الفتح
          </div>
        ) : (
          <QrScanner active={!found} onResult={open} />
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-[22px] border border-line bg-white px-4 py-4">
        <label htmlFor="manual-code" className="text-[14px] font-semibold">
          أو اكتب ترميز دورة المياه
        </label>
        <div className="flex gap-2">
          <input
            id="manual-code"
            dir="ltr"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitManual()}
            maxLength={40}
            placeholder="100-HMR-HQ1003-00-0001"
            className="tabular min-h-11 min-w-0 flex-1 rounded-[11px] border border-line px-3 text-left text-[14px] outline-ink"
            data-testid="manual-code"
          />
          <button type="button" onClick={submitManual} className="touch-target rounded-[11px] bg-ink px-4 text-[14px] font-semibold text-white" data-testid="manual-open">
            فتح
          </button>
        </div>
        {error && <div className="text-[12.5px] text-err-ink">{error}</div>}
      </section>

      {!staff && (
        <div className="pt-1 text-center text-[13px] text-muted">
          هل لديك حساب؟{' '}
          <Link href="/login" prefetch={false} className="text-ink underline underline-offset-[3px] hover:text-brand">
            تسجيل دخول الموظفين
          </Link>
        </div>
      )}
    </main>
  );
}
