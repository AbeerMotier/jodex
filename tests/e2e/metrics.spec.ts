/**
 * المؤشرات: بيانات اختبار معروفة ← أرقام لوحة المؤشرات المتوقعة لكل فترة وفلتر،
 * ثم قواعد لوحة الأدمن: أحدث الجولات 4 عناصر بالضبط ومجاورة لمؤشرات المقاولين، لا QR في الشريط الجانبي،
 * وألوان الفئة في أحدث الجولات والرسم.
 * التواريخ (2043) بعيدة عن بقية الاختبارات، والبيانات تُنشأ بالترتيب الزمني عبر الواجهات البرمجية الحقيقية.
 */
import { expect, test } from '@playwright/test';
import { Api, at, browserAs, closeAll, completeRound, computedColors, evaluateSite, giveFeedback, rgb, world } from './helpers';

const OUTSIDE = '2043-05-10';
const D0 = '2043-05-25';
const D1 = '2043-06-16';
const D2 = '2043-06-18';
const NOW = at(D2, '12:00');

let admin: Api;
let partial = 50;

interface Dashboard {
  total: { label: string; value: number };
  rounds: { required: number; completed: number; late: number; missed: number; completedPct: number | null; latePct: number | null; missedPct: number | null } | null;
  quality: {
    contractor: { value: number | null; sub: string } | null;
    supervisor: { value: number | null; sub: string } | null;
    beneficiary: { value: number | null; sub: string } | null;
    compliance: { am: number | null; pm: number | null; overall: number | null } | null;
  };
  comparison: { series: string[]; points: { restroomId: string; contractor: number | null; supervisor: number | null; satisfaction: number | null }[] };
  recent: { kind: string; items: unknown[] };
  performance: { monitorId: string; cp: number | null; a: number | null; s: number | null; q: number | null }[] | null;
}

const close = (actual: number | null | undefined, expected: number | null) => {
  if (expected === null) expect(actual ?? null).toBeNull();
  else expect(actual).toBeCloseTo(expected, 1);
};

async function dashboard(query: string) {
  return admin.json<Dashboard>(admin.get(`/api/admin/dashboard?building=${world().building.id}&${query}`));
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  const w = world();
  admin = await Api.as(w.users.admin, NOW);
  partial = (await admin.json<{ partialCreditPct: number }>(admin.get('/api/admin/settings'))).partialCreditPct;

  const m1 = await Api.as(w.users.m1);
  const m2 = await Api.as(w.users.m2);
  const sup = await Api.as(w.users.sup);
  const sup2 = await Api.as(w.users.sup2);
  try {
    const ok = async (p: Promise<{ res: { status(): number; text(): Promise<string> } }>) => {
      const { res } = await p;
      expect(res.status(), await res.text()).toBe(200);
    };
    // خارج نافذة الشهر
    await ok(completeRound(m1, 'am', { uploadAt: at(OUTSIDE, '08:30'), submitAt: at(OUTSIDE, '09:00') }));
    // D0: صباحية ملتزمة تمامًا بجودة 0
    await ok(completeRound(m1, 'am', { uploadAt: at(D0, '09:00'), submitAt: at(D0, '09:15') }, 'not_done'));
    // D1
    await ok(completeRound(m1, 'am', { uploadAt: at(D1, '08:30'), submitAt: at(D1, '09:00') }));
    sup.at = at(D1, '12:00');
    await ok(evaluateSite(sup, w.rooms.a.id, () => 5));
    expect((await giveFeedback(w.rooms.b.token, at(D1, '12:30'), { rating: 'excellent' })).status).toBe(201);
    await ok(completeRound(m1, 'pm', { uploadAt: at(D1, '13:10'), submitAt: at(D1, '14:45') }, 'partial'));
    await ok(completeRound(m2, 'pm', { uploadAt: at(D1, '13:10'), submitAt: at(D1, '15:30') }));
    // D2 (اليوم)
    await ok(completeRound(m1, 'am', { uploadAt: at(D2, '08:30'), submitAt: at(D2, '10:00') }));
    sup.at = at(D2, '11:30');
    await ok(evaluateSite(sup, w.rooms.b.id, () => 3));
    sup2.at = at(D2, '11:45');
    await ok(evaluateSite(sup2, w.rooms.c.id, () => 4));
    expect((await giveFeedback(w.rooms.a.token, at(D2, '11:50'), { rating: 'excellent' })).status).toBe(201);
    expect((await giveFeedback(w.rooms.a.token, at(D2, '11:51'), { rating: 'good' })).status).toBe(201);
    expect((await giveFeedback(w.rooms.a.token, at(D2, '11:52'), { rating: 'bad', reasons: ['not_clean'] })).status).toBe(201);
  } finally {
    await closeAll(m1, m2, sup, sup2);
  }
});

