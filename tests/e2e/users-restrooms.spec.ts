/**
 * إدارة الأدمن: المستخدمون (إنشاء/تعديل/تعطيل/كلمة مرور جديدة)، المباني ودورات المياه،
 * وربط المراقب بدورات المياه المسؤول عنها (ومن ثم نائبه)، ومواقع المشرف الميداني.
 * يعمل على بيانات خاصة به (مبنى ودورات وحسابات جديدة) ويعطّلها في النهاية.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceClient } from '../support/world';
import { Api, browserAs, closeAll, world } from './helpers';

const run = randomUUID().slice(0, 6);
let admin: Api;

interface Created {
  id: string;
  username: string;
  password: string;
}
interface Places {
  buildings: { id: string; name: string }[];
  restrooms: { id: string; code: string; monitorId: string | null; isActive: boolean }[];
}

const createdUsers: string[] = [];
const createdRooms: string[] = [];

test.beforeAll(async () => {
  admin = await Api.as(world().users.admin);
});
test.afterAll(async () => {
  const svc = serviceClient();
  if (createdRooms.length) await svc.from('restrooms').update({ is_active: false, monitor_id: null }).in('id', createdRooms);
  if (createdUsers.length) await svc.from('users').update({ is_active: false }).in('id', createdUsers);
  await closeAll(admin);
});

async function createUser(body: Record<string, unknown>): Promise<Created> {
  const res = await admin.json<Created>(admin.post('/api/admin/users', body));
  createdUsers.push(res.id);
  expect(res.password.length).toBeGreaterThanOrEqual(12);
  return res;
}

async function loginStatus(username: string, password: string) {
  const anon = await Api.anonymous();
  const res = await anon.post('/api/auth/login', { username, password });
  const status = res.status();
  await anon.dispose();
  return status;
}

test('الأدمن ينشئ المبنى ودورات المياه والحسابات، ويربط المراقب بدوراته فيراها هو ونائبه', async () => {
  // مبنى ودورتا مياه (كل دورة جديدة لها رمز QR فعّال)
  const building = await admin.json<{ id: string }>(admin.post('/api/admin/buildings', { name: `مبنى الإدارة ${run}` }));
  const codes = [`QA-${run.toUpperCase()}-0001`, `QA-${run.toUpperCase()}-M01`];
  const roomIds: string[] = [];
  for (const [i, code] of codes.entries()) {
    const r = await admin.json<{ id: string }>(
      admin.post('/api/admin/restrooms', { code: code.toLowerCase(), name: `دورة مياه رقم ${i + 1} رجال`, floor: i ? 'دور الميزانين' : 'الدور الأرضي', buildingId: building.id }),
    );
    roomIds.push(r.id);
    createdRooms.push(r.id);
  }
  const { data: qrs } = await serviceClient().from('qr_codes').select('restroom_id').in('restroom_id', roomIds).eq('is_active', true);
  expect(qrs).toHaveLength(2);
  // الترميز يُحفظ بأحرف كبيرة، والمكرر مرفوض
  const places = await admin.json<Places>(admin.get('/api/admin/restrooms'));
  expect(places.restrooms.filter((r) => roomIds.includes(r.id)).map((r) => r.code).sort()).toEqual([...codes].sort());
  await admin.json(admin.post('/api/admin/restrooms', { code: codes[0], name: 'مكرر', floor: 'الأول', buildingId: building.id }), 409);
  await admin.json(admin.post('/api/admin/restrooms', { code: 'رمز عربي', name: 'خطأ', floor: 'الأول', buildingId: building.id }), 422);

  // مراقب أساسي جديد ← يدخل بكلمة المرور المعروضة مرة واحدة، ولا دورات له بعد
  const primary = await createUser({ username: `qa${run}.mon`, fullName: 'مراقب الإدارة', role: 'contractor_monitor', monitorKind: 'primary' });
  const mon = await Api.as({ id: primary.id, username: primary.username, password: primary.password, name: '' });
  expect((await mon.get('/api/monitor/today')).status()).toBe(409);

  // ربط المراقب بالدورتين ← يراهما في صفحته
  await admin.json(admin.put(`/api/admin/users/${primary.id}/restrooms`, { restroomIds: roomIds }));
  const today = await mon.json<{ restrooms: { id: string }[] }>(mon.get('/api/monitor/today'));
  expect(today.restrooms.map((r) => r.id).sort()).toEqual([...roomIds].sort());

  // نائب عنه ← يعمل على نفس الدورات
  const sub = await createUser({ username: `qa${run}.sub`, fullName: 'نائب الإدارة', role: 'contractor_monitor', monitorKind: 'substitute', substituteForId: primary.id });
  const subApi = await Api.as({ id: sub.id, username: sub.username, password: sub.password, name: '' });
  const subToday = await subApi.json<{ restrooms: { id: string }[]; onBehalfOf: string | null }>(subApi.get('/api/monitor/today'));
  expect(subToday.restrooms).toHaveLength(2);
  expect(subToday.onBehalfOf).toBe('مراقب الإدارة');

  // إلغاء إسناد دورة من صفحة دورات المياه ← تختفي من صفحة المراقب
  await admin.json(admin.post('/api/admin/restrooms/assign', { restroomIds: [roomIds[1]], monitorId: null }));
  expect((await mon.json<{ restrooms: unknown[] }>(mon.get('/api/monitor/today'))).restrooms).toHaveLength(1);

  // لا يُحوَّل مراقب أساسي له دورات أو نواب إلى دور آخر
  const blocked = await admin.json<{ error: { code: string } }>(admin.ctx.patch(`/api/admin/users/${primary.id}`, { headers: admin.headers(), data: { role: 'supervisor' } }), 409);
  expect(['primary_has_restrooms', 'primary_has_substitutes']).toContain(blocked.error.code);

  // مشرف ميداني ← مواقعه = ما يحدده الأدمن
  const sup = await createUser({ username: `qa${run}.sup`, fullName: 'مشرف الإدارة', role: 'supervisor' });
  await admin.json(admin.put(`/api/admin/users/${sup.id}/restrooms`, { restroomIds: [roomIds[0]] }));
  const supApi = await Api.as({ id: sup.id, username: sup.username, password: sup.password, name: '' });
  const sites = await supApi.json<{ sites: { id: string }[] }>(supApi.get('/api/supervisor/sites'));
  expect(sites.sites.map((s) => s.id)).toEqual([roomIds[0]]);

  // كلمة مرور جديدة: القديمة تتوقف والجديدة تعمل
  const reset = await admin.json<{ password: string }>(admin.post(`/api/admin/users/${sup.id}/password`));
  expect(await loginStatus(sup.username, sup.password)).toBe(401);
  expect(await loginStatus(sup.username, reset.password)).toBe(200);

  // التعطيل يمنع الدخول، والتفعيل يعيده
  await admin.json(admin.ctx.patch(`/api/admin/users/${sup.id}`, { headers: admin.headers(), data: { isActive: false } }));
  expect(await loginStatus(sup.username, reset.password)).toBe(401);
  await admin.json(admin.ctx.patch(`/api/admin/users/${sup.id}`, { headers: admin.headers(), data: { isActive: true, fullName: 'مشرف الإدارة المعدّل' } }));
  expect(await loginStatus(sup.username, reset.password)).toBe(200);

  // اسم مستخدم مكرر مرفوض، والأدمن لا يعطّل نفسه
  await admin.json(admin.post('/api/admin/users', { username: `qa${run}.sup`, fullName: 'مكرر', role: 'admin' }), 409);
  await admin.json(admin.ctx.patch(`/api/admin/users/${world().users.admin.id}`, { headers: admin.headers(), data: { isActive: false } }), 409);

  await closeAll(mon, subApi, supApi);
});

test('صلاحيات الإدارة للأدمن فقط', async () => {
  const w = world();
  for (const user of [w.users.m1, w.users.sup]) {
    const api = await Api.as(user);
    expect((await api.get('/api/admin/users')).status()).toBe(403);
    expect((await api.post('/api/admin/users', { username: `qa${run}.x`, fullName: 'محاولة', role: 'admin' })).status()).toBe(403);
    expect((await api.post('/api/admin/restrooms/assign', { restroomIds: [w.rooms.a.id], monitorId: w.users.m1.id })).status()).toBe(403);
    await api.dispose();
  }
});

test('الواجهة: إضافة مستخدم تعرض كلمة المرور مرة واحدة، وتغيير المراقب المسؤول من صفحة دورات المياه', async ({ browser }) => {
  const w = world();
  const { context, page, errors } = await browserAs(browser, w.users.admin, null);
  await page.goto('/admin/users');
  await page.getByTestId('user-add').click();
  await page.getByTestId('user-username').fill(`qa${run}.ui`);
  await page.getByTestId('user-fullname').fill('موظف الواجهة');
  await page.getByTestId('user-role').selectOption('supervisor');
  await page.getByTestId('user-save').click();
  await expect(page.getByTestId('password-dialog')).toBeVisible();
  const password = (await page.getByTestId('new-password').innerText()).trim();
  expect(password.length).toBeGreaterThanOrEqual(12);
  const { data: created } = await serviceClient().from('users').select('id, role').eq('username', `qa${run}.ui`).single();
  createdUsers.push(created!.id);
  expect(created!.role).toBe('supervisor');
  await page.getByRole('button', { name: 'تم' }).click();
  await expect(page.getByTestId(`user-row-qa${run}.ui`)).toBeVisible();

  // صفحة دورات المياه: إسناد دورة الاختبار ب إلى m1 ثم إعادتها إلى m2
  await page.goto('/admin/restrooms');
  const select = page.getByTestId(`room-monitor-${w.rooms.b.code}`);
  await expect(select).toBeVisible();
  await select.selectOption(w.users.m1.id);
  await expect.poll(async () => (await serviceClient().from('restrooms').select('monitor_id').eq('id', w.rooms.b.id).single()).data?.monitor_id).toBe(w.users.m1.id);
  await select.selectOption(w.users.m2.id);
  await expect.poll(async () => (await serviceClient().from('restrooms').select('monitor_id').eq('id', w.rooms.b.id).single()).data?.monitor_id).toBe(w.users.m2.id);
  expect(errors).toEqual([]);
  await closeAll(context);
});
