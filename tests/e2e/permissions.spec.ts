/**
 * الصلاحيات: كل دور يُرفض على endpoints وصفحات الأدوار الأخرى وعلى المواقع غير المسندة،
 * مع CSRF وقفل الدخول بعد محاولات فاشلة متكررة.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Api, at, browserAs, closeAll, monitorToday, roundOf, world } from './helpers';

const DAY = '2042-09-01';
const NOW = at(DAY, '09:00');

type RoleKey = 'anon' | 'm1' | 'sub' | 'sup' | 'admin';
const sessions = {} as Record<RoleKey, Api>;

test.beforeAll(async () => {
  const w = world();
  sessions.anon = await Api.anonymous({ at: NOW });
  sessions.m1 = await Api.as(w.users.m1, NOW);
  sessions.sub = await Api.as(w.users.sub, NOW);
  sessions.sup = await Api.as(w.users.sup, NOW);
  sessions.admin = await Api.as(w.users.admin, NOW);
});

test.afterAll(async () => {
  await closeAll(...Object.values(sessions));
});

const READS: { path: string; allowed: RoleKey[] }[] = [
  { path: '/api/monitor/today', allowed: ['m1', 'sub'] },
  { path: '/api/supervisor/sites', allowed: ['sup'] },
  { path: '/api/admin/dashboard?period=today', allowed: ['admin'] },
  { path: '/api/admin/log?period=today', allowed: ['admin'] },
  { path: '/api/admin/feedback?period=today', allowed: ['admin'] },
  { path: '/api/admin/notes?period=today', allowed: ['admin'] },
  { path: '/api/admin/staff?period=today', allowed: ['admin'] },
  { path: '/api/admin/qr', allowed: ['admin'] },
  { path: '/api/admin/settings', allowed: ['admin'] },
  { path: '/api/admin/filters', allowed: ['admin'] },
  { path: '/api/admin/sidebar?period=today', allowed: ['admin'] },
  { path: '/api/admin/export?report=log&format=xlsx&period=today', allowed: ['admin'] },
];

test('مصفوفة الصلاحيات لنقاط القراءة: 401 للزائر، 403 للأدوار الأخرى، 200 للدور المخوّل', async () => {
  for (const { path, allowed } of READS) {
    for (const role of Object.keys(sessions) as RoleKey[]) {
      const res = await sessions[role].get(path);
      const expected = role === 'anon' ? 401 : allowed.includes(role) ? 200 : 403;
      expect(res.status(), `${role} GET ${path}`).toBe(expected);
    }
  }
});

test('نقاط الكتابة مرفوضة لغير الدور المخوّل قبل أي معالجة', async () => {
  const w = world();
  const am = roundOf(await monitorToday(sessions.m1), 'am');
  const writes: { method: 'post' | 'put'; path: string; body: unknown; allowed: RoleKey[] }[] = [
    { method: 'post', path: `/api/monitor/rounds/${am.id}/submit`, body: { answers: {}, idempotencyKey: randomUUID() }, allowed: ['m1', 'sub'] },
    { method: 'put', path: `/api/monitor/rounds/${am.id}/draft`, body: { answers: {}, note: '' }, allowed: ['m1', 'sub'] },
    { method: 'post', path: '/api/supervisor/evaluations/start', body: { restroomId: w.rooms.a.id }, allowed: ['sup'] },
    { method: 'put', path: '/api/admin/settings', body: { partialCreditPct: 'x' }, allowed: ['admin'] },
    { method: 'post', path: `/api/admin/bonus/${w.users.m1.id}`, body: { period: 'nope' }, allowed: ['admin'] },
  ];
  for (const wr of writes) {
    for (const role of Object.keys(sessions) as RoleKey[]) {
      const res = await sessions[role][wr.method](wr.path, wr.body);
      if (role === 'anon') expect(res.status(), `${role} ${wr.path}`).toBe(401);
      else if (!wr.allowed.includes(role)) expect(res.status(), `${role} ${wr.path}`).toBe(403);
      else expect([200, 201, 409, 422], `${role} ${wr.path}`).toContain(res.status());
    }
  }
});

test('النطاق: المراقب لا يصل إلى جولات دورة أخرى، والمشرف لا يقيّم موقعًا غير مسند', async () => {
  const w = world();
  const m2 = await Api.as(w.users.m2, NOW);
  const sup2 = await Api.as(w.users.sup2, NOW);
  try {
    const am = roundOf(await monitorToday(sessions.m1), 'am');
    expect((await m2.post(`/api/monitor/rounds/${am.id}/submit`, { answers: {}, idempotencyKey: randomUUID() })).status()).toBe(404);
    expect((await m2.put(`/api/monitor/rounds/${am.id}/draft`, { answers: {}, note: '' })).status()).toBe(404);

    // النائب يعمل على دورة المراقب الذي ينوب عنه فقط
    const subToday = await monitorToday(sessions.sub);
    expect(subToday.restroom.name).toBe(w.rooms.a.name);
    expect(subToday.onBehalfOf).toBe(w.users.m1.name);

    for (const [api, room] of [
      [sessions.sup, w.rooms.c],
      [sup2, w.rooms.a],
    ] as const) {
      const start = await api.post('/api/supervisor/evaluations/start', { restroomId: room.id });
      expect(start.status()).toBe(403);
      expect((await api.get(`/api/supervisor/sites/${room.id}/contractor-rounds`)).status()).toBe(403);
    }
    const sites = await sessions.sup.json<{ sites: { id: string }[] }>(sessions.sup.get('/api/supervisor/sites'));
    expect(sites.sites.map((s) => s.id).sort()).toEqual([w.rooms.a.id, w.rooms.b.id].sort());
  } finally {
    await closeAll(m2, sup2);
  }
});

test('CSRF: الطلب المعدِّل بلا رمز أو من أصل آخر يُرفض', async () => {
  const w = world();
  const api = sessions.sup;
  const noToken = await api.ctx.post('/api/supervisor/evaluations/start', { data: { restroomId: w.rooms.a.id }, headers: { 'x-jodex-test-now': NOW } });
  expect(noToken.status()).toBe(403);
  const foreign = await api.ctx.post('/api/supervisor/evaluations/start', {
    data: { restroomId: w.rooms.a.id },
    headers: { ...api.headers(), origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);
});

test('الصفحات: إعادة توجيه للدخول، وصفحة «غير مصرح» لدور آخر', async ({ browser }) => {
  const w = world();
  const anon = await browserAs(browser, null, NOW);
  try {
    await anon.page.goto('/monitor');
    await expect(anon.page).toHaveURL(/\/login\?next=%2Fmonitor/);
    await anon.page.goto('/admin/settings');
    await expect(anon.page).toHaveURL(/\/login\?next=%2Fadmin%2Fsettings/);
  } finally {
    await closeAll(anon.context);
  }

  const cases: [keyof typeof w.users, string[], string][] = [
    ['m1', ['/admin', '/supervisor', '/admin/qr'], '/monitor'],
    ['sup', ['/monitor', '/admin/settings'], '/supervisor'],
    ['admin', ['/monitor', '/supervisor'], '/admin'],
  ];
  for (const [key, denied, home] of cases) {
    const s = await browserAs(browser, w.users[key], NOW);
    try {
      await expect(s.page).toHaveURL(new RegExp(`${home}(\\?|$)`));
      for (const path of denied) {
        const res = await s.page.goto(path);
        expect(res?.status(), `${key} ${path}`).toBe(403);
        await expect(s.page.getByTestId('forbidden')).toBeVisible();
      }
      expect(s.errors).toEqual([]);
    } finally {
      await closeAll(s.context);
    }
  }
});

test('الدخول: رسالة عامة للخطأ، وقفل مؤقت بعد 5 محاولات فاشلة ثم السماح بعد 15 دقيقة', async () => {
  const w = world();
  const t0 = at('2042-09-02', '08:00');
  const api = await Api.anonymous({ at: t0 });
  try {
    const unknown = await api.post('/api/auth/login', { username: 'no-such-user-qa', password: 'Wrong-Password-1' });
    const wrong = await api.post('/api/auth/login', { username: w.users.m3.username, password: 'Wrong-Password-1' });
    expect(unknown.status()).toBe(401);
    expect(wrong.status()).toBe(401);
    const m1 = (await unknown.json()).error.message;
    expect((await wrong.json()).error.message).toBe(m1); // لا يكشف وجود الحساب
    for (let i = 0; i < 4; i++) await api.post('/api/auth/login', { username: w.users.m3.username, password: 'Wrong-Password-1' });
    const locked = await api.post('/api/auth/login', { username: w.users.m3.username, password: w.users.m3.password });
    expect(locked.status()).toBe(423);
    api.at = at('2042-09-02', '08:16');
    const ok = await api.post('/api/auth/login', { username: w.users.m3.username.toUpperCase(), password: w.users.m3.password });
    expect(ok.status()).toBe(200);
  } finally {
    await api.dispose();
  }
});
