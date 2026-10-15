'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from './api';

interface Page<T> {
  rows: T[];
  total: number;
  nextCursor: string | null;
}

interface State<T> {
  key: string | null;
  rows: T[];
  total: number;
  cursor: string | null;
  error: ApiClientError | null;
}

/** قائمة مرقّمة من الخادم مع «عرض المزيد» */
export function usePaged<T>(baseUrl: string) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null, rows: [], total: 0, cursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiClientError | null>(null);
  const key = `${baseUrl}#${nonce}`;

  useEffect(() => {
    let active = true;
    api<Page<T>>(baseUrl).then(
      (page) => {
        if (active) setState({ key, rows: page.rows, total: page.total, cursor: page.nextCursor, error: null });
      },
      (e) => {
        if (active) setState((s) => ({ ...s, key, error: e as ApiClientError }));
      },
    );
    return () => {
      active = false;
    };
  }, [baseUrl, key]);

  const reload = useCallback(() => {
    setMoreError(null);
    setNonce((n) => n + 1);
  }, []);

  const more = useCallback(async () => {
    if (!state.cursor || loadingMore || state.key !== key) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const page = await api<Page<T>>(`${baseUrl}${sep}cursor=${encodeURIComponent(state.cursor)}`);
      setState((s) => (s.key === key ? { ...s, rows: [...s.rows, ...page.rows], total: page.total, cursor: page.nextCursor } : s));
    } catch (e) {
      setMoreError(e as ApiClientError);
    } finally {
      setLoadingMore(false);
    }
  }, [baseUrl, key, loadingMore, state.cursor, state.key]);

  const current = state.key === key;
  return {
    rows: state.rows,
    total: state.total,
    hasMore: current && Boolean(state.cursor),
    loading: !current,
    loadingMore,
    error: (current ? state.error : null) ?? moreError,
    more,
    reload,
  };
}
