'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/client/api';
import type { Period } from '@/lib/domain/time';

export const PERIOD_STORAGE_KEY = 'jodex:admin:period';
export const DEFAULT_PERIOD: Period = 'week';
const PERIOD_EVENT = 'jodex:period-change';

export function isPeriod(v: string | null | undefined): v is Period {
  return v === 'today' || v === 'week' || v === 'month';
}

function readStoredPeriod(): Period {
  try {
    const v = localStorage.getItem(PERIOD_STORAGE_KEY);
    return isPeriod(v) ? v : DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

function subscribeStoredPeriod(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(PERIOD_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(PERIOD_EVENT, onChange);
  };
}

/** الفترة المحفوظة بين صفحات الأدمن (localStorage) كمصدر خارجي متزامن */
export function useStoredPeriod(): Period {
  return useSyncExternalStore(subscribeStoredPeriod, readStoredPeriod, () => DEFAULT_PERIOD);
}

export function storePeriod(period: Period) {
  try {
    localStorage.setItem(PERIOD_STORAGE_KEY, period);
  } catch {
    /* تجاهل */
  }
  window.dispatchEvent(new Event(PERIOD_EVENT));
}

/** حالة الفلاتر في رابط الصفحة (قابلة للمشاركة) مع حفظ الفترة المختارة بين الصفحات */
export function useUrlFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const storedPeriod = useStoredPeriod();

  const urlPeriod = sp.get('period');
  const period: Period = isPeriod(urlPeriod) ? urlPeriod : storedPeriod;

  const get = useCallback((key: string) => sp.get(key) ?? '', [sp]);

  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (!next.get('period')) next.set('period', period);
      if (isPeriod(patch.period)) storePeriod(patch.period);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname, period],
  );

  /** سلسلة الاستعلام للواجهة البرمجية (تشمل الفترة دائمًا) */
  const query = useCallback(
    (keys: string[], extra: Record<string, string> = {}) => {
      const q = new URLSearchParams();
      q.set('period', period);
      for (const k of keys) {
        const v = sp.get(k);
        if (v) q.set(k, v);
      }
      for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
      return q.toString();
    },
    [sp, period],
  );

  return { period, get, set, query, searchParams: sp };
}

export interface FilterOptions {
  buildings: { id: string; name: string }[];
  restrooms: { id: string; code: string; name: string; floor: string; buildingId: string; building: string; active: boolean }[];
  monitors: { id: string; name: string; kind: 'primary' | 'substitute' | null; active: boolean }[];
  supervisors: { id: string; name: string; active: boolean }[];
}

let optionsCache: FilterOptions | null = null;
let optionsPromise: Promise<FilterOptions> | null = null;

export function useFilterOptions() {
  const [options, setOptions] = useState<FilterOptions | null>(optionsCache);
  useEffect(() => {
    if (optionsCache) return;
    optionsPromise ??= api<FilterOptions>('/api/admin/filters');
    optionsPromise
      .then((o) => {
        optionsCache = o;
        setOptions(o);
      })
      .catch(() => {
        optionsPromise = null;
      });
  }, []);
  return options;
}

/** خيارات مترابطة: المبنى ← الدور ← دورة المياه */
export function useLocationChoices(options: FilterOptions | null, buildingId: string, floor: string) {
  return useMemo(() => {
    const rooms = options?.restrooms ?? [];
    const inBuilding = buildingId ? rooms.filter((r) => r.buildingId === buildingId) : rooms;
    const floors = [...new Set(inBuilding.map((r) => r.floor))];
    const restrooms = inBuilding.filter((r) => !floor || r.floor === floor);
    return { floors, restrooms };
  }, [options, buildingId, floor]);
}
