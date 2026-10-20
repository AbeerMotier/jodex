import 'server-only';
import { cache } from 'react';
import type { AdminScope, MonitorKind, Role } from '@/lib/domain/catalog';
import { createServiceClient, createUserClient } from './supabase';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  monitorKind: MonitorKind | null;
  substituteForId: string | null;
  /** للأدمن: كامل أو محدود (بدون المستخدمين والمباني ودورات المياه والإعدادات والأوزان) */
  adminScope: AdminScope;
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
    .select('id, username, full_name, role, monitor_kind, substitute_for_id, is_active, admin_scope')
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
    adminScope: adminScopeOf(profile.admin_scope),
  };
});

/** مستوى الأدمن من قاعدة البيانات (مع القيم السابقة: full ← super، limited ← viewer) */
function adminScopeOf(value: string | null): AdminScope {
  if (value === 'super' || value === 'full') return 'super';
  if (value === 'viewer' || value === 'limited') return 'viewer';
  return 'restricted';
}

/** أدمن يحق له التعديل والإضافة والحذف (الرئيسي والمقيّد؛ المطّلع للعرض فقط) */
export function canManage(user: SessionUser | null): boolean {
  return user?.role === 'admin' && (user.adminScope === 'super' || user.adminScope === 'restricted');
}

/** الأدمن الرئيسي: الوحيد الذي يرى حسابات الأدمن الرئيسي ويديرها */
export function isSuperAdmin(user: SessionUser | null): boolean {
  return user?.role === 'admin' && user.adminScope === 'super';
}

/** الأدمن المطّلع: عرض فقط */
export function isViewer(user: SessionUser | null): boolean {
  return user?.role === 'admin' && user.adminScope === 'viewer';
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