test.afterAll(async () => {
  await closeAll(admin);
});

test('فترة «اليوم» — الكل', async () => {
  const w = world();
  const d = await dashboard('period=today&source=all');
  expect(d.total).toMatchObject({ label: 'إجمالي التقييمات', value: 5 });
  expect(d.rounds).toMatchObject({ required: 6, completed: 1, late: 1, missed: 2 });
  close(d.rounds!.completedPct, 16.67);
  close(d.rounds!.latePct, 16.67);
  close(d.rounds!.missedPct, 33.33);
  close(d.quality.contractor!.value, 100);
  expect(d.quality.contractor!.sub).toBe('1 جولة مكتملة');
  close(d.quality.supervisor!.value, 70);
  close(d.quality.beneficiary!.value, 66.67);
  close(d.quality.compliance!.am, 16.67);
  close(d.quality.compliance!.pm, null);
  close(d.quality.compliance!.overall, 16.67);
  expect(d.recent.items).toHaveLength(4);
  expect(d.performance!.map((p) => p.monitorId)).toEqual([w.users.m1.id, w.users.m3.id, w.users.m2.id]);
  close(d.performance![0].cp, 50);
  close(d.performance![0].q, 100);
});

test('فترة «أسبوع» — الكل ومقارنة الأداء لكل دورة مياه', async () => {
  const w = world();
  const d = await dashboard('period=week&source=all');
  expect(d.total.value).toBe(7);
  expect(d.rounds).toMatchObject({ required: 12, completed: 4, late: 3, missed: 5 });
  close(d.rounds!.completedPct, 33.33);
  close(d.rounds!.latePct, 25);
  close(d.rounds!.missedPct, 41.67);
  close(d.quality.contractor!.value, (300 + partial) / 4);
  close(d.quality.supervisor!.value, 80);
  close(d.quality.beneficiary!.value, 75);
  close(d.quality.compliance!.am, 25);
  close(d.quality.compliance!.pm, 36.67);
  close(d.quality.compliance!.overall, 28.89);
  expect(d.comparison.series).toEqual(['contractor', 'supervisor']);
  const point = (id: string) => d.comparison.points.find((p) => p.restroomId === id)!;
  close(point(w.rooms.a.id).contractor, (200 + partial) / 3);
  close(point(w.rooms.a.id).supervisor, 100);
  close(point(w.rooms.b.id).contractor, 100);
  close(point(w.rooms.b.id).supervisor, 60);
  close(point(w.rooms.c.id).contractor, null);
  close(point(w.rooms.c.id).supervisor, 80);
  expect(d.performance!.map((p) => p.monitorId)).toEqual([w.users.m1.id, w.users.m2.id, w.users.m3.id]);
  const m1 = d.performance![0];
  close(m1.cp, 75);
  close(m1.a, (200 + partial) / 3);
  close(m1.s, 100);
  close(m1.q, ((200 + partial) / 3 + 100) / 2);
});

test('فترة «شهر» — تشمل D0 وتستبعد ما قبل 30 يومًا', async () => {
  const d = await dashboard('period=month&source=all');
  expect(d.rounds).toMatchObject({ required: 18, completed: 5, late: 3, missed: 10 });
  close(d.quality.contractor!.value, (300 + partial) / 5);
  close(d.quality.supervisor!.value, 80);
  close(d.quality.beneficiary!.value, 75);
  close(d.quality.compliance!.am, 27.78);
  close(d.quality.compliance!.pm, 18.33);
  close(d.quality.compliance!.overall, 24);
});

test('فلتر «نوع التقييم»: لا خلط بين المصادر', async () => {
  const w = world();
  const contractor = await dashboard('period=week&source=contractor');
  expect(contractor.total).toMatchObject({ label: 'تقييمات المقاول', value: 4 });
  expect(contractor.quality.supervisor).toBeNull();
  expect(contractor.quality.beneficiary).toBeNull();
  expect(contractor.comparison.series).toEqual(['contractor']);
  expect(contractor.comparison.points.every((p) => p.supervisor === null && p.satisfaction === null)).toBe(true);
  // «تقييم المقاول»: الجودة = متوسط جولات المراقب فقط
  expect(contractor.performance!.map((p) => p.monitorId)).toEqual([w.users.m2.id, w.users.m1.id]);
  close(contractor.performance![1].q, (200 + partial) / 3);

  const supervisor = await dashboard('period=week&source=supervisor');
  expect(supervisor.total).toMatchObject({ label: 'تقييمات المشرفين', value: 3 });
  expect(supervisor.rounds).toBeNull();
  expect(supervisor.quality.contractor).toBeNull();
  expect(supervisor.quality.compliance).toBeNull();
  expect(supervisor.performance).toBeNull();
  close(supervisor.quality.supervisor!.value, 80);
  expect(supervisor.comparison.points.every((p) => p.contractor === null)).toBe(true);

  const beneficiary = await dashboard('period=week&source=beneficiary');
  expect(beneficiary.total).toMatchObject({ label: 'تقييمات المستفيدين', value: 4 });
  expect(beneficiary.rounds).toBeNull();
  expect(beneficiary.quality.contractor).toBeNull();
  expect(beneficiary.quality.supervisor).toBeNull();
  close(beneficiary.quality.beneficiary!.value, 75);
  expect(beneficiary.recent.kind).toBe('feedback');
  expect(beneficiary.recent.items).toHaveLength(4);
});

