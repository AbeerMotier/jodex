/**
 * الصلاحيات على مستوى قاعدة البيانات (RLS): كل دور يرى نطاقه فقط، ولا كتابة مباشرة لأي دور.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, createQaWorld, retireQaWorld, serviceClient, userClient, type QaWorld } from '../support/world';

const DATE = '2041-03-04';
let world: QaWorld;
const clients: Record<string, SupabaseClient> = {};

beforeAll(async () => {
  world = await createQaWorld('RLS');
  const svc = serviceClient();
  const { error } = await svc.rpc('ensure_daily_rounds', { p_date: DATE });
  if (error) throw error;
  for (const key of ['admin', 'm1', 'm2', 'sub', 'sup', 'sup2'] as const) {
    const u = world.users[key];
    clients[key] = await userClient(u.username, u.password);
  }
});

afterAll(async () => {
  if (world) await retireQaWorld(world);
});

const qaRoomIds = () => Object.values(world.rooms).map((r) => r.id);

async function visibleRoundRooms(client: SupabaseClient) {
  const { data, error } = await client.from('rounds').select('restroom_id').eq('round_date', DATE).in('restroom_id', qaRoomIds());
  expect(error).toBeNull();
  return [...new Set((data ?? []).map((r) => r.restroom_id))].sort();
}

describe('RLS — القراءة حسب الدور والنطاق', () => {
  it('المراقب الأساسي يرى جولات دورته فقط', async () => {
    expect(await visibleRoundRooms(clients.m1)).toEqual([world.rooms.a.id]);
    expect(await visibleRoundRooms(clients.m2)).toEqual([world.rooms.b.id]);
  });

  it('النائب يرى جولات دورة المراقب الذي ينوب عنه', async () => {
    expect(await visibleRoundRooms(clients.sub)).toEqual([world.rooms.a.id]);
  });

  it('المشرف يرى المواقع المسندة إليه فقط', async () => {
    expect(await visibleRoundRooms(clients.sup)).toEqual([world.rooms.a.id, world.rooms.b.id].sort());
    expect(await visibleRoundRooms(clients.sup2)).toEqual([world.rooms.c.id]);
    const { data: rooms } = await clients.sup.from('restrooms').select('id').in('id', qaRoomIds());
    expect((rooms ?? []).map((r) => r.id).sort()).toEqual([world.rooms.a.id, world.rooms.b.id].sort());
  });

  it('الأدمن يرى الكل', async () => {
    expect(await visibleRoundRooms(clients.admin)).toEqual(qaRoomIds().sort());
    const { data: qr } = await clients.admin.from('qr_codes').select('id').in('restroom_id', qaRoomIds());
    expect(qr).toHaveLength(3);
    const { error } = await clients.admin.from('audit_log').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('غير الأدمن لا يرى تقييمات المستفيدين ولا رموز QR ولا سجل التدقيق ولا بقية المستخدمين', async () => {
    for (const key of ['m1', 'sub', 'sup'] as const) {
      const c = clients[key];
      expect((await c.from('beneficiary_feedback').select('id').limit(5)).data ?? []).toHaveLength(0);
      expect((await c.from('qr_codes').select('id').limit(5)).data ?? []).toHaveLength(0);
      expect((await c.from('audit_log').select('id').limit(5)).data ?? []).toHaveLength(0);
      expect((await c.from('bonus_approvals').select('id').limit(5)).data ?? []).toHaveLength(0);
      const { data: users } = await c.from('users').select('id');
      expect((users ?? []).map((u) => u.id)).toEqual([world.users[key].id]);
    }
  });

  it('المشرف يرى تقييماته فقط', async () => {
    const svc = serviceClient();
    const { data: ev } = await svc
      .from('supervisor_evaluations')
      .insert({ restroom_id: world.rooms.c.id, supervisor_id: world.users.sup2.id, started_at: new Date().toISOString() })
      .select('id')
      .single();
    const mine = await clients.sup2.from('supervisor_evaluations').select('id').eq('id', ev!.id);
    const other = await clients.sup.from('supervisor_evaluations').select('id').eq('id', ev!.id);
    expect(mine.data).toHaveLength(1);
    expect(other.data).toHaveLength(0);
  });

  it('الزائر المجهول (anon) لا يقرأ أي جدول إلا قائمة أسباب عدم الرضا', async () => {
    const anon = anonClient();
    const rooms = await anon.from('restrooms').select('id').limit(1);
    expect(rooms.error ?? (rooms.data ?? []).length === 0).toBeTruthy();
    const qr = await anon.from('qr_codes').select('token').limit(1);
    expect(qr.error ?? (qr.data ?? []).length === 0).toBeTruthy();
    const reasons = await anon.from('feedback_reasons').select('key');
    expect(reasons.error).toBeNull();
    expect((reasons.data ?? []).length).toBeGreaterThan(0);
  });
});

describe('RLS — لا كتابة مباشرة لأي دور (الكتابة عبر الخادم فقط)', () => {
  it('الإدراج والتعديل والحذف مرفوضة', async () => {
    for (const key of ['m1', 'sup', 'admin'] as const) {
      const c = clients[key];
      const ins = await c.from('rounds').insert({ restroom_id: world.rooms.a.id, round_date: '2041-03-05', shift: 'am', assigned_monitor_id: world.users.m1.id });
      expect(ins.error, `${key} insert`).not.toBeNull();
      const upd = await c.from('settings').update({ partial_credit_pct: 10 }).eq('id', true).select();
      expect(upd.error ?? ((upd.data ?? []).length === 0 ? null : 'updated'), `${key} update`).not.toBe('updated');
      const del = await c.from('audit_log').delete().gte('created_at', '1970-01-01').select();
      expect(del.error ?? ((del.data ?? []).length === 0 ? null : 'deleted'), `${key} delete`).not.toBe('deleted');
    }
    const svc = serviceClient();
    const { data: settings } = await svc.from('settings').select('partial_credit_pct').single();
    expect(Number(settings!.partial_credit_pct)).not.toBe(10);
  });

  it('دوال العمل الذرّية لا تُستدعى إلا من الخادم (service_role)', async () => {
    const calls: [SupabaseClient, string][] = [
      [anonClient(), 'anon'],
      [clients.m1, 'monitor'],
      [clients.admin, 'admin'],
    ];
    for (const [c, who] of calls) {
      const r1 = await c.rpc('ensure_daily_rounds', { p_date: '2041-03-06' });
      expect(r1.error, `${who} ensure_daily_rounds`).not.toBeNull();
      const r2 = await c.rpc('submit_feedback_tx', {
        p_token: world.rooms.a.token,
        p_rating: 5,
        p_reason_keys: [],
        p_other_text: null,
        p_client_hash: 'x',
        p_now: new Date().toISOString(),
        p_window_minutes: 10,
      });
      expect(r2.error, `${who} submit_feedback_tx`).not.toBeNull();
    }
  });

  it('حاوية الصور خاصة: لا تنزيل مباشر ولا رفع لأي دور', async () => {
    const svc = serviceClient();
    const key = `qa/${world.runId}/probe.jpg`;
    const up = await svc.storage.from('photos').upload(key, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg', upsert: true });
    expect(up.error).toBeNull();
    for (const c of [clients.m1, clients.admin, anonClient()]) {
      const dl = await c.storage.from('photos').download(key);
      expect(dl.error).not.toBeNull();
      const put = await c.storage.from('photos').upload(`qa/${world.runId}/x.jpg`, Buffer.from([1, 2, 3]), { contentType: 'image/jpeg' });
      expect(put.error).not.toBeNull();
    }
    const { data: bucket } = await svc.storage.getBucket('photos');
    expect(bucket?.public).toBe(false);
    await svc.storage.from('photos').remove([key]);
  });
});
