'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void }>({ show: () => {} });

export const WELCOME_KEY = 'jodex:welcome';

/** رسائل منبثقة (~3 ثوانٍ) للإجراءات */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // رسالة الترحيب بعد الدخول (تُحفظ في sessionStorage قبل الانتقال) تُعرض بعد أول رسم
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const welcome = sessionStorage.getItem(WELCOME_KEY);
        if (welcome) {
          sessionStorage.removeItem(WELCOME_KEY);
          show(welcome);
        }
      } catch {
        /* تجاهل */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            data-testid="toast"
            className="pointer-events-auto flex max-w-[calc(100%-32px)] animate-fade-up items-center gap-2.5 rounded-[13px] px-[18px] py-3 text-[14px] text-white shadow-[0_10px_30px_rgba(47,79,68,.25)]"
            style={{ background: toast.tone === 'error' ? '#B5512F' : '#2F4F44' }}
          >
            <span
              className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[12px] text-white"
              style={{ background: toast.tone === 'error' ? '#E37452' : '#55957A' }}
              aria-hidden
            >
              {toast.tone === 'error' ? '!' : '✓'}
            </span>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
