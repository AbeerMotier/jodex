/**
 * تعديلات الجهة (أكتوبر 2026): الصلاحيات لكل دور، نوافذ الجولات، مؤشر رضا المستفيدين بالأوزان،
 * منع إعادة التقييم 24 ساعة، الترميز في الصفحات، رمز QR بالترميز فقط، صورة العمالة بالكاميرا فقط،
 * صفحة المشرف وبنوده، واستبعاد «جولة غير مطابقة» من أداء المتميزين.
 */
import { randomUUID } from 'node:crypto';
import { chromium, expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { cameraJpeg, galleryJpeg, jpegWithGps } from '../support/images';
import { addDays, answersFor, Api, at, BASE, browserAs, clockHeaders, closeAll, evaluateSite, freshIp, monitorToday, roundOf, submitRound, uploadRequiredPhotos, world } from './helpers';

test.describe.configure({ mode: 'serial' });

// تواريخ مستقلة عن بقية الملفات
const D_WIN = '2042-02-03';
const D_FB = '2042-02-10';
const D_PERF = '2042-02-17';

test('الأدمن المحدود: يستخدم صفحات الأدمن عدا المستخدمين والصلاحيات والمباني ودورات المياه والإعدادات والأوزان (الخادم والصفحات)', async ({ browser }) => {
  const w = world();
  const lim = await Api.as(w.users.lim);
  // مسموح
  for (const path of ['/api/admin/dashboard?period=week', '/api/admin/log?period=week', '/api/admin/feedback?period=week', '/api/admin/notes?period=week', '/api/admin/staff?period=week', '/api/admin/qr', '/api/admin/filters', '/api/admin/sidebar?period=week']) {
    expect((await lim.get(path)).status(), path).toBe(200);
  }
  // ممنوع على مستوى الخادم (لا مجرد إخفاء الروابط)
  for (const path of ['/api/admin/users', '/api/admin/restrooms', '/api/admin/settings']) {
    const res = await lim.get(path);
    expect(res.status(), path).toBe(403);
  }
  expect((await lim.post('/api/admin/users', { username: `x${randomUUID().slice(0, 6)}`, fullName: 'محاولة', role: 'admin' })).status()).toBe(403);
  expect((await lim.post('/api/admin/buildings', { name: 'مبنى محظور' })).status()).toBe(403);
  expect((await lim.put(`/api/admin/users/${w.users.m1.id}/restrooms`, { restroomIds: [] })).status()).toBe(403);
  expect((await lim.post(`/api/admin/users/${w.users.m1.id}/password`, {})).status()).toBe(403);
  expect((await lim.put('/api/admin/settings', { partialCreditPct: 50, deepCleanWeekday: 1, items: [] })).status()).toBe(403);
  expect((await lim.post('/api/admin/restrooms/assign', { restroomIds: [w.rooms.a.id], monitorId: null })).status()).toBe(403);
  await lim.dispose();

  const { context, page } = await browserAs(browser, w.users.lim, null);
  await page.goto('/admin');
  const nav = page.getByTestId('admin-sidebar');
  await expect(nav.getByRole('link', { name: 'سجل الجولات' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'المستخدمون والصلاحيات' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'المباني ودورات المياه' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'الإعدادات والأوزان' })).toHaveCount(0);
  for (const path of ['/admin/users', '/admin/restrooms', '/admin/settings']) {
    await page.goto(path);
    await expect(page.getByTestId('forbidden'), path).toBeVisible();
  }
  await page.goto('/admin/rounds?period=week');
  await expect(page.getByTestId('log-table')).toBeVisible();
  await context.close();
});

test('المقاول: يرى دورات المياه المسندة إليه للعرض فقط، ولا يصل لصفحات ووظائف الأدوار الأخرى', async ({ browser }) => {
  const w = world();
  const con = await Api.as(w.users.con);
  const data = await con.json<{ restrooms: { id: string; code: string; name: string; monitor: string }[] }>(con.get('/api/contractor/restrooms'));
  expect(data.restrooms.filter((r) => Object.values(w.rooms).some((x) => x.id === r.id)).map((r) => r.code).sort()).toEqual([w.rooms.a.code, w.rooms.c.code].sort());
  for (const path of ['/api/monitor/today', '/api/supervisor/sites', '/api/admin/dashboard', '/api/admin/users']) {
    expect((await con.get(path)).status(), path).toBe(403);
  }
  expect((await con.post('/api/supervisor/evaluations/start', { restroomId: w.rooms.a.id })).status()).toBe(403);
  expect((await con.put(`/api/admin/users/${w.users.con.id}/restrooms`, { restroomIds: [w.rooms.b.id] })).status()).toBe(403);
  await con.dispose();
  // الأدوار الأخرى لا تصل لصفحة المقاول
  const mon = await Api.as(w.users.m1);
  expect((await mon.get('/api/contractor/restrooms')).status()).toBe(403);
  await mon.dispose();

  const { context, page } = await browserAs(browser, w.users.con, null);
  expect(new URL(page.url()).pathname).toBe('/contractor');
  const table = page.getByTestId('contractor-table');
  await expect(table).toBeVisible();
  await expect(table.getByText(w.rooms.a.code)).toBeVisible();
  await expect(table.getByText(w.rooms.b.code)).toHaveCount(0);
  // للعرض فقط: لا أزرار ولا روابط ولا حقول اختيار داخل الجدول
  await expect(table.locator('button, a, select, input')).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await page.goto('/monitor');
  await expect(page.getByTestId('forbidden')).toBeVisible();
  await context.close();

  // الأدمن يسند للمقاول من «المستخدمون والصلاحيات»
  const admin = await Api.as(w.users.admin);
  await admin.json(admin.put(`/api/admin/users/${w.users.con.id}/restrooms`, { restroomIds: [w.rooms.a.id, w.rooms.b.id, w.rooms.c.id] }));
  const con2 = await Api.as(w.users.con);
  const after = await con2.json<{ restrooms: { id: string }[] }>(con2.get('/api/contractor/restrooms'));
  expect(after.restrooms.filter((r) => Object.values(w.rooms).some((x) => x.id === r.id))).toHaveLength(3);
  await admin.json(admin.put(`/api/admin/users/${w.users.con.id}/restrooms`, { restroomIds: [w.rooms.a.id, w.rooms.c.id] }));
  await closeAll(admin, con2);
});

test('نوافذ الجولات: الصباحية 07:30–10:00 والمسائية 12:00–14:30، والبدء والإرسال مرفوضان خارجها (الخادم والواجهة)', async ({ browser }) => {
  const w = world();
  const api = await Api.as(w.users.m2, at(D_WIN, '07:29'));
  let data = await monitorToday(api);
  const am = roundOf(data, 'am');
  const pm = roundOf(data, 'pm');
  // قبل البداية: لا مسودة ولا صور ولا إرسال
  expect((await api.put(`/api/monitor/rounds/${am.id}/draft`, { answers: {}, note: '' })).status()).toBe(409);
  const early = await api.upload(`/api/monitor/rounds/${am.id}/photos/tools`, await jpegWithGps(1));
  expect(early.status()).toBe(409);
  expect((await early.json()).error.code).toBe('round_not_open');
  const earlySubmit = await submitRound(api, am.id, answersFor(data, 'done'));
  expect((await earlySubmit.json()).error.code).toBe('round_not_open');

  // 07:30 داخل النافذة: يعمل
  api.at = at(D_WIN, '07:30');
  await api.json(api.put(`/api/monitor/rounds/${am.id}/draft`, { answers: {}, note: 'بدء' }));
  await uploadRequiredPhotos(api, am.id);
  // 10:01 بعد النافذة: الإرسال مرفوض والجولة فائتة
  api.at = at(D_WIN, '10:01');
  const late = await submitRound(api, am.id, answersFor(data, 'done'));
  expect(late.status()).toBe(409);
  data = await monitorToday(api);
  expect(roundOf(data, 'am').status).toBe('missed');

  // المسائية: 11:59 مرفوضة، 12:00–14:30 مسموحة
  api.at = at(D_WIN, '11:59');
  expect((await api.put(`/api/monitor/rounds/${pm.id}/draft`, { answers: {}, note: '' })).status()).toBe(409);
  api.at = at(D_WIN, '12:00');
  await uploadRequiredPhotos(api, pm.id);
  api.at = at(D_WIN, '14:30');
  const ok = await api.json<{ complianceLevel: string }>(submitRound(api, pm.id, answersFor(data, 'done')));
  expect(ok.complianceLevel).toBe('full');
  await api.dispose();

  // الواجهة قبل النافذة: رسالة بالوقت ولا نموذج (يوم آخر لم تُغلق جولاته بعد)
  const { context, page } = await browserAs(browser, w.users.m3, at(addDays(D_WIN, 3), '07:00'));
  await page.goto('/monitor');
  await expect(page.getByTestId('round-window-closed')).toContainText('07:30');
  await expect(page.getByTestId('round-window-closed')).toContainText('10:00');
  await expect(page.getByTestId('submit-round')).toHaveCount(0);
  await expect(page.getByTestId('shift-window-pm')).toHaveText('12:00–14:30');
  await context.close();
});

test('صورة العمالة إلزامية وبالكاميرا فقط: الخادم يرفض الصورة المحفوظة، والواجهة بلا رفع ملف وتعرض التعليمات ثم تلتقط من الكاميرا', async () => {
  const w = world();
  const date = addDays(D_WIN, 1);
  const api = await Api.as(w.users.m3, at(date, '08:00'));
  const data = await monitorToday(api);
  const am = roundOf(data, 'am');
  const url = `/api/monitor/rounds/${am.id}/photos/labor`;
  // بلا إعلان الالتقاط المباشر، أو بصورة معرض قديمة، أو HEIC/ملف عادي ← مرفوض
  for (const res of [
    await api.upload(url, await cameraJpeg()),
    await api.upload(url, await galleryJpeg(), 'IMG_0001.jpg', 'image/jpeg', { source: 'camera' }),
    await api.upload(url, await galleryJpeg(), 'IMG_0001.jpg', 'image/jpeg', { source: 'gallery' }),
  ]) {
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('camera_only');
  }
  // بقية الصور بلا «العمالة» ← الإرسال مرفوض لنقص الصورة الإلزامية
  await uploadRequiredPhotos(api, am.id, ['tools', 'entry', 'sinks', 'general']);
  const missing = await submitRound(api, am.id, answersFor(data, 'done'));
  expect(missing.status()).toBe(422);
  expect((await missing.json()).error.missingPhotos).toEqual(['labor']);
  // «المراحيض» لم تعد خانة
  expect((await api.upload(`/api/monitor/rounds/${am.id}/photos/toilets`, await jpegWithGps(2))).status()).toBe(404);
  await api.dispose();

  // متصفح بكاميرا (جهاز وهمي): لا حقل ملف لخانة العمالة، التعليمات أولًا، ثم الالتقاط والرفع
  const cam = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await cam.newContext({
    baseURL: BASE(),
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 420, height: 900 },
    permissions: ['camera'],
    extraHTTPHeaders: { ...clockHeaders(at(date, '08:05')), 'x-forwarded-for': freshIp() },
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.fill('input[name=username]', w.users.m3.username);
  await page.fill('input[name=password]', w.users.m3.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);
  await page.goto('/monitor');
  await page.getByTestId('shift-am').click();
  const labor = page.getByTestId('photo-labor');
  await expect(labor).toContainText('التقاط بالكاميرا');
  await expect(page.getByTestId('photo-input-labor')).toHaveCount(0);
  await expect(page.getByTestId('photo-input-tools')).toHaveCount(1);
  await labor.getByTestId('photo-camera-labor').click();
  const guide = page.getByTestId('camera-guide');
  await expect(guide).toContainText('عموديًا');
  await expect(guide).toContainText('الإضاءة');
  await expect(guide.getByText('صحيحة: عمودية وواضحة')).toBeVisible();
  await expect(guide.getByText('خاطئة: أفقية')).toBeVisible();
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('camera-shoot')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('camera-shoot').click();
  await page.getByTestId('camera-accept').click();
  await expect(labor.locator('button[aria-label="عرض صورة العمالة"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('photos-progress')).toHaveText('5 من 5 صور إلزامية');
  await context.close();
  await cam.close();
});

test('مؤشر رضا المستفيدين بالأوزان (60/30/10) في لوحة المؤشرات مع طريقة الاحتساب، ويتغير تلقائيًا', async ({ browser }) => {
  const w = world();
  const ref = w.rooms.c.code;
  const rate = async (rating: 'excellent' | 'good' | 'bad', time: string) => {
    const anon = await Api.anonymous({ at: at(D_FB, time) });
    const res = await anon.post(`/api/public/r/${ref}/feedback`, { rating, reasons: rating === 'bad' ? ['odors'] : [], otherText: '' });
    expect(res.status(), await res.text()).toBe(201);
    await anon.dispose();
  };
  await rate('excellent', '09:00');
  await rate('excellent', '09:01');
  await rate('good', '09:02');
  await rate('bad', '09:03');
  const admin = await Api.as(w.users.admin, at(D_FB, '18:00'));
  const query = `/api/admin/dashboard?period=today&source=beneficiary&restroom=${w.rooms.c.id}`;
  let d = await admin.json<{ quality: { beneficiary: { value: number; counts: { total: number } } } }>(admin.get(query));
  // (2×60 + 1×30 + 1×10) ÷ (4×60) × 100 = 160 ÷ 240 = 66.67%
  expect(d.quality.beneficiary.value).toBe(66.67);
  expect(d.quality.beneficiary.counts.total).toBe(4);
  await rate('excellent', '10:00');
  d = await admin.json(admin.get(query));
  // (3×60 + 30 + 10) ÷ (5×60) = 220 ÷ 300 = 73.33%
  expect(d.quality.beneficiary.value).toBe(73.33);
  await admin.dispose();

  const { context, page } = await browserAs(browser, w.users.admin, at(D_FB, '18:00'));
  // فلتر المبنى في لوحة المؤشرات (تقييمات هذا اليوم في مبنى الاختبار كلها لدورة ج)
  await page.goto(`/admin?period=today&source=beneficiary&building=${w.building.id}`);
  const formula = page.getByTestId('satisfaction-formula');
  await expect(formula).toContainText('ممتاز = 60');
  await expect(formula).toContainText('جيد = 30');
  await expect(formula).toContainText('سيئ = 10');
  await expect(formula).toContainText('(3 × 60 + 1 × 30 + 1 × 10) ÷ (5 × 60) × 100 = 220 ÷ 300 × 100');
  await expect(formula).toContainText('73.33%');
  await context.close();
});

test('منع إعادة التقييم 24 ساعة لنفس دورة المياه: بالجهاز للزائر، وبالحساب للمسجل — من الخادم والواجهة', async ({ browser }) => {
  const w = world();
  const ref = w.rooms.a.code;
  const t0 = at(addDays(D_FB, 1), '09:00');
  // الجهاز: كوكي الجهاز من صفحة التقييم
  const { context, page } = await browserAs(browser, null, t0);
  await page.goto(`/r/${ref}`);
  await expect(page.getByTestId('rate-code')).toHaveText(ref);
  await page.getByTestId('face-excellent').click();
  await page.getByTestId('submit-feedback').click();
  await expect(page.getByTestId('thanks')).toBeVisible();
  // إعادة فتح الصفحة على الجهاز نفسه ← رسالة المنع بدل النموذج
  await page.reload();
  await expect(page.getByTestId('rate-blocked')).toContainText('24 ساعة');
  await expect(page.getByTestId('face-excellent')).toHaveCount(0);
  // الخادم يرفض حتى لو أُرسل الطلب مباشرة من الجهاز نفسه
  const csrf = (await context.cookies()).find((c) => c.name === 'jodex_csrf')!.value;
  const direct = await page.request.post(`/api/public/r/${ref}/feedback`, {
    headers: { 'x-csrf-token': csrf, ...clockHeaders(at(addDays(D_FB, 2), '08:59')) },
    data: { rating: 'good', reasons: [], otherText: '' },
  });
  expect(direct.status()).toBe(429);
  expect((await direct.json()).error.code).toBe('too_soon');
  // دورة مياه أخرى مسموحة، والدورة نفسها بعد 24 ساعة مسموحة
  const other = await page.request.post(`/api/public/r/${w.rooms.c.code}/feedback`, {
    headers: { 'x-csrf-token': csrf, ...clockHeaders(at(addDays(D_FB, 1), '09:05')) },
    data: { rating: 'good', reasons: [], otherText: '' },
  });
  expect(other.status()).toBe(201);
  const later = await page.request.post(`/api/public/r/${ref}/feedback`, {
    headers: { 'x-csrf-token': csrf, ...clockHeaders(at(addDays(D_FB, 2), '09:00', 1)) },
    data: { rating: 'good', reasons: [], otherText: '' },
  });
  expect(later.status()).toBe(201);
  await context.close();

  // الحساب: المسجّل لا يعيد التقييم من جهاز/شبكة أخرى خلال 24 ساعة
  const t1 = at(addDays(D_FB, 3), '09:00');
  const s1 = await Api.as(w.users.sup2, t1);
  expect((await s1.post(`/api/public/r/${ref}/feedback`, { rating: 'excellent', reasons: [], otherText: '' })).status()).toBe(201);
  const s2 = await Api.as(w.users.sup2, at(addDays(D_FB, 3), '20:00'));
  const again = await s2.post(`/api/public/r/${ref}/feedback`, { rating: 'bad', reasons: ['odors'], otherText: '' });
  expect(again.status()).toBe(429);
  await closeAll(s1, s2);
});

test('رمز QR يحتوي الترميز فقط، والبطاقة «دورة مياه» وتحتها الترميز، وصفحة المسح تفتح التقييم بالترميز', async ({ browser }) => {
  const w = world();
  const admin = await Api.as(w.users.admin);
  const { cards } = await admin.json<{ cards: { restroom: { id: string; code: string }; content: string; svg: string }[] }>(admin.get(`/api/admin/qr?building=${w.building.id}`));
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    expect(card.content).toBe(card.restroom.code);
    // فك الرمز الحقيقي من صورة SVG
    const { data, info } = await sharp(Buffer.from(card.svg))
      .resize(400, 400)
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#FFFFFF' })
      .flatten({ background: '#FFFFFF' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(decoded?.data).toBe(card.restroom.code);
    expect(decoded?.data).not.toMatch(/https?:|\//);
  }
  await admin.dispose();

  const { context, page } = await browserAs(browser, w.users.admin, null);
  await page.goto(`/admin/qr?building=${w.building.id}`);
  const first = page.getByTestId('qr-card').first();
  await expect(first).toContainText('دورة مياه');
  await expect(first.getByTestId('qr-code-text')).toHaveText(/^Q[0-9A-F]+[ABC]$/);
  await context.close();

  // صفحة المسح: إدخال الترميز يدويًا ← صفحة التقييم لدورة المياه نفسها
  const anon = await browserAs(browser, null, null);
  await anon.page.goto('/scan');
  await anon.page.getByTestId('manual-code').fill(w.rooms.b.code.toLowerCase());
  await anon.page.getByTestId('manual-open').click();
  await anon.page.waitForURL(`**/r/${w.rooms.b.code}`);
  await expect(anon.page.getByTestId('rate-code')).toHaveText(w.rooms.b.code);
  await anon.context.close();
});

test('الترميز بجانب دورة المياه في سجل الجولات وتقييمات المستفيدين والملاحظات (الواجهة والبيانات)', async ({ browser }) => {
  const w = world();
  const date = D_PERF;
  // ملاحظة مشرف على دورة أ + تقييم مستفيد + جولة
  const sup = await Api.as(w.users.sup, at(date, '11:00'));
  const ev = await evaluateSite(sup, w.rooms.a.id, () => 2, { note: 'تحتاج متابعة' });
  expect(ev.res.status(), await ev.res.text()).toBe(200);
  await sup.dispose();
  const anon = await Api.anonymous({ at: at(date, '11:30') });
  expect((await anon.post(`/api/public/r/${w.rooms.a.code}/feedback`, { rating: 'good', reasons: [], otherText: '' })).status()).toBe(201);
  await anon.dispose();

  const admin = await Api.as(w.users.admin, at(date, '18:00'));
  const log = await admin.json<{ rows: { restroom: { id: string; code: string } }[] }>(admin.get(`/api/admin/log?period=today&restroom=${w.rooms.a.id}`));
  expect(log.rows.length).toBeGreaterThan(0);
  expect(log.rows.every((r) => r.restroom.code === w.rooms.a.code)).toBe(true);
  const fb = await admin.json<{ rows: { restroom: { code: string } }[] }>(admin.get(`/api/admin/feedback?period=today&restroom=${w.rooms.a.id}`));
  expect(fb.rows[0].restroom.code).toBe(w.rooms.a.code);
  const notes = await admin.json<{ rows: { restroom: { code: string } }[] }>(admin.get(`/api/admin/notes?period=today&restroom=${w.rooms.a.id}`));
  expect(notes.rows[0].restroom.code).toBe(w.rooms.a.code);
  await admin.dispose();

  const { context, page } = await browserAs(browser, w.users.admin, at(date, '18:00'));
  await page.goto(`/admin/rounds?period=today&restroom=${w.rooms.a.id}`);
  await expect(page.getByTestId('log-table').getByText('ترميز دورة المياه')).toBeVisible();
  await expect(page.getByTestId('log-code').first()).toHaveText(w.rooms.a.code);
  await page.goto(`/admin/feedback?period=today&restroom=${w.rooms.a.id}`);
  await expect(page.getByTestId('feedback-table').getByText('ترميز دورة المياه')).toBeVisible();
  await expect(page.getByTestId('feedback-code').first()).toHaveText(w.rooms.a.code);
  await page.goto(`/admin/notes?period=today&restroom=${w.rooms.a.id}`);
  await expect(page.getByTestId('note-code').first()).toHaveText(w.rooms.a.code);
  await context.close();
});

test('صفحة المشرف: الموقع محدد بالمسح وللعرض فقط، وبنود التقييم = بنود جولة المقاول، والأسئلة الثلاثة كما هي', async ({ browser }) => {
  const w = world();
  const mon = await Api.as(w.users.m1);
  const contractorTitles = (await monitorToday(mon)).items.contractor.map((i) => i.title);
  await mon.dispose();
  expect(contractorTitles).toContain('هيئة العامل');
  expect(contractorTitles).not.toContain('الالتزام بخطة العمل');
  const sup = await Api.as(w.users.sup);
  const sites = await sup.json<{ items: { title: string }[] }>(sup.get('/api/supervisor/sites'));
  expect(sites.items.map((i) => i.title)).toEqual(contractorTitles);
  // لا يقيّم موقعًا غير مسند حتى عبر الواجهة البرمجية
  expect((await sup.post('/api/supervisor/evaluations/start', { restroomId: w.rooms.c.id })).status()).toBe(403);
  await sup.dispose();

  const { context, page } = await browserAs(browser, w.users.sup, null);
  await page.goto('/supervisor');
  await expect(page.getByTestId('site-select')).toHaveCount(0);
  await expect(page.getByTestId('scan-prompt')).toBeVisible();
  await expect(page.getByTestId('submit-evaluation')).toHaveCount(0);
  await expect(page.getByTestId('assigned-sites')).toContainText(w.rooms.a.code);
  // فتح الموقع من رمز QR (الترميز) ← جدول الموقع للعرض والتقييم
  await page.goto(`/go/${w.rooms.b.code}`);
  await page.waitForURL(/\/supervisor\?restroom=/);
  const site = page.getByTestId('site-table');
  await expect(site).toContainText(w.rooms.b.code);
  await expect(site.locator('button, a, select, input')).toHaveCount(0);
  await expect(page.getByText('هل جولة المراقب المسجّلة مطابقة للواقع؟')).toBeVisible();
  await expect(page.getByText('هل يحتاج الموقع معالجة فورية؟')).toBeVisible();
  await expect(page.getByText('ملاحظات المشرف الميداني')).toBeVisible();
  await expect(page.getByText('هيئة العامل')).toBeVisible();
  await context.close();
});

test('«جولة المراقب غير مطابقة للواقع» لا تدخل في أداء المتميزين ولا تخفضه، وتبقى ظاهرة في بيانات الجولة', async () => {
  const w = world();
  const date = addDays(D_PERF, 2);
  const mon = await Api.as(w.users.m1, at(date, '08:00'));
  const data = await monitorToday(mon);
  const am = roundOf(data, 'am');
  await uploadRequiredPhotos(mon, am.id);
  await mon.json(submitRound(mon, am.id, answersFor(data, 'done')));
  await mon.dispose();

  const sup = await Api.as(w.users.sup, at(date, '09:00'));
  expect((await evaluateSite(sup, w.rooms.a.id, () => 5, { matchesRound: 'yes' })).res.status()).toBe(200);
  const admin = await Api.as(w.users.admin, at(date, '18:00'));
  type Row = { monitorId: string; s: number | null; q: number | null };
  const staff = async () => (await admin.json<{ rows: Row[] }>(admin.get('/api/admin/staff?period=today'))).rows.find((r) => r.monitorId === w.users.m1.id)!;
  const before = await staff();
  expect(before.s).toBe(100);

  // تقييم منخفض مع «غير مطابقة» ← لا يغيّر أداء المراقب
  sup.at = at(date, '09:30');
  const mismatch = await evaluateSite(sup, w.rooms.a.id, () => 1, { matchesRound: 'no', note: 'الجولة المسجلة لا تطابق الواقع' });
  expect(mismatch.res.status(), await mismatch.res.text()).toBe(200);
  const after = await staff();
  expect(after).toMatchObject({ s: before.s, q: before.q });

  // الإجابة ظاهرة في السجل وتفاصيل الجولة وتفاصيل التقييم
  const log = await admin.json<{ rows: { kind: string; id: string; mismatch?: boolean }[] }>(admin.get(`/api/admin/log?period=today&restroom=${w.rooms.a.id}`));
  expect(log.rows.find((r) => r.id === mismatch.evaluationId)?.mismatch).toBe(true);
  const evalDetail = await admin.json<{ meta: { k: string; v: string }[] }>(admin.get(`/api/admin/log/supervisor/${mismatch.evaluationId}`));
  expect(evalDetail.meta.find((m) => m.k === 'هل جولة المراقب المسجلة مطابقة للواقع؟')?.v).toContain('لا');
  const roundDetail = await admin.json<{ meta: { k: string; v: string }[] }>(admin.get(`/api/admin/log/round/${am.id}`));
  const verification = roundDetail.meta.find((m) => m.k.startsWith('هل جولة المراقب المسجلة مطابقة للواقع؟'))?.v ?? '';
  expect(verification).toContain('مطابقة');
  expect(verification).toContain('غير مطابقة');
  await closeAll(sup, admin);
});
