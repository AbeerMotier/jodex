import 'server-only';
import { createServiceClient } from './supabase';

/** أسماء المستخدمين لعرضها (تُستدعى بعد التحقق من صلاحية الطلب) */
export async function namesById(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return {};
  const { data } = await createServiceClient().from('users').select('id, full_name').in('id', unique);
  return Object.fromEntries((data ?? []).map((u) => [u.id, u.full_name]));
}
