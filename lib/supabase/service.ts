/**
 * إنشاء عميل Supabase بصلاحية service_role.
 * لا يُستورد إطلاقًا في كود العميل — يُستخدم من الخادم والسكربتات الإدارية فقط.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServiceRoleClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'jodex-server' } },
  });
}
