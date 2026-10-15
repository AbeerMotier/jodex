import 'server-only';
import { ApiError } from '../http';

export function parseOffset(sp: URLSearchParams): number {
  const raw = sp.get('cursor') ?? sp.get('offset');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new ApiError(422, 'bad_cursor', 'مؤشر الصفحة غير صالح.');
  return n;
}

export function parseEnum<T extends string>(sp: URLSearchParams, key: string, values: readonly T[]): T | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  if (!(values as readonly string[]).includes(v)) throw new ApiError(422, 'bad_filter', 'قيمة الفلتر غير صالحة.');
  return v as T;
}
