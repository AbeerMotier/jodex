import 'server-only';
import { cache } from 'react';
import type { MonitorKind, Role } from '@/lib/domain/catalog';
import { createServiceClient, createUserClient } from './supabase';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  monitorKind: MonitorKind | null;
  substituteForId: string | null;
}

/** المستخدم الحالي بعد التحقق من الجلسة لدى Supabase Auth ومن أن حسابه نشط */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createUserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await createServiceClient()
    .from('users')
    .select('id, username, full_name, role, monitor_kind, substitute_for_id, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    role: profile.role,
    monitorKind: profile.monitor_kind,
    substituteForId: profile.substitute_for_id,
  };
});

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
