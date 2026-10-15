/** أدوات مشتركة لإنشاء الحسابات في Supabase Auth وربطها بجدول users */
import { randomBytes, randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authEmailDomain } from './env';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '-_.!@#';

/** كلمة مرور عشوائية قوية (16 حرفًا) — لا كلمات مرور ثابتة إطلاقًا */
export function generatePassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGITS[randomInt(DIGITS.length)],
    SYMBOLS[randomInt(SYMBOLS.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** بريد داخلي عشوائي غير قابل للتخمين يربط الحساب في Supabase Auth (الدخول باسم المستخدم فقط) */
export function internalEmail(): string {
  return `u-${randomBytes(10).toString('hex')}@${authEmailDomain()}`;
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
  role: 'admin' | 'supervisor' | 'contractor_monitor';
  monitor_kind: 'primary' | 'substitute' | null;
  restroom_id: string | null;
  substitute_for_id: string | null;
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
        restroom_id: fields.restroom_id,
        substitute_for_id: fields.substitute_for_id,
      })
      .eq('id', existing.id);
    if (error) throw error;
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
    if (error || !data.user) throw error ?? new Error('createUser failed');
    authUserId = data.user.id;
  }

  const { error: insErr } = await svc.from('users').insert({
    id: authUserId,
    username,
    full_name: fields.full_name,
    role: fields.role,
    monitor_kind: fields.monitor_kind,
    restroom_id: fields.restroom_id,
    substitute_for_id: fields.substitute_for_id,
  });
  if (insErr) {
    if (!orphan) await svc.auth.admin.deleteUser(authUserId);
    throw insErr;
  }
  return { id: authUserId, created: true, password };
}

export function newQrToken(): string {
  // 24 بايت = 192 بت عشوائية (≥ 128 بت)، بترميز آمن للروابط
  return randomBytes(24).toString('base64url');
}