test('فلاتر الموقع: دورة مياه محددة، والدور', async () => {
  const w = world();
  const a = await dashboard(`period=week&source=all&restroom=${w.rooms.a.id}`);
  expect(a.rounds).toMatchObject({ required: 4, completed: 3 });
  close(a.quality.contractor!.value, (200 + partial) / 3);
  close(a.quality.supervisor!.value, 100);
  close(a.quality.beneficiary!.value, 66.67);
  expect(a.comparison.points.map((p) => p.restroomId)).toEqual([w.rooms.a.id]);

  const c = await dashboard(`period=week&source=all&floor=${encodeURIComponent(w.rooms.c.floor)}`);
  expect(c.rounds).toMatchObject({ required: 4, completed: 0, missed: 3 });
  close(c.quality.contractor!.value, null);
  close(c.quality.supervisor!.value, 80);
  close(c.quality.beneficiary!.value, null);
});

test('لوحة الأدمن: أحدث الجولات 4 بالضبط ومجاورة لمؤشرات المقاولين، ولا QR في الشريط الجانبي، وألوان الفئة', async ({ browser }) => {
  const w = world();
  const ui = await browserAs(browser, w.users.admin, NOW);
  try {
    const page = ui.page;
    await page.goto(`/admin?period=today&building=${w.building.id}`);
    await expect(page.getByTestId('recent-item')).toHaveCount(4);
    // التجاور: القسمان في نفس الصف وعلى نفس الارتفاع تقريبًا
    const row = page.getByTestId('recent-row');
    await expect(row.getByTestId('recent-section')).toBeVisible();
    await expect(row.getByTestId('performance-section')).toBeVisible();
    const r = (await row.getByTestId('recent-section').boundingBox())!;
    const p = (await row.getByTestId('performance-section').boundingBox())!;
    expect(Math.abs(r.y - p.y)).toBeLessThan(4);
    expect(r.x + r.width <= p.x + 1 || p.x + p.width <= r.x + 1).toBe(true);

    // لا رمز QR في الشريط الجانبي الأخضر (فقط رابط الصفحة)
    const sidebar = page.getByTestId('admin-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('svg[shape-rendering="crispEdges"], canvas, img, [data-testid="qr-card"]')).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: /رموز QR/ })).toBeVisible();

    // ألوان الفئة في أحدث الجولات
    const mon = await computedColors(page, '[data-testid="recent-item"] [data-role-chip="contractor_monitor"]');
    const sup = await computedColors(page, '[data-testid="recent-item"] [data-role-chip="supervisor"]');
    expect(mon.length).toBeGreaterThan(0);
    expect(sup.length).toBeGreaterThan(0);
    for (const c of mon) expect(c).toMatchObject({ color: rgb('#1F5F99'), background: rgb('#E4EEF8'), text: 'مراقب المقاول' });
    for (const c of sup) expect(c).toMatchObject({ color: rgb('#A12B2B'), background: rgb('#F8E4E4'), text: 'المشرف الميداني' });

    // ألوان الفئة في الرسم ومفتاحه: المراقب أزرق والمشرف أحمر
    const legend = page.getByTestId('chart-legend');
    const swatch = async (s: string) => legend.locator(`[data-series="${s}"] > span`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await swatch('contractor')).toBe(rgb('#2F6FB0'));
    expect(await swatch('supervisor')).toBe(rgb('#C24545'));
    await expect(legend).toContainText('مراقب المقاول');
    await expect(legend).toContainText('المشرف الميداني');
    const bars = await page
      .getByTestId('comparison-chart')
      .locator('[data-series] > div')
      .evaluateAll((els) => els.map((el) => [el.parentElement!.getAttribute('data-series'), getComputedStyle(el).backgroundColor]));
    for (const [series, color] of bars) {
      if (color === rgb('#D3DED8')) continue; // لا بيانات
      expect(color).toBe(series === 'contractor' ? rgb('#2F6FB0') : rgb('#C24545'));
    }

    // عدّادات الشريط الجانبي تتبع الفترة، ورموز QR = عدد دورات المياه
    await expect(page.getByTestId('nav-count-qr')).toHaveText(/\d+/);
    expect(ui.errors).toEqual([]);
  } finally {
    await closeAll(ui.context);
  }
});
