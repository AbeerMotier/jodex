import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { env } from './env';

/**
 * عميل بجلسة المستخدم (يخضع لسياسات RLS). يقرأ ويحدّث كوكيز الجلسة.
 * في مكونات الخادم لا يمكن كتابة الكوكيز، ويتولى proxy.ts تحديث الجلسة.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // مكوّن خادم: التحديث يتم في proxy.ts
        }
      },
    },
  });
}

let serviceClient: SupabaseClient | null = null;

/** عميل service_role — يتجاوز RLS، ويُستخدم فقط بعد التحقق من الجلسة والدور والنطاق */
export function createServiceClient(): SupabaseClient {
  if (!serviceClient) serviceClient = createServiceRoleClient(env.supabaseUrl, env.serviceRoleKey);
  return serviceClient;
}
