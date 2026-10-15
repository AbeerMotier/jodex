'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './icons';
import { cn } from './cn';

function useDialogBehavior(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

/** نافذة وسطية */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 560,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useDialogBehavior(open, onClose);
  const id = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div className="absolute inset-0 animate-[fadeIn_.2s_ease_both] bg-[rgba(47,79,68,.38)]" onClick={onClose} aria-hidden />
      <section
        ref={ref as React.RefObject<HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cn(
          'relative max-h-[calc(100dvh-48px)] w-full animate-pop overflow-y-auto rounded-[20px] bg-white px-[18px] pt-[18px] pb-2 shadow-[0_30px_60px_-20px_rgba(20,35,30,.45)] outline-none',
          className,
        )}
        style={{ maxWidth: width }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 id={id} className="m-0 text-[17px] font-bold">
              {title}
            </h2>
            {subtitle && <span className="text-[12.5px] text-muted">{subtitle}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#F6F9F7] text-ink"
          >
            <IconClose size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

/** لوحة جانبية للتفاصيل (تنزلق من اليسار) */
export function Drawer({
  open,
  onClose,
  kicker,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useDialogBehavior(open, onClose);
  const id = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-50 animate-[fadeIn_.2s_ease_both] bg-[rgba(47,79,68,.38)]" onClick={onClose} aria-hidden />
      <aside
        ref={ref as React.RefObject<HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="fixed top-0 bottom-0 left-0 z-[51] w-[min(560px,100%)] animate-[slideIn_.28s_ease_both] overflow-y-auto bg-white shadow-[0_0_40px_rgba(47,79,68,.2)] outline-none"
      >
        <div className="sticky top-0 z-[1] flex items-center justify-between gap-2.5 border-b border-divider bg-white px-5 py-4">
          <div>
            {kicker && <div className="text-[12.5px] font-semibold text-ink-2">{kicker}</div>}
            <div id={id} className="text-[18px] font-bold">
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-line bg-white"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-[18px] px-5 pt-[18px] pb-8">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

/** نافذة النجاح بعد إرسال الجولة/التقييم */
export function SuccessDialog({
  open,
  title,
  sub,
  meta,
  onClose,
}: {
  open: boolean;
  title: string;
  sub: string;
  meta?: string;
  onClose: () => void;
}) {
  const ref = useDialogBehavior(open, onClose);
  const id = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-[fadeIn_.2s_ease_both] items-center justify-center bg-[rgba(47,79,68,.4)] p-5">
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-testid="success-dialog"
        className="w-full max-w-[400px] animate-pop rounded-[22px] bg-white px-[26px] pt-8 pb-6 text-center shadow-[0_20px_60px_rgba(47,79,68,.25)] outline-none"
      >
        <div className="mx-auto mb-4 flex h-16 w-16 animate-[ringIn_.5s_ease_.1s_both] items-center justify-center rounded-full bg-ok-bg text-[30px] text-ok-ink">
          ✓
        </div>
        <div id={id} className="text-[20px] font-bold">
          {title}
        </div>
        <div className="mt-2 text-[14px] leading-[1.7] text-muted">{sub}</div>
        {meta && <div className="mt-2 text-[12.5px] text-ink-2">{meta}</div>}
        <button type="button" onClick={onClose} className="touch-target mt-5 w-full rounded-[13px] bg-ink p-[13px] text-[15px] font-semibold text-white">
          تم
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** عرض مكبر للصورة */
export function Lightbox({ src, alt, onClose }: { src: string | null; alt?: string; onClose: () => void }) {
  const ref = useDialogBehavior(Boolean(src), onClose);
  if (!src || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? 'عرض الصورة'}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex cursor-zoom-out animate-[fadeIn_.2s_ease_both] items-center justify-center bg-[rgba(47,79,68,.85)] p-6 outline-none"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt ?? ''} className="max-h-full max-w-full animate-pop rounded-[12px] object-contain" />
      <button type="button" aria-label="إغلاق" className="absolute top-4 left-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink">
        <IconClose size={18} />
      </button>
    </div>,
    document.body,
  );
}
