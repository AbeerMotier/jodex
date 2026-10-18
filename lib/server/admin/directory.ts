import 'server-only';
import { generatePassword, internalEmail } from '@/lib/accounts';
import { ROLE_LABEL, type MonitorKind, type Role } from '@/lib/domain/catalog';
import type { UserCreateInput, UserUpdateInput } from '@/lib/domain/validation';
import type { SessionUser } from '../auth';
import { audit } from '../audit';
import { env } from '../env';
import { ApiError } from '../http';
import { createServiceClient } from '../supabase';

/** مدة الحظر في Supabase Auth للحساب المعطّل (يُرفع عند التفعيل) */
const BANNED = '876000h';

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  monitor_kind: MonitorKind | null;
  substitute_for_id: string | null;
  is_active: boolean;
  created_at: string;
}

/** رسائل قيود قاعدة البيانات بالعربية */
function dbError(message: string): ApiError {
  if (message.includes('users_username_key')) return new ApiError(409, 'username_taken', 'اسم المستخدم مستخدم مسبقًا.');
  if (message.includes('primary_has_restrooms')) {
    return new ApiError(409, 'primary_has_restrooms', 'المراقب مسؤول عن دورات مياه. انقلها لمراقب آخر أولًا.');
  }
  if (message.includes('primary_has_substitutes')) {
    return new ApiError(409, 'primary_has_substitutes', 'للمراقب نواب ينوبون عنه. غيّر نوابه أولًا.');
  }
  if (message.includes('substitute_must_reference_primary')) {
    return new ApiError(422, 'invalid_substitute', 'النائب يجب أن ينوب عن مراقب أساسي.');
  }
  if (message.includes('users_not_self_substitute')) return new ApiError(422, 'invalid_substitute', 'لا يمكن أن ينوب المراقب عن نفسه.');
  return new ApiError(500, 'server_error', 'تعذّر حفظ التعديل. حاول مرة أخرى.');
}

/** كل المستخدمين مع ما يخص كل دور (دورات المراقب، مواقع المشرف، من ينوب عنه النائب) */
export async function listUsers() {
  const svc = createServiceClient();
  const [{ data: users, error }, { data: rooms }, { data: assigns }, { data: buildings }] = await Promise.all([
    svc
      .from('users')
      .select('id, username, full_name, role, monitor_kind, substitute_for_id, is_active, created_at')
      .order('role')
      .order('full_name'),
    svc.from('restrooms').select('id, code, name, floor_label, building_id, monitor_id, is_active').order('code'),
    svc.from('supervisor_assignments').select('supervisor_id, restroom_id'),
    svc.from('buildings').select('id, name').order('name'),
  ]);
  if (error) throw new Error(error.message);
  const list = (users ?? []) as UserRow[];
  const nameOf = new Map(list.map((u) => [u.id, u.full_name]));
  const roomsOf = new Map<string, string[]>();
  for (const r of rooms ?? []) if (r.monitor_id) roomsOf.set(r.monitor_id, [...(roomsOf.get(r.monitor_id) ?? []), r.id]);
  const sitesOf = new Map<string, string[]>();
  for (const a of assigns ?? []) sitesOf.set(a.supervisor_id, [...(sitesOf.get(a.supervisor_id) ?? []), a.restroom_id]);

  return {
    users: list.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role],
      monitorKind: u.monitor_kind,
      substituteForId: u.substitute_for_id,
      substituteForName: u.substitute_for_id ? nameOf.get(u.substitute_for_id) ?? null : null,
      isActive: u.is_active,
      createdAt: u.created_at,
      restroomIds: u.role === 'contractor_monitor' && u.monitor_kind === 'primary' ? roomsOf.get(u.id) ?? [] : u.role === 'supervisor' ? sitesOf.get(u.id) ?? [] : [],
    })),
    buildings: (buildings ?? []).map((b) => ({ id: b.id as string, name: b.name as string })),
    restrooms: (rooms ?? []).map((r) => ({
      id: r.id as string,
      code: r.code as string,
      name: r.name as string,
      floor: r.floor_label as string,
      buildingId: r.building_id as string,
      monitorId: (r.monitor_id as string | null) ?? null,
      isActive: r.is_active as boolean,
    })),
  };
}

