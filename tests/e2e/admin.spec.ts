/**
 * الأدمن: منع حفظ أوزان مجموعها ≠ 100، تغيير الأوزان ونسبة «جزئي» وأثرها وفق القرار المعتمد
 * (الجديد فقط افتراضيًا + خيار إعادة الاحتساب)، التصدير بملفات فعلية، طباعة QR، واعتماد المكافآت.
 */
import { expect, test } from '@playwright/test';
import { serviceClient } from '../support/world';
import { Api, at, browserAs, closeAll, completeRound, evaluateSite, rgb, world } from './helpers';

interface SettingsItem {
  id: string;
  group: 'contractor' | 'deep' | 'supervisor';
  title: string;
  description: string | null;
  weight: number | null;
  isActive: boolean;
}
interface Settings {
  partialCreditPct: number;
  deepCleanWeekday: number;
  items: SettingsItem[];
}

let admin: Api;
let m1: Api;

test.beforeAll(async () => {
  const w = world();
  admin = await Api.as(w.users.admin);
  m1 = await Api.as(w.users.m1);
});
test.afterAll(async () => {
  await closeAll(admin, m1);
});

const payloadOf = (s: Settings, patch: { partial?: number; weights?: Record<string, number>; recalc?: string } = {}) => ({
  partialCreditPct: patch.partial ?? s.partialCreditPct,
  deepCleanWeekday: s.deepCleanWeekday,
  recalc: patch.recalc ?? 'none',
  items: s.items.map((i) => ({
    id: i.id,
    group: i.group,
    title: i.title,
    description: i.description,
    weight: i.group === 'deep' ? null : (patch.weights?.[i.id] ?? i.weight),
    isActive: i.isActive,
  })),
});

async function roundResult(date: string, shift: 'am' | 'pm') {
  const { data } = await serviceClient()
    .from('rounds')
    .select('quality_score, status')
    .eq('restroom_id', world().rooms.a.id)
    .eq('round_date', date)
    .eq('shift', shift)
    .single();
  return data ? Number(data.quality_score) : null;
}

test('منع حفظ الأوزان عند مجموع ≠ 100 (الخادم والواجهة)', async ({ browser }) => {
  const w = world();
  admin.at = at('2042-07-07', '10:00');
  const s = await admin.json<Settings>(admin.get('/api/admin/settings'));
  const first = s.items.find((i) => i.group === 'contractor' && i.isActive)!;
  const res = await admin.put('/api/admin/settings', payloadOf(s, { weights: { [first.id]: Number(first.weight) + 7 } }));
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toContain('100');
  const after = await admin.json<Settings>(admin.get('/api/admin/settings'));
  expect(after.items.find((i) => i.id === first.id)!.weight).toBe(first.weight);

  const ui = await browserAs(browser, w.users.admin, at('2042-07-07', '10:00'));
  try {
    const page = ui.page;
    await page.goto('/admin/settings');
    // بنود المشرف مطابقة لبنود المقاول بالعناوين، فيُحدَّد الحقل داخل مجموعة المقاول
    const input = page.getByTestId('group-contractor').getByLabel(`وزن ${first.title}`, { exact: true });
    await input.fill(String(Number(first.weight) + 7));
    await expect(page.getByTestId('sum-contractor')).not.toHaveText(/^100/);
    await expect(page.getByText('مجموع أوزان بنود جولة المقاول الفعالة يجب أن يساوي 100%.')).toBeVisible();
    // الزر معطّل دلاليًا (aria-disabled) ويبقى قابلًا للضغط ليشرح سبب المنع دون إرسال أي طلب
    const save = page.getByTestId('save-settings');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    let putSent = false;
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/admin/settings')) putSent = true;
    });
    await save.click({ force: true });
    await expect(page.getByTestId('toast')).toContainText('مجموع الأوزان يجب أن يساوي 100%');
    expect(putSent).toBe(false);
    expect(ui.errors).toEqual([]);
  } finally {
    await closeAll(ui.context);
  }
  const unchanged = await admin.json<Settings>(admin.get('/api/admin/settings'));
  expect(unchanged.items.find((i) => i.id === first.id)!.weight).toBe(first.weight);
});

