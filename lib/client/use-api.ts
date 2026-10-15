'use client';
import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { api, ApiClientError } from './api';

interface State<T> {
  /** مفتاح الطلب الذي تخصه النتيجة الحالية (المسار + رقم إعادة التحميل) */
  key: string | null;
  data: T | null;
  error: ApiClientError | null;
}

const asClientError = (e: unknown) => (e instanceof ApiClientError ? e : new ApiClientError(0, 'unknown', 'حدث خطأ غير متوقع.'));

/**
 * جلب بيانات GET مع حالات التحميل والخطأ وإعادة المحاولة.
 * حالة «جارٍ التحميل» مشتقة: النتيجة الحالية لا تخص الطلب الحالي بعد (تبقى البيانات السابقة معروضة).
 */
export function useApi<T>(path: string | null) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null, data: null, error: null });
  const key = path ? `${path}#${nonce}` : null;

  useEffect(() => {
    if (!path || !key) return;
    const ctrl = new AbortController();
    api<T>(path, { signal: ctrl.signal }).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ key, data, error: null });
      },
      (e) => {
        if (ctrl.signal.aborted || (e as Error)?.name === 'AbortError') return;
        setState((s) => ({ key, data: s.data, error: asClientError(e) }));
      },
    );
    return () => ctrl.abort();
  }, [path, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (update: SetStateAction<T | null>) =>
      setState((s) => ({ ...s, data: typeof update === 'function' ? (update as (prev: T | null) => T | null)(s.data) : update })),
    [],
  );

  return {
    data: state.data,
    error: state.key === key ? state.error : null,
    loading: key !== null && state.key !== key,
    reload,
    setData,
  };
}
