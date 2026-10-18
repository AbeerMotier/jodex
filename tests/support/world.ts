/**
 * «عالم» اختبار معزول لكل تشغيل: مبنى ودورات مياه وحسابات بأسماء فريدة،
 * تُنشأ عبر service_role بكلمات مرور عشوائية تبقى في ذاكرة الاختبار فقط،
 * وتُعطَّل في النهاية (الحسابات والمواقع ورموز QR) لأن السجلات المرسلة غير قابلة للحذف بالتصميم.
 */
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '../../lib/supabase/service';
import { newQrToken, upsertAccount } from '../../scripts/lib/accounts';
import { loadTestEnv } from './env';

export interface QaUser {
  id: string;
  username: string;
  password: string;
  name: string;
}
export interface QaRoom {
  id: string;
  code: string;
  name: string;
  floor: string;
  token: string;
  qrId: string;
}
export type RoomKey = 'a' | 'b' | 'c';
export type UserKey = 'admin' | 'm1' | 'm2' | 'm3' | 'sub' | 'sup' | 'sup2';
export interface QaWorld {
  runId: string;
  building: { id: string; name: string };
  rooms: Record<RoomKey, QaRoom>;
  users: Record<UserKey, QaUser>;
}

export function serviceClient(): SupabaseClient {
  loadTestEnv();
  return createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const must = <T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
  if (res.error || res.data === null || res.data === undefined) throw new Error(`${what}: ${res.error?.message ?? 'no data'}`);
  return res.data as NonNullable<T>;
};

export async function createQaWorld(label = 'QA'): Promise<QaWorld> {
  const svc = serviceClient();
  const runId = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  const lower = runId.toLowerCase();
  const building = must(
    await svc.from('buildings').insert({ name: `مبنى الاختبار ${label}-${runId}` }).select('id, name').single(),
    'building',
  );

  const roomDefs: [RoomKey, string, string][] = [
    ['a', 'دورة مياه الاختبار أ', 'الدور الأرضي'],
    ['b', 'دورة مياه الاختبار ب', 'الدور الأرضي'],
    ['c', 'دورة مياه الاختبار ج', 'الدور الأول'],
  ];
  const rooms = {} as Record<RoomKey, QaRoom>;
  for (const [key, name, floor] of roomDefs) {
    const code = `Q${runId}${key.toUpperCase()}`;
    const room = must(
      await svc.from('restrooms').insert({ code, name, floor_label: floor, building_id: building.id }).select('id').single(),
      `restroom ${key}`,
    );
    const token = newQrToken();
    const qr = must(await svc.from('qr_codes').insert({ restroom_id: room.id, token }).select('id').single(), `qr ${key}`);
    rooms[key] = { id: room.id, code, name, floor, token, qrId: qr.id };
  }

  const users = {} as Record<UserKey, QaUser>;
  const add = async (key: UserKey, fields: Parameters<typeof upsertAccount>[1]) => {
    const res = await upsertAccount(svc, fields);
    if (!res.password) throw new Error(`account ${fields.username} already existed`);
    users[key] = { id: res.id, username: fields.username, password: res.password, name: fields.full_name };
  };
  const base = { monitor_kind: null, substitute_for_id: null } as const;
  await add('admin', { ...base, username: `qa${lower}.admin`, full_name: 'أدمن الاختبار', role: 'admin' });
  await add('m1', { username: `qa${lower}.m1`, full_name: 'مراقب الاختبار الأول', role: 'contractor_monitor', monitor_kind: 'primary', restroom_ids: [rooms.a.id], substitute_for_id: null });
  await add('m2', { username: `qa${lower}.m2`, full_name: 'مراقب الاختبار الثاني', role: 'contractor_monitor', monitor_kind: 'primary', restroom_ids: [rooms.b.id], substitute_for_id: null });
  await add('m3', { username: `qa${lower}.m3`, full_name: 'مراقب الاختبار الثالث', role: 'contractor_monitor', monitor_kind: 'primary', restroom_ids: [rooms.c.id], substitute_for_id: null });
  await add('sub', { username: `qa${lower}.sub`, full_name: 'نائب الاختبار', role: 'contractor_monitor', monitor_kind: 'substitute', substitute_for_id: users.m1.id });
  await add('sup', { ...base, username: `qa${lower}.sup`, full_name: 'مشرف الاختبار', role: 'supervisor' });
  await add('sup2', { ...base, username: `qa${lower}.sup2`, full_name: 'مشرف الاختبار الثاني', role: 'supervisor' });

  const assign = await svc.from('supervisor_assignments').insert([
    { supervisor_id: users.sup.id, restroom_id: rooms.a.id },
    { supervisor_id: users.sup.id, restroom_id: rooms.b.id },
    { supervisor_id: users.sup2.id, restroom_id: rooms.c.id },
  ]);
  if (assign.error) throw new Error(`assignments: ${assign.error.message}`);

  return { runId, building, rooms, users };
}

/** تعطيل عالم الاختبار بعد الانتهاء (لا تبقى حسابات فعالة بكلمات مرور معروفة) */
export async function retireQaWorld(world: QaWorld) {
  const svc = serviceClient();
  const userIds = Object.values(world.users).map((u) => u.id);
  const roomIds = Object.values(world.rooms).map((r) => r.id);
  await svc.from('qr_codes').update({ is_active: false }).in('restroom_id', roomIds);
  await svc.from('users').update({ is_active: false }).in('id', userIds);
  await svc.from('restrooms').update({ is_active: false }).in('id', roomIds);
  for (const id of userIds) await svc.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  // حذف الجولات المفتوحة للمواقع المعطلة (المواءمة جزء من دالة إغلاق الجولات)
  await svc.rpc('close_overdue_rounds', { p_now: new Date().toISOString() });
}

/** عميل Supabase بصلاحيات مستخدم حقيقي (JWT) لاختبارات RLS */
export async function userClient(username: string, password: string): Promise<SupabaseClient> {
  loadTestEnv();
  const { createClient } = await import('@supabase/supabase-js');
  const svc = serviceClient();
  const { data: profile } = await svc.from('users').select('id').eq('username', username).single();
  const { data: authUser } = await svc.auth.admin.getUserById(profile!.id);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: authUser.user!.email!, password });
  if (error) throw new Error(`signIn ${username}: ${error.message}`);
  return client;
}

export function anonClient(): SupabaseClient {
  loadTestEnv();
  return createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