test('تغيير الأوزان: تُطبَّق على الجديد فقط افتراضيًا، وإعادة الاحتساب تغيّر نتائج الفترة المختارة', async () => {
  const date = '2042-07-08';
  admin.at = at(date, '08:00');
  const original = await admin.json<Settings>(admin.get('/api/admin/settings'));
  const contractor = original.items.filter((i) => i.group === 'contractor' && i.isActive);
  const [i0, i1] = contractor;
  const w0 = Number(i0.weight);
  expect(w0).toBeGreaterThanOrEqual(5);
  // أول بند «لم يتم» والبقية «تم» ← النتيجة = 100 − وزن البند الأول
  const answers = (id: string) => (id === i0.id ? 'not_done' : 'done');
  const am = await completeRound(m1, 'am', { uploadAt: at(date, '09:00'), submitAt: at(date, '09:05') }, answers);
  expect(await am.res.json()).toMatchObject({ qualityScore: 100 - w0 });

  try {
    admin.at = at(date, '10:00');
    const moved = { [i0.id]: w0 - 5, [i1.id]: Number(i1.weight) + 5 };
    const saved = await admin.json<{ recalculation: unknown }>(admin.put('/api/admin/settings', payloadOf(original, { weights: moved })));
    expect(saved.recalculation).toBeNull();
    expect(await roundResult(date, 'am')).toBe(100 - w0); // القديم لم يتغير

    const pm = await completeRound(m1, 'pm', { uploadAt: at(date, '13:10'), submitAt: at(date, '13:20') }, answers);
    expect(await pm.res.json()).toMatchObject({ qualityScore: 105 - w0 }); // الجديد بالأوزان الجديدة

    admin.at = at(date, '14:00');
    const current = await admin.json<Settings>(admin.get('/api/admin/settings'));
    const recalced = await admin.json<{ recalculation: { rounds: number } }>(admin.put('/api/admin/settings', payloadOf(current, { recalc: 'today' })));
    expect(recalced.recalculation.rounds).toBeGreaterThanOrEqual(2);
    expect(await roundResult(date, 'am')).toBe(105 - w0); // أُعيد احتسابه
  } finally {
    admin.at = at(date, '15:00');
    await admin.json(admin.put('/api/admin/settings', payloadOf(original)));
  }
});

test('معادلة الجودة مع نسبة «جزئي» مختلفة (25%)', async () => {
  const date = '2042-07-09';
  admin.at = at(date, '08:00');
  const original = await admin.json<Settings>(admin.get('/api/admin/settings'));
  try {
    await admin.json(admin.put('/api/admin/settings', payloadOf(original, { partial: 25 })));
    const { res } = await completeRound(m1, 'am', { uploadAt: at(date, '09:00'), submitAt: at(date, '09:10') }, 'partial');
    expect(await res.json()).toMatchObject({ qualityScore: 25, complianceScore: 100 });
  } finally {
    await admin.json(admin.put('/api/admin/settings', payloadOf(original)));
  }
  const restored = await admin.json<Settings>(admin.get('/api/admin/settings'));
  expect(restored.partialCreditPct).toBe(original.partialCreditPct);
});