async function loadUser(id: string): Promise<UserRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'user_not_found', 'المستخدم غير موجود.');
  const { data } = await createServiceClient()
    .from('users')
    .select('id, username, full_name, role, monitor_kind, substitute_for_id, is_active, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) throw new ApiError(404, 'user_not_found', 'المستخدم غير موجود.');
  return data as UserRow;
}

async function assertPrimary(id: string) {
  const u = await loadUser(id).catch(() => null);
  if (!u || u.role !== 'contractor_monitor' || u.monitor_kind !== 'primary' || !u.is_active) {
    throw new ApiError(422, 'invalid_substitute', 'اختر مراقبًا أساسيًا نشطًا.');
  }
}

/** إنشاء حساب: كلمة مرور عشوائية تُعرض للأدمن مرة واحدة */
export async function createUser(actor: SessionUser, input: UserCreateInput) {
  const svc = createServiceClient();
  const { data: taken } = await svc.from('users').select('id').eq('username', input.username).maybeSingle();
  if (taken) throw new ApiError(409, 'username_taken', 'اسم المستخدم مستخدم مسبقًا.', { username: 'اسم المستخدم مستخدم مسبقًا.' });
  const isMonitor = input.role === 'contractor_monitor';
  const kind = isMonitor ? input.monitorKind : null;
  const substituteFor = isMonitor && kind === 'substitute' ? input.substituteForId : null;
  if (substituteFor) await assertPrimary(substituteFor);

  const password = generatePassword(12);
  const { data: created, error: authErr } = await svc.auth.admin.createUser({
    email: internalEmail(env.authEmailDomain),
    password,
    email_confirm: true,
    app_metadata: { jodex_role: input.role, jodex_username: input.username },
  });
  if (authErr || !created.user) {
    console.error('[jodex] admin createUser failed', authErr?.message);
    throw new ApiError(500, 'server_error', 'تعذّر إنشاء الحساب في خدمة الدخول. حاول مرة أخرى.');
  }
  const { error } = await svc.from('users').insert({
    id: created.user.id,
    username: input.username,
    full_name: input.fullName,
    role: input.role,
    monitor_kind: kind,
    substitute_for_id: substituteFor,
  });
  if (error) {
    await svc.auth.admin.deleteUser(created.user.id);
    throw dbError(error.message);
  }
  await audit(actor.id, 'users.create', 'users', created.user.id, { username: input.username, role: input.role, monitor_kind: kind });
  return { id: created.user.id, username: input.username, password };
}

/** تعديل الاسم أو الدور أو نوع المراقب أو التفعيل */
export async function updateUser(actor: SessionUser, id: string, input: UserUpdateInput) {
  const user = await loadUser(id);
  const svc = createServiceClient();
  if (user.id === actor.id && (input.isActive === false || (input.role && input.role !== 'admin'))) {
    throw new ApiError(409, 'self_lockout', 'لا يمكنك تعطيل حسابك أو تغيير دورك بنفسك.');
  }

  const role = input.role ?? user.role;
  const isMonitor = role === 'contractor_monitor';
  const kind = isMonitor ? (input.monitorKind !== undefined ? input.monitorKind : user.monitor_kind) : null;
  if (isMonitor && !kind) throw new ApiError(422, 'validation', 'اختر نوع المراقب (أساسي أو نائب).', { monitorKind: 'اختر نوع المراقب.' });
  const substituteFor =
    isMonitor && kind === 'substitute' ? (input.substituteForId !== undefined ? input.substituteForId : user.substitute_for_id) : null;
  if (isMonitor && kind === 'substitute') {
    if (!substituteFor) throw new ApiError(422, 'validation', 'اختر المراقب الأساسي الذي ينوب عنه.', { substituteForId: 'اختر المراقب الأساسي.' });
    if (substituteFor === user.id) throw new ApiError(422, 'invalid_substitute', 'لا يمكن أن ينوب المراقب عن نفسه.');
    await assertPrimary(substituteFor);
  }

  const patch = {
    full_name: input.fullName ?? user.full_name,
    role,
    monitor_kind: kind,
    substitute_for_id: substituteFor,
    is_active: input.isActive ?? user.is_active,
  };
  const { error } = await svc.from('users').update(patch).eq('id', user.id);
  if (error) throw dbError(error.message);

  // المشرف الذي تغيّر دوره لا تبقى له مواقع مسندة
  if (user.role === 'supervisor' && role !== 'supervisor') {
    await svc.from('supervisor_assignments').delete().eq('supervisor_id', user.id);
  }
  const authPatch: { app_metadata?: Record<string, string>; ban_duration?: string } = {};
  if (role !== user.role) authPatch.app_metadata = { jodex_role: role, jodex_username: user.username };
  if (patch.is_active !== user.is_active) authPatch.ban_duration = patch.is_active ? 'none' : BANNED;
  if (Object.keys(authPatch).length) {
    const { error: authErr } = await svc.auth.admin.updateUserById(user.id, authPatch);
    if (authErr) console.error('[jodex] admin updateUser auth sync failed', authErr.message);
  }
  await audit(actor.id, 'users.update', 'users', user.id, {
    username: user.username,
    before: { full_name: user.full_name, role: user.role, monitor_kind: user.monitor_kind, substitute_for_id: user.substitute_for_id, is_active: user.is_active },
    after: patch,
  });
  return { ok: true };
}

