import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[600px] items-center px-4 py-10">
      <section className="w-full rounded-[22px] border border-line bg-white px-6 py-10 text-center">
        <div className="tabular text-[13px] font-bold text-muted">404</div>
        <h1 className="m-0 mt-1 text-[22px] font-bold">الصفحة غير موجودة</h1>
        <Link href="/" className="touch-target mt-5 inline-flex items-center justify-center rounded-[13px] bg-ink px-6 py-3 text-[15px] font-semibold text-white no-underline">
          العودة للرئيسية
        </Link>
      </section>
    </main>
  );
}