test('التصدير ينتج ملفات فعلية (PDF/Excel) لكل تقرير، وطباعة QR تنتج PDF، وتُسجل في سجل التدقيق', async () => {
  const w = world();
  admin.at = at('2042-07-08', '18:00');
  for (const report of ['dashboard', 'log', 'feedback', 'notes', 'staff']) {
    for (const format of ['pdf', 'xlsx']) {
      const res = await admin.get(`/api/admin/export?report=${report}&format=${format}&period=week&building=${w.building.id}`);
      expect(res.status(), `${report}.${format}`).toBe(200);
      const body = await res.body();
      expect(body.length).toBeGreaterThan(1000);
      expect(body.subarray(0, 4).toString('latin1')).toBe(format === 'pdf' ? '%PDF' : 'PK\u0003\u0004');
      expect(res.headers()['content-disposition']).toContain(`jodex-${report}-`);
    }
  }
  const qr = await admin.get(`/api/admin/qr/${w.rooms.a.qrId}/print`);
  expect(qr.status()).toBe(200);
  expect((await qr.body()).subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect((await admin.get('/api/admin/export?report=nope&format=pdf')).status()).toBe(422);

  const { data: audit } = await serviceClient()
    .from('audit_log')
    .select('action')
    .eq('actor_id', w.users.admin.id)
    .in('action', ['report.export', 'qr.print']);
  expect(audit!.filter((a) => a.action === 'report.export').length).toBeGreaterThanOrEqual(10);
  expect(audit!.some((a) => a.action === 'qr.print')).toBe(true);
});

test('المكافآت: المرشحون أعلى 3 حسب الالتزام وتقييم المشرف «المطابق للواقع»، واعتماد مرشح وإلغاؤه، وغير المرشح مرفوض', async ({ browser }) => {
  const w = world();
  const date = '2042-07-15';
  const m2 = await Api.as(w.users.m2);
  await completeRound(m1, 'am', { uploadAt: at(date, '08:00'), submitAt: at(date, '08:30') });
  await completeRound(m2, 'am', { uploadAt: at(date, '08:00'), submitAt: at(date, '08:40') });
  await m2.dispose();
  await completeRound(m1, 'pm', { uploadAt: at(date, '13:10'), submitAt: at(date, '13:30') });
  // تقييم المشرف: دورة m1 «مطابقة للواقع»، ودورة m2 «غير مطابقة» فلا تُحتسب له
  const sup = await Api.as(w.users.sup, at(date, '11:00'));
  expect((await evaluateSite(sup, w.rooms.a.id, () => 5, { matchesRound: 'yes' })).res.status()).toBe(200);
  expect((await evaluateSite(sup, w.rooms.b.id, () => 5, { matchesRound: 'no' })).res.status()).toBe(200);
  await sup.dispose();
  admin.at = at(date, '17:00');
  const staff = await admin.json<{ candidates: { monitorId: string; cp: number; s: number; approved: boolean }[] }>(
    admin.get(`/api/admin/staff?period=today&building=${w.building.id}`),
  );
  const cand = staff.candidates.find((c) => c.monitorId === w.users.m1.id)!;
  expect(cand).toMatchObject({ cp: 100, s: 100, approved: false });
  expect(staff.candidates.some((c) => c.monitorId === w.users.m2.id)).toBe(false);

  expect((await admin.post(`/api/admin/bonus/${w.users.m2.id}`, { period: 'today' })).status()).toBe(409);
  expect((await admin.post(`/api/admin/bonus/${w.users.m1.id}`, { period: 'today' })).status()).toBe(200);
  let after = await admin.json<{ candidates: { monitorId: string; approved: boolean }[] }>(admin.get(`/api/admin/staff?period=today&building=${w.building.id}`));
  expect(after.candidates.find((c) => c.monitorId === w.users.m1.id)!.approved).toBe(true);

  // الواجهة تعرض الاعتماد
  const ui = await browserAs(browser, w.users.admin, at(date, '17:00'));
  try {
    await ui.page.goto(`/admin/staff?period=today&building=${w.building.id}`);
    await expect(ui.page.getByTestId('bonus-card').filter({ hasText: w.users.m1.name })).toContainText('معتمد');
    expect(ui.errors).toEqual([]);
  } finally {
    await closeAll(ui.context);
  }

  expect((await admin.delete(`/api/admin/bonus/${w.users.m1.id}`, { period: 'today' })).status()).toBe(200);
  after = await admin.json<typeof after>(admin.get(`/api/admin/staff?period=today&building=${w.building.id}`));
  expect(after.candidates.find((c) => c.monitorId === w.users.m1.id)!.approved).toBe(false);
  const { data: audit } = await serviceClient().from('audit_log').select('action').eq('entity_id', w.users.m1.id).in('action', ['bonus.approve', 'bonus.revoke']);
  expect(audit!.map((a) => a.action).sort()).toEqual(['bonus.approve', 'bonus.revoke']);
});

test('شعار الهوية: ألوان الحالات في سجل الجولات (ملتزم/فائتة) مطابقة للهوية', async ({ browser }) => {
  const w = world();
  const ui = await browserAs(browser, w.users.admin, at('2042-07-15', '18:00'));
  try {
    await ui.page.goto(`/admin/rounds?period=today&restroom=${w.rooms.a.id}`);
    const chip = ui.page.getByTestId('log-row').getByText('ملتزم تمامًا').first();
    await expect(chip).toBeVisible();
    const color = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(rgb('#3F7A62'));
  } finally {
    await closeAll(ui.context);
  }
});
