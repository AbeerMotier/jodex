'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[600px] items-center px-4 py-10">
      <section className="w-full rounded-[22px] border border-line bg-white px-6 py-10 text-center" role="alert">
        <h1 className="m-0 text-[20px] font-bold">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-[14px] text-muted">تعذّر عرض الصفحة. حاول مرة أخرى.</p>
        <button type="button" onClick={reset} className="touch-target mt-5 rounded-[13px] bg-ink px-6 py-3 text-[15px] font-semibold text-white">
          إعادة المحاولة
        </button>
      </section>
    </main>
  );
}
