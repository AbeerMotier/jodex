import Link from 'next/link';
import { IconAlert } from '@/components/ui/icons';

export function InvalidToken() {
  return (
    <main className="mx-auto flex max-w-[600px] animate-fade-up flex-col gap-3.5 px-4 pt-6 pb-[72px]">
      <section className="rounded-[22px] border border-line bg-white px-[22px] py-10 text-center shadow-[0_10px_30px_rgba(47,79,68,.05)]" data-testid="invalid-token">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-err-bg text-err-ink">
          <IconAlert size={32} />
        </div>
        <h1 className="m-0 text-[22px] font-bold">الرمز غير صالح</h1>
        <p className="mx-auto mt-2.5 max-w-[320px] text-[15px] leading-[1.8] text-ink-2">
          هذا الرمز غير صالح أو تم إيقافه. امسح رمز QR المثبت عند دورة المياه مرة أخرى.
        </p>
      </section>
      <div className="pt-2.5 text-center text-[13px] text-muted">
        هل لديك حساب؟{' '}
        <Link href="/login" className="text-ink underline underline-offset-[3px] hover:text-brand">
          تسجيل دخول الموظفين
        </Link>
      </div>
    </main>
  );
}
