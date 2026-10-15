'use client';
/**
 * عميل HTTP للواجهة: رمز CSRF، رسائل عربية، إعادة توجيه عند انتهاء الجلسة،
 * وتمييز انقطاع الشبكة (لإعادة المحاولة مع الإبقاء على المسودة).
 */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم. تحقق من الاتصال وأعد المحاولة — بياناتك محفوظة.';

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  let token = readCookie('jodex_csrf');
  if (!token) {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    token = data?.token ?? readCookie('jodex_csrf');
  }
  return token ?? '';
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  /** لا تُعِد التوجيه لصفحة الدخول تلقائيًا عند 401 */
  noAuthRedirect?: boolean;
}

export function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(new URL(`/login?next=${encodeURIComponent(next)}&expired=1`, window.location.origin).href);
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body || options.form ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = await ensureCsrf();
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin', signal: options.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiClientError(0, 'network', NETWORK_MESSAGE);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    const error = new ApiClientError(res.status, err.code ?? 'error', err.message ?? 'حدث خطأ غير متوقع. حاول مرة أخرى.', err.fields, err);
    if (res.status === 401 && !options.noAuthRedirect) redirectToLogin();
    throw error;
  }
  return data as T;
}

/** تنزيل ملف من نقطة نهاية (PDF/Excel) */
export async function download(path: string, fallbackName: string) {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiClientError(0, 'network', NETWORK_MESSAGE);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) redirectToLogin();
    throw new ApiClientError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'تعذّر تجهيز الملف.');
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
