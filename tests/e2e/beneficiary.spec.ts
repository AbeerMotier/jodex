/**
 * المستفيد: مسح QR حقيقي (فك ترميز الصورة المعروضة) ← تقييم محفوظ يظهر في الأدمن،
 * وقواعد الأسباب ورمز غير صالح وحد الجهاز.
 */
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { Api, at, BASE, browserAs, closeAll, giveFeedback, world } from './helpers';

const DAY = '2042-05-06';

test('رمز غير صالح يُرفض (الصفحة والواجهة البرمجية)', async ({ browser }) => {
  const s = await browserAs(browser, null, at(DAY, '10:00'), { width: 390, height: 844 });
  try {
    await s.page.goto('/r/this-token-does-not-exist-000000');
    await expect(s.page.getByTestId('invalid-token')).toContainText('الرمز غير صالح');
  } finally {
    await closeAll(s.context);
  }
  const api = await Api.anonymous({ at: at(DAY, '10:00') });
  try {
    expect((await api.get('/api/public/r/this-token-does-not-exist-000000')).status()).toBe(404);
    expect((await api.post('/api/public/r/this-token-does-not-exist-000000/feedback', { rating: 'excellent' })).status()).toBe(404);
  } finally {
    await api.dispose();
  }
});

test('«سيئ» بلا سبب يُرفض، و«أخرى» بلا نص يُرفض، والأسباب مع غير «سيئ» تُرفض', async () => {
  const token = world().rooms.c.token;
  const t = at(DAY, '10:05');
  expect((await giveFeedback(token, t, { rating: 'bad' })).status).toBe(422);
  expect((await giveFeedback(token, t, { rating: 'bad', reasons: ['other'], otherText: '   ' })).status).toBe(422);
  expect((await giveFeedback(token, t, { rating: 'good', reasons: ['odors'] })).status).toBe(422);
  const ok = await giveFeedback(token, t, { rating: 'bad', reasons: ['odors', 'floor_dirty_wet'] });
  expect(ok.status).toBe(201);
});

test('مسح QR حقيقي من صفحة رموز QR ← صفحة التقييم ← تقييم محفوظ يظهر في الأدمن، ومرة واحدة لكل جهاز خلال 10 دقائق', async ({ browser }) => {
  const w = world();
  const room = w.rooms.a;
  // 1) الأدمن يعرض البطاقة، ونفك ترميز صورة الرمز كما تراها الكاميرا
  const adminUi = await browserAs(browser, w.users.admin, at(DAY, '10:00'));
  let decoded = '';
  try {
    await adminUi.page.goto(`/admin/qr?building=${w.building.id}`);
    const card = adminUi.page.getByTestId('qr-card').filter({ hasText: room.name });
    await expect(card).toHaveCount(1);
    const png = await card.getByRole('img', { name: new RegExp(room.name) }).screenshot({ scale: 'device' });
    const { data, info } = await sharp(png)
      .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    expect(result, 'QR decode').not.toBeNull();
    decoded = result!.data;
    expect(adminUi.errors).toEqual([]);
  } finally {
    await closeAll(adminUi.context);
  }
  expect(decoded).toBe(`${BASE()}/r/${room.token}`);
  expect(decoded).not.toContain(room.id); // لا يكشف المعرف الداخلي

  // 2) المستفيد يفتح الرابط المفكوك ويقيّم «سيئ» مع سبب «أخرى»
  const visitor = await browserAs(browser, null, at(DAY, '10:01'), { width: 390, height: 844 });
  try {
    const page = visitor.page;
    await page.goto(decoded);
    await expect(page.getByText(room.name).first()).toBeVisible();
    await page.getByTestId('face-bad').click();
    // «سيئ» بلا سبب أو «أخرى» بلا نص: لا يظهر زر الإرسال أصلًا
    await expect(page.getByTestId('submit-feedback')).toHaveCount(0);
    await page.getByTestId('reason-other').click();
    await expect(page.getByTestId('other-text')).toBeVisible();
    await expect(page.getByTestId('submit-feedback')).toHaveCount(0);
    await page.getByTestId('other-text').fill('لا يوجد صابون');
    await page.getByTestId('submit-feedback').click();
    await expect(page.getByTestId('thanks')).toBeVisible();
    // نفس الجهاز خلال 10 دقائق ← مرفوض برسالة واضحة
    await page.goto(decoded);
    await page.getByTestId('face-excellent').click();
    await page.getByTestId('submit-feedback').click();
    await expect(page.getByText(/سبق أن قيّمت دورة المياه هذه/)).toBeVisible();
    expect(visitor.errors).toEqual([]);
  } finally {
    await closeAll(visitor.context);
  }

  // جهاز آخر مسموح
  const other = await giveFeedback(room.token, at(DAY, '10:02'), { rating: 'excellent' });
  expect(other.status).toBe(201);

  // 3) يظهر في صفحة تقييمات المستفيدين لدى الأدمن
  const admin = await Api.as(w.users.admin, at(DAY, '10:30'));
  try {
    const list = await admin.json<{ rows: { restroom: { id: string }; rating: string; reasons: string[] }[]; total: number }>(
      admin.get(`/api/admin/feedback?period=today&restroom=${room.id}`),
    );
    expect(list.total).toBe(2);
    const bad = list.rows.find((r) => r.rating === 'bad')!;
    expect(bad.reasons.join(' ')).toContain('لا يوجد صابون');
    const dash = await admin.json<{ quality: { beneficiary: { value: number } }; total: { value: number } }>(
      admin.get(`/api/admin/dashboard?period=today&restroom=${room.id}&source=beneficiary`),
    );
    expect(dash.total.value).toBe(2);
    expect(dash.quality.beneficiary.value).toBe(50);
  } finally {
    await admin.dispose();
  }
});
