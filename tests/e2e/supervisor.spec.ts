/**
 * تقييمات مشرف الوزارة: التحقق الرقابي، الملاحظة الإلزامية وأهميتها، عدم تطبيق قواعد الالتزام،
 * وواجهة المشرف وألوان الفئة في صفحتي الملاحظات والسجل.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceClient } from '../support/world';
import { Api, at, browserAs, closeAll, computedColors, evaluateSite, rgb, world } from './helpers';

let sup: Api;
let admin: Api;
const DAY = '2042-03-05';

test.beforeAll(async () => {
  const w = world();
  sup = await Api.as(w.users.sup, at(DAY, '10:00'));
  admin = await Api.as(w.users.admin, at(DAY, '23:59'));
});
test.afterAll(async () => {
  await closeAll(sup, admin);
});

interface NoteRow {
  text: string;
  severity: 'high' | 'mid' | 'low';
  restroom: { id: string };
  supervisor: string;
}

test('سؤال المطابقة مرفوض قبل فتح «تحقق رقابي» ومقبول بعده', async () => {
  const w = world();
  sup.at = at(DAY, '10:00');
  const start = await sup.json<{ evaluationId: string; viewed: boolean }>(sup.post('/api/supervisor/evaluations/start', { restroomId: w.rooms.a.id }));
  expect(start.viewed).toBe(false);
  const sites = await sup.json<{ items: { id: string }[] }>(sup.get('/api/supervisor/sites'));
  const ratings = Object.fromEntries(sites.items.map((i) => [i.id, 5]));
  const body = { evaluationId: start.evaluationId, ratings, matchesRound: 'yes', needsUrgent: 'no', note: '', idempotencyKey: randomUUID() };
  const early = await sup.post('/api/supervisor/evaluations', body);
  expect(early.status()).toBe(409);
  expect((await early.json()).error.code).toBe('contractor_rounds_not_viewed');

  const view = await sup.json<{ rounds: unknown[] }>(sup.get(`/api/supervisor/sites/${w.rooms.a.id}/contractor-rounds?evaluationId=${start.evaluationId}`));
  expect(Array.isArray(view.rounds)).toBe(true);
  const ok = await sup.post('/api/supervisor/evaluations', body);
  expect(ok.status(), await ok.text()).toBe(200);
  expect(await ok.json()).toMatchObject({ score: 100, note: null });

  // الإجابة عن السؤالين إلزامية
  const again = await sup.json<{ evaluationId: string }>(sup.post('/api/supervisor/evaluations/start', { restroomId: w.rooms.a.id }));
  await sup.get(`/api/supervisor/sites/${w.rooms.a.id}/contractor-rounds?evaluationId=${again.evaluationId}`);
  const missing = await sup.post('/api/supervisor/evaluations', { ...body, evaluationId: again.evaluationId, matchesRound: null, idempotencyKey: randomUUID() });
  expect(missing.status()).toBe(422);
  expect((await missing.json()).error).toMatchObject({ missingMatch: true });
});

test('ملاحظة إلزامية مع تقييم ≤ 2، وإنشاء الملاحظة وأهميتها حسب القاعدة', async () => {
  const w = world();
  sup.at = at(DAY, '11:00');
  // تقييم 2 بلا ملاحظة ← مرفوض
  const noNote = await evaluateSite(sup, w.rooms.b.id, (_, i) => (i === 0 ? 2 : 5));
  expect(noNote.res.status()).toBe(422);
  expect((await noNote.res.json()).error).toMatchObject({ noteRequired: true });

  // بند منخفض واحد + ملاحظة ← متوسطة
  sup.at = at(DAY, '11:05');
  const mid = await evaluateSite(sup, w.rooms.b.id, (_, i) => (i === 0 ? 2 : 5), { note: 'أرضية مبللة عند المدخل' });
  expect(mid.res.status(), await mid.res.text()).toBe(200);
  expect(await mid.res.json()).toMatchObject({ note: { severity: 'mid', text: 'أرضية مبللة عند المدخل' } });

  // أكثر من بند منخفض ← عالية
  sup.at = at(DAY, '11:10');
  const high = await evaluateSite(sup, w.rooms.b.id, (_, i) => (i < 2 ? 1 : 4), { note: 'عدة مشكلات تحتاج تدخلًا', needsUrgent: 'yes' });
  expect(await high.res.json()).toMatchObject({ note: { severity: 'high' } });

  // ملاحظة نصية بلا بنود منخفضة ← منخفضة؛ وتقييم 3 لا يجعل الملاحظة إلزامية
  sup.at = at(DAY, '11:15');
  const low = await evaluateSite(sup, w.rooms.a.id, () => 3, { note: 'يُنصح بزيادة المناديل' });
  expect(await low.res.json()).toMatchObject({ score: 60, note: { severity: 'low' } });
  sup.at = at(DAY, '11:20');
  const none = await evaluateSite(sup, w.rooms.a.id, () => 4);
  expect(await none.res.json()).toMatchObject({ score: 80, note: null });

  const notes = await admin.json<{ rows: NoteRow[] }>(admin.get(`/api/admin/notes?period=today&building=${w.building.id}`));
  const texts = notes.rows.map((n) => [n.text, n.severity]);
  expect(texts).toEqual(
    expect.arrayContaining([
      ['أرضية مبللة عند المدخل', 'mid'],
      ['عدة مشكلات تحتاج تدخلًا', 'high'],
      ['يُنصح بزيادة المناديل', 'low'],
    ]),
  );
  expect(notes.rows).toHaveLength(3);
  expect(notes.rows.every((n) => n.supervisor === w.users.sup.name)).toBe(true);
});

test('قواعد الالتزام لا تُطبَّق على تقييمات المشرفين (تقييم بعد آخر موعد للجولات مقبول بلا درجة التزام)', async () => {
  const w = world();
  sup.at = at(DAY, '23:30');
  const late = await evaluateSite(sup, w.rooms.a.id, () => 5);
  expect(late.res.status(), await late.res.text()).toBe(200);
  const body = await late.res.json();
  expect(body.score).toBe(100);
  expect(body).not.toHaveProperty('complianceLevel');
  const { data } = await serviceClient().from('supervisor_evaluations').select('*').eq('id', late.evaluationId).single();
  expect(Object.keys(data!).some((k) => k.startsWith('compliance'))).toBe(false);

  const log = await admin.json<{ rows: { id: string; kind: string; status: { label: string }; result: number }[] }>(
    admin.get(`/api/admin/log?period=today&building=${w.building.id}&kind=supervisor`),
  );
  const entry = log.rows.find((r) => r.id === late.evaluationId)!;
  expect(entry).toMatchObject({ kind: 'supervisor', result: 100, status: { label: 'مكتملة' } });
});

test('واجهة المشرف: أزرار المطابقة معطلة قبل «تحقق رقابي»، ثم الإرسال ينجح', async ({ browser }) => {
  const w = world();
  const s = await browserAs(browser, w.users.sup, at('2042-03-06', '10:00'), { width: 390, height: 844 });
  try {
    const page = s.page;
    await expect(page.getByTestId('supervisor-name')).toContainText(w.users.sup.name);
    await page.getByTestId('site-select').selectOption(w.rooms.b.id);
    await expect(page.getByTestId('match-yes')).toBeDisabled();
    for (const row of await page.locator('[data-testid^="rate-item-"]').all()) await row.locator('[data-rating="5"]').click();
    await page.getByTestId('open-verification').click();
    await expect(page.getByTestId('contractor-rounds')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('match-yes')).toBeEnabled();
    await page.getByTestId('match-yes').click();
    await page.getByTestId('urgent-no').click();
    await page.getByTestId('submit-evaluation').click();
    await expect(page.getByTestId('success-dialog')).toBeVisible();
    expect(s.errors).toEqual([]);
  } finally {
    await closeAll(s.context);
  }
});

test('ألوان الفئة: شارة المشرف حمراء في الملاحظات، والمراقب أزرق والمشرف أحمر في السجل', async ({ browser }) => {
  const w = world();
  const s = await browserAs(browser, w.users.admin, at(DAY, '23:59'));
  try {
    const page = s.page;
    await page.goto(`/admin/notes?period=today&building=${w.building.id}`);
    await expect(page.getByTestId('note-card').first()).toBeVisible();
    const noteChips = await computedColors(page, '[data-testid="note-card"] [data-role-chip]');
    expect(noteChips.length).toBeGreaterThan(0);
    for (const c of noteChips) expect(c).toMatchObject({ color: rgb('#A12B2B'), background: rgb('#F8E4E4'), text: 'مشرف الوزارة' });

    await page.goto(`/admin/rounds?period=today&building=${w.building.id}`);
    await expect(page.getByTestId('log-row').first()).toBeVisible();
    const sup = await computedColors(page, '[data-testid="log-row"] [data-role-chip="supervisor"]');
    const mon = await computedColors(page, '[data-testid="log-row"] [data-role-chip="contractor_monitor"]');
    expect(sup.length).toBeGreaterThan(0);
    expect(mon.length).toBeGreaterThan(0);
    for (const c of sup) expect(c).toMatchObject({ color: rgb('#A12B2B'), background: rgb('#F8E4E4'), text: 'مشرف الوزارة' });
    for (const c of mon) expect(c).toMatchObject({ color: rgb('#1F5F99'), background: rgb('#E4EEF8'), text: 'مراقب المقاول' });
    expect(s.errors).toEqual([]);
  } finally {
    await closeAll(s.context);
  }
});
