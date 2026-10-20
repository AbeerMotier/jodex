/** أدوات مشتركة لإنشاء الحسابات في Supabase Auth وربطها بجدول users */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generatePassword, internalEmail as internalEmailFor } from '../../lib/accounts';
import { authEmailDomain } from './env';

export { generatePassword };

export function internalEmail(): string {
  return internalEmailFor(authEmailDomain());
}

export async function findAuthUserByUsername(svc: SupabaseClient, username: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.app_metadata?.jodex_username === username);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

export interface ProfileFields {
  username: string;
  full_name: string;
  role: 'admin' | 'supervisor' | 'contractor_monitor' | 'contractor';
  monitor_kind: 'primary' | 'substitute' | null;
  /** للأدمن: super (افتراضي لحسابات السكربت) أو restricted أو viewer */
  admin_scope?: 'super' | 'restricted' | 'viewer';
  /** للمراقب الأساسي: دورات المياه المسؤول عنها (تُسند إليه وتُنزع من مسؤولها السابق) */
  restroom_ids?: string[];
  substitute_for_id: string | null;
}

async function assignRestrooms(svc: SupabaseClient, userId: string, fields: ProfileFields) {
  if (fields.monitor_kind !== 'primary' || !fields.restroom_ids?.length) return;
  const { error } = await svc.from('restrooms').update({ monitor_id: userId }).in('id', fields.restroom_ids);
  if (error) throw error;
}

/**
 * إنشاء/تحديث مستخدم (upsert على username).
 * يعيد كلمة المرور فقط إذا أُنشئ الحساب الآن (أو أُعيد ضبطها) لطباعتها مرة واحدة.
 */
export async function upsertAccount(
  svc: SupabaseClient,
  fields: ProfileFields,
): Promise<{ id: string; created: boolean; password: string | null }> {
  const username = fields.username.trim().toLowerCase();
  const { data: existing, error: findErr } = await svc
    .from('users')
    .select('id, role')
    .eq('username', username)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const { error } = await svc
      .from('users')
      .update({
        full_name: fields.full_name,
        role: fields.role,
        monitor_kind: fields.monitor_kind,
        substitute_for_id: fields.substitute_for_id,
        admin_scope: fields.admin_scope ?? (fields.role === 'admin' ? 'super' : 'restricted'),
      })
      .eq('id', existing.id);
    if (error) throw error;
    await assignRestrooms(svc, existing.id, fields);
    await svc.auth.admin.updateUserById(existing.id, {
      app_metadata: { jodex_role: fields.role, jodex_username: username },
    });
    return { id: existing.id, created: false, password: null };
  }

  const password = generatePassword();
  let authUserId: string;
  const orphan = await findAuthUserByUsername(svc, username);
  if (orphan) {
    const { error } = await svc.auth.admin.updateUserById(orphan.id, {
      password,
      app_metadata: { jodex_role: fields.role, jodex_username: username },
      ban_duration: 'none',
    });
    if (error) throw error;
    authUserId = orphan.id;
  } else {
    const { data, error } = await svc.auth.admin.createUser({
      email: internalEmail(),
      password,
      email_confirm: true,
      app_metadata: { jodex_role: fields.role, jodex_username: username },
    });
    if (error && (error.code === 'email_address_invalid' || (/email/i.test(error.message) && /invalid/i.test(error.message)))) {
      throw new Error(
        `رفض Supabase Auth البريد الداخلي (${authEmailDomain()}). اضبط AUTH_EMAIL_DOMAIN في .env.local على نطاق حقيقي ` +
          'تملكه (مثل users.your-domain.sa) ثم أعد التشغيل. البريد داخلي فقط ولا يُرسل إليه شيء.',
      );
    }
    if (error || !data.user) throw error ?? new Error('createUser failed');
    authUserId = data.user.id;
  }

  const { error: insErr } = await svc.from('users').insert({
    id: authUserId,
    username,
    full_name: fields.full_name,
    role: fields.role,
    monitor_kind: fields.monitor_kind,
    substitute_for_id: fields.substitute_for_id,
    admin_scope: fields.admin_scope ?? (fields.role === 'admin' ? 'super' : 'restricted'),
  });
  if (insErr) {
    if (!orphan) await svc.auth.admin.deleteUser(authUserId);
    throw insErr;
  }
  await assignRestrooms(svc, authUserId, fields);
  return { id: authUserId, created: true, password };
}

export { newQrToken } from '../../lib/accounts';
