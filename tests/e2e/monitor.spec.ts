/**
 * جولات مراقب المقاول عبر الواجهة البرمجية والمتصفح بساعة اختبار (وقت الخادم هو المرجع).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { exifOf, jpegWithGps } from '../support/images';
import { serviceClient } from '../support/world';
import {
  addDays,
  answersFor,
  Api,
  at,
  browserAs,
  closeAll,
  completeRound,
  monitorToday,
  REQUIRED_SLOTS,
  roundOf,
  submitRound,
  uploadRequiredPhotos,
  world,
} from './helpers';

let m1: Api;
let admin: Api;

test.beforeAll(async () => {
  const w = world();
  m1 = await Api.as(w.users.m1);
  admin = await Api.as(w.users.admin);
});
test.afterAll(async () => {
  await closeAll(m1, admin);
});

// نافذة الصباحية 07:30–10:00 (ملتزم حتى 09:30)، والمسائية 12:00–14:30 (ملتزمة طوال نافذتها)
const BOUNDARIES: { date: string; am: [string, string, number]; pm: [string, string, number] }[] = [
  { date: '2042-01-06', am: ['09:30', 'full', 100], pm: ['14:30', 'full', 100] },
  { date: '2042-01-07', am: ['09:45', 'behind', 75], pm: ['12:00', 'full', 100] },
  { date: '2042-01-08', am: ['10:00', 'non', 50], pm: ['13:30', 'full', 100] },
  { date: '2042-01-09', am: ['07:30', 'full', 100], pm: ['12:30', 'full', 100] },
];

test.describe('دالة الالتزام بالقيم الحدية (بدقة الدقيقة)', () => {
  for (const b of BOUNDARIES) {
    test(`صباحًا ${b.am[0]} ← ${b.am[1]} ${b.am[2]} · مساءً ${b.pm[0]} ← ${b.pm[1]} ${b.pm[2]}`, async () => {
      for (const [shift, [time, level, score], uploadAt] of [
        ['am', b.am, '07:30'],
        ['pm', b.pm, '12:00'],
      ] as const) {
        const { res } = await completeRound(m1, shift, { uploadAt: at(b.date, uploadAt), submitAt: at(b.date, time) });
        const body = await res.json();
        expect(res.status(), JSON.stringify(body)).toBe(200);
        expect(body).toMatchObject({ complianceLevel: level, complianceScore: score, qualityScore: 100, duplicate: false });
        m1.at = at(b.date, time);
        const r = roundOf(await monitorToday(m1), shift);
        expect(r).toMatchObject({ status: 'submitted', complianceLevel: level, complianceScore: score });
      }
    });
  }

  test('الدقيقة كاملة محسوبة: 09:30:59 ← ملتزم تمامًا، 10:00:59 و14:30:59 ← ما زالت مسموحة', async () => {
    const date = '2042-01-10';
    const am = await completeRound(m1, 'am', { uploadAt: at(date, '09:00'), submitAt: at(date, '10:00', 59) });
    expect(await am.res.json()).toMatchObject({ complianceLevel: 'non', complianceScore: 50 });
    const pm = await completeRound(m1, 'pm', { uploadAt: at(date, '14:00'), submitAt: at(date, '14:30', 59) });
    expect(await pm.res.json()).toMatchObject({ complianceLevel: 'full', complianceScore: 100 });
    const day2 = '2042-01-11';
    const am2 = await completeRound(m1, 'am', { uploadAt: at(day2, '09:00'), submitAt: at(day2, '09:30', 59) });
    expect(await am2.res.json()).toMatchObject({ complianceLevel: 'full', complianceScore: 100 });
  });

  test('10:01 و14:31 ← رفض الإرسال وتُسجل الجولة «فائتة» بدرجة 0', async () => {
    const date = '2042-01-12';
    for (const [shift, uploadAt, late] of [
      ['am', '09:50', '10:01'],
      ['pm', '14:00', '14:31'],
    ] as const) {
      const { res } = await completeRound(m1, shift, { uploadAt: at(date, uploadAt), submitAt: at(date, late) });
      expect(res.status()).toBe(409);
      expect(['round_missed', 'deadline_passed']).toContain((await res.json()).error.code);
      const r = roundOf(await monitorToday(m1), shift);
      expect(r).toMatchObject({ status: 'missed', display: 'missed', displayLabel: 'فائتة' });
    }
    const { data } = await serviceClient().from('rounds').select('status, compliance_score').eq('restroom_id', world().rooms.a.id).eq('round_date', date);
    expect(data!.every((r) => r.status === 'missed' && Number(r.compliance_score) === 0)).toBe(true);
  });
});

test('حالات الجولة غير المرسلة: 07:00 «لم تبدأ»، 09:00 «لم تكتمل»، 09:45 «متأخرة · لم تكتمل»، 10:01 «فائتة»', async () => {
  const date = '2042-01-13';
  const expectAm = async (time: string, label: string, badge: string) => {
    m1.at = at(date, time);
    const data = await monitorToday(m1);
    expect(roundOf(data, 'am').displayLabel, time).toBe(label);
    expect(data.badge.label, time).toBe(badge);
  };
  await expectAm('07:00', 'لم تبدأ', 'ضمن الوقت');
  await expectAm('09:00', 'لم تكتمل', 'ضمن الوقت');
  await expectAm('09:45', 'متأخرة · لم تكتمل', 'متأخر عن الخطة');
  await expectAm('10:01', 'فائتة', 'غير ملتزم بالخطة');
});

test('رفض الجولة الناقصة (بنود/صور)، و«التنظيف العميق» ملغى فلا يُعرض ولا يُطلب في أي يوم', async () => {
  const normalDay = '2042-02-02';
  m1.at = at(normalDay, '08:00');
  let data = await monitorToday(m1);
  expect(data.items.deep).toHaveLength(0);
  expect(data.deep.required).toBe(false);
  let am = roundOf(data, 'am');
  await uploadRequiredPhotos(m1, am.id, REQUIRED_SLOTS.slice(0, 3));
  let res = await submitRound(m1, am.id, answersFor(data, 'done'));
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatchObject({ missingPhotos: ['general', 'labor'] });

  await uploadRequiredPhotos(m1, am.id, REQUIRED_SLOTS.slice(3));
  const partialAnswers = answersFor(data, 'done');
  delete partialAnswers[data.items.contractor[0].id];
  res = await submitRound(m1, am.id, partialAnswers);
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toMatchObject({ missingItems: 1 });

  res = await submitRound(m1, am.id, answersFor(data, 'done'));
  expect(res.status(), await res.text()).toBe(200);

  // كل أيام الأسبوع: لا بنود تنظيف عميق
  for (let i = 1; i <= 7; i++) {
    m1.at = at(addDays(normalDay, i), '08:00');
    data = await monitorToday(m1);
    expect(data.items.deep).toHaveLength(0);
    expect(data.deep.required).toBe(false);
  }
  am = roundOf(data, 'am');
  await uploadRequiredPhotos(m1, am.id);
  res = await submitRound(m1, am.id, answersFor(data, 'done'));
  expect(res.status(), await res.text()).toBe(200);
});

test('النائب: executed_by = النائب و on_behalf_of = الأساسي، والجولة المرسلة مقفلة ومحمية من التكرار', async () => {
  const w = world();
  const date = '2042-01-20';
  const sub = await Api.as(w.users.sub, at(date, '09:00'));
  try {
    const data = await monitorToday(sub);
    expect(data.user.isSubstitute).toBe(true);
    expect(data.onBehalfOf).toBe(w.users.m1.name);
    const am = roundOf(data, 'am');
    await uploadRequiredPhotos(sub, am.id);
    sub.at = at(date, '09:10');
    const key = randomUUID();
    const res = await submitRound(sub, am.id, answersFor(data, 'done'), 'نُفذت بالنيابة', key);
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ executedBy: w.users.sub.name, onBehalfOf: w.users.m1.name, complianceLevel: 'full' });

    const { data: row } = await serviceClient().from('rounds').select('executed_by_id, on_behalf_of_id, assigned_monitor_id').eq('id', am.id).single();
    expect(row).toEqual({ executed_by_id: w.users.sub.id, on_behalf_of_id: w.users.m1.id, assigned_monitor_id: w.users.m1.id });

    // إعادة الإرسال بنفس المفتاح = نتيجة مكررة، وبمفتاح آخر = مرفوض؛ والتعديل بعد الإرسال مرفوض
    const dup = await submitRound(sub, am.id, answersFor(data, 'done'), '', key);
    expect(await dup.json()).toMatchObject({ duplicate: true });
    expect((await submitRound(sub, am.id, answersFor(data, 'done'))).status()).toBe(409);
    expect((await sub.put(`/api/monitor/rounds/${am.id}/draft`, { answers: {}, note: 'x' })).status()).toBe(409);
    expect((await sub.upload(`/api/monitor/rounds/${am.id}/photos/tools`, await jpegWithGps(9))).status()).toBe(409);
    expect((await sub.delete(`/api/monitor/rounds/${am.id}/photos/tools`)).status()).toBe(409);

    // السجل يعرض المنفّذ والنيابة
    admin.at = at(date, '09:15');
    const log = await admin.json<{ rows: { id: string; employee: { name: string; role: string }; onBehalfOf: string | null }[] }>(
      admin.get(`/api/admin/log?period=today&restroom=${w.rooms.a.id}`),
    );
    const entry = log.rows.find((r) => r.id === am.id)!;
    expect(entry).toMatchObject({ employee: { name: w.users.sub.name, role: 'contractor_monitor' }, onBehalfOf: w.users.m1.name });
  } finally {
    await sub.dispose();
  }
});

test('المسودة والجولة pending لا تُحتسب، والصور تُخزن بلا EXIF/GPS في حاوية خاصة', async () => {
  const w = world();
  const date = '2042-01-21';
  m1.at = at(date, '09:00');
  const data = await monitorToday(m1);
  const am = roundOf(data, 'am');
  const original = await jpegWithGps(3);
  expect((await exifOf(original)).exif).not.toBeNull();
  await uploadRequiredPhotos(m1, am.id);
  const draft = await m1.put(`/api/monitor/rounds/${am.id}/draft`, { answers: answersFor(data, 'done'), note: 'مسودة' });
  expect(draft.status()).toBe(200);

  admin.at = at(date, '09:05');
  const dash = await admin.json<{ rounds: { required: number; completed: number }; quality: { contractor: { value: number | null }; compliance: { overall: number | null } } }>(
    admin.get(`/api/admin/dashboard?period=today&restroom=${w.rooms.a.id}&source=contractor`),
  );
  expect(dash.rounds).toMatchObject({ required: 2, completed: 0 });
  expect(dash.quality.contractor.value).toBeNull();
  expect(dash.quality.compliance.overall).toBeNull();

  const svc = serviceClient();
  const { data: photos } = await svc.from('round_photos').select('storage_key, mime').eq('round_id', am.id);
  expect(photos).toHaveLength(5);
  for (const p of photos!) {
    const { data: blob, error } = await svc.storage.from('photos').download(p.storage_key);
    expect(error).toBeNull();
    const info = await exifOf(Buffer.from(await blob!.arrayBuffer()));
    expect(info.format).toBe('jpeg');
    expect(info.exif).toBeNull();
    expect(p.mime).toBe('image/jpeg');
  }
  // ملف ليس صورة (بامتداد صورة) يُرفض بالبصمة الثنائية
  const fake = await m1.upload(`/api/monitor/rounds/${am.id}/photos/entry`, Buffer.from('%PDF-1.4 not an image'), 'fake.jpg');
  expect(fake.status()).toBe(415);
});

test('المتصفح: المراقب يعبّئ الجولة ويرفع صورًا حقيقية ويرسل ← تظهر في السجل بحالة التزام صحيحة', async ({ browser }) => {
  const w = world();
  const date = '2042-01-22';
  // صورة العمالة تُلتقط بالكاميرا داخل الصفحة (مختبرة بكاميرا وهمية في client-requirements.spec)؛ هنا تُرفع كالتقاط مباشر
  m1.at = at(date, '09:05');
  const today = await monitorToday(m1);
  await uploadRequiredPhotos(m1, roundOf(today, 'am').id, ['labor']);
  const s = await browserAs(browser, w.users.m1, at(date, '09:10'), { width: 390, height: 844 });
  try {
    const page = s.page;
    await expect(page.getByTestId('monitor-name')).toContainText(w.users.m1.name);
    await expect(page.getByTestId('shift-status-am')).toHaveText('لم تكتمل');
    const groups = page.locator('[role="radiogroup"]:has([data-answer="done"])');
    expect(await groups.count()).toBeGreaterThan(0);
    for (const group of await groups.all()) await group.locator('[data-answer="done"]').click();
    await expect(page.getByTestId('items-progress')).toHaveText(/^(\d+) من \1$/);
    let i = 0;
    await expect(page.getByTestId('photo-input-labor')).toHaveCount(0);
    for (const slot of REQUIRED_SLOTS.filter((x) => x !== 'labor')) {
      await page.getByTestId(`photo-input-${slot}`).setInputFiles({ name: `${slot}.jpg`, mimeType: 'image/jpeg', buffer: await jpegWithGps(i++) });
    }
    await expect(page.getByTestId('photos-progress')).toHaveText('5 من 5 صور إلزامية', { timeout: 30_000 });
    await page.getByTestId('submit-round').click();
    await expect(page.getByTestId('success-dialog')).toBeVisible();
    await page.getByTestId('success-dialog').getByRole('button', { name: 'تم' }).click();
    await expect(page.getByTestId('round-closed')).toContainText('ملتزم تمامًا');
    expect(s.errors).toEqual([]);

    admin.at = at(date, '09:20');
    const log = await admin.json<{ rows: { restroom: { id: string }; typeLabel: string; result: number | null; status: { label: string } }[] }>(
      admin.get(`/api/admin/log?period=today&restroom=${w.rooms.a.id}&kind=round`),
    );
    const submitted = log.rows.filter((r) => r.result !== null);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ result: 100, status: { label: 'ملتزم تمامًا' } });
  } finally {
    await closeAll(s.context);
  }
});
