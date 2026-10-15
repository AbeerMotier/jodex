import 'server-only';
import { createServiceClient } from './supabase';

export async function hitRateLimit(
  key: string,
  windowSeconds: number,
  max: number,
  now: Date,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await createServiceClient().rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
    p_now: now.toISOString(),
  });
  if (error) {
    console.error('[jodex] rate limit check failed', error.message);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), retryAfterSeconds: Number(row?.retry_after_seconds ?? 0) };
}

export function minutesText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  if (m === 1) return 'دقيقة واحدة';
  if (m === 2) return 'دقيقتين';
  if (m <= 10) return `${m} دقائق`;
  return `${m} دقيقة`;
}