/** كلمة مرور جديدة عشوائية تُعرض للأدمن مرة واحدة، ويُفك أي قفل دخول */
export async function resetUserPassword(actor: SessionUser, id: string) {
  const user = await loadUser(id);
  const svc = createServiceClient();
  const password = generatePassword(12);
  const { error } = await svc.auth.admin.updateUserById(user.id, { password, ...(user.is_active ? { ban_duration: 'none' } : {}) });
  if (error) {
    console.error('[jodex] admin resetPassword failed', error.message);
    throw new ApiError(500, 'server_error', 'تعذّر تغيير كلمة المرور. حاول مرة أخرى.');
  }
  await svc.from('login_attempts').delete().eq('username', user.username);
  await audit(actor.id, 'users.reset_password', 'users', user.id, { username: user.username });
  return { username: user.username, password };
}

/**
 * ربط دورات المياه بالمستخدم حسب دوره:
 * المراقب الأساسي = دورات المياه المسؤول عنها (تُنزع من مسؤولها السابق)،
 * المشرف الميداني = المواقع التي يقيّمها.
 */
export async function setUserRestrooms(actor: SessionUser, id: string, restroomIds: string[]) {
  const user = await loadUser(id);
  const svc = createServiceClient();
  const ids = [...new Set(restroomIds)];
  if (ids.length) {
    const { data: found, error } = await svc.from('restrooms').select('id').in('id', ids);
    if (error) throw new Error(error.message);
    if ((found ?? []).length !== ids.length) throw new ApiError(422, 'validation', 'بعض دورات المياه غير موجودة.');
  }

  if (user.role === 'contractor_monitor' && user.monitor_kind === 'primary') {
    const { data: current } = await svc.from('restrooms').select('id').eq('monitor_id', user.id);
    const keep = new Set(ids);
    const removed = (current ?? []).map((r) => r.id as string).filter((rid) => !keep.has(rid));
    if (removed.length) {
      const { error } = await svc.from('restrooms').update({ monitor_id: null }).in('id', removed);
      if (error) throw new Error(error.message);
    }
    if (ids.length) {
      const { error } = await svc.from('restrooms').update({ monitor_id: user.id }).in('id', ids);
      if (error) throw new Error(error.message);
    }
    await audit(actor.id, 'users.assign_restrooms', 'users', user.id, { username: user.username, restroom_ids: ids, removed });
    return { count: ids.length };
  }

  if (user.role === 'supervisor') {
    const { error: delErr } = await svc.from('supervisor_assignments').delete().eq('supervisor_id', user.id);
    if (delErr) throw new Error(delErr.message);
    if (ids.length) {
      const { error } = await svc.from('supervisor_assignments').insert(ids.map((rid) => ({ supervisor_id: user.id, restroom_id: rid })));
      if (error) throw new Error(error.message);
    }
    await audit(actor.id, 'users.assign_sites', 'users', user.id, { username: user.username, restroom_ids: ids });
    return { count: ids.length };
  }

  throw new ApiError(422, 'not_assignable', 'الربط بدورات المياه للمراقب الأساسي والمشرف الميداني فقط.');
}
