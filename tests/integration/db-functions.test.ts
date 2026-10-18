/**
 * دوال قاعدة البيانات الذرّية: إنشاء الجولات وإغلاق الفائتة بدقة الدقيقة، قفل السجلات المرسلة،
 * منع التكرار، قواعد تقييم المستفيد ونافذة الجهاز، ومنع حفظ أوزان مجموعها ≠ 100.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at } from '../support/time';
import { createQaWorld, retireQaWorld, serviceClient, type QaWorld } from '../support/world';

let world: QaWorld;
const svc = () => serviceClient();

beforeAll(async () => {
  world = await createQaWorld('DB');
});
afterAll(async () => {
  if (world) await retireQaWorld(world);
});

async function qaRounds(date: string) {
  const { data, error } = await svc()
    .from('rounds')
    .select('id, restroom_id, shift, status, compliance_score, compliance_level, executed_by_id, on_behalf_of_id, quality_score')
    .eq('round_date', date)
    .in('restroom_id', Object.values(world.rooms).map((r) => r.id));
  if (error) throw error;
  return data ?? [];
}

async function addPhotos(roundId: string, slots = ['tools', 'entry', 'sinks', 'toilets', 'general']) {
  const { error } = await svc()
    .from('round_photos')
    .insert(slots.map((slot) => ({ round_id: roundId, slot, storage_key: `qa/${roundId}/${slot}-${randomUUID()}.jpg`, mime: 'image/jpeg', size_bytes: 1000 })));
  if (error) throw error;
}

async function contractorItems() {
  const { data } = await svc().from('checklist_items').select('id, weight').eq('group', 'contractor').eq('is_active', true);
  return data ?? [];
}

const submitArgs = (roundId: string, executedBy: string, onBehalfOf: string | null, answers: { item_id: string; answer: string }[], key = randomUUID()) => ({
  p_round_id: roundId,
  p_executed_by: executedBy,
  p_on_behalf_of: onBehalfOf,
  p_submitted_at: new Date().toISOString(),
  p_compliance_level: 'full',
  p_compliance_score: 100,
  p_quality_score: 100,
  p_weights_snapshot: { version: 1 },
  p_note: '',
  p_answers: answers,
  p_idempotency_key: key,
});

describe('ensure_daily_rounds', () => {
  it('ينشئ جولتين لكل دورة مياه نشطة لها مراقب أساسي، ولا يكرر عند إعادة التشغيل', async () => {
    const date = '2041-04-01';
    await svc().rpc('ensure_daily_rounds', { p_date: date });
    const again = await svc().rpc('ensure_daily_rounds', { p_date: date });
    expect(again.error).toBeNull();
    expect(again.data).toBe(0);
    const rows = await qaRounds(date);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });
});

describe('close_overdue_rounds — بدقة الدقيقة', () => {
  const date = '2041-04-02';
  it('11:00 ما زالت مفتوحة، 11:01 تُغلق الصباحية فقط كفائتة بدرجة 0، 16:01 تُغلق المسائية', async () => {
    await svc().rpc('ensure_daily_rounds', { p_date: date });
    await svc().rpc('close_overdue_rounds', { p_now: at(date, '11:00', 59) });
    expect((await qaRounds(date)).every((r) => r.status === 'pending')).toBe(true);

    await svc().rpc('close_overdue_rounds', { p_now: at(date, '11:01') });
    let rows = await qaRounds(date);
    for (const r of rows.filter((x) => x.shift === 'am')) expect(r).toMatchObject({ status: 'missed', compliance_level: null });
    for (const r of rows.filter((x) => x.shift === 'am')) expect(Number(r.compliance_score)).toBe(0);
    expect(rows.filter((x) => x.shift === 'pm').every((r) => r.status === 'pending')).toBe(true);

    await svc().rpc('close_overdue_rounds', { p_now: at(date, '16:00', 30) });
    expect((await qaRounds(date)).filter((x) => x.shift === 'pm').every((r) => r.status === 'pending')).toBe(true);
    await svc().rpc('close_overdue_rounds', { p_now: at(date, '16:01') });
    rows = await qaRounds(date);
    expect(rows.every((r) => r.status === 'missed')).toBe(true);
  });

  it('الجولة الفائتة لا تُرسل ولا تُعدَّل ولا تُحذف', async () => {
    const [missed] = (await qaRounds(date)).filter((r) => r.restroom_id === world.rooms.a.id && r.shift === 'am');
    const items = await contractorItems();
    const sub = await svc().rpc('submit_round_tx', submitArgs(missed.id, world.users.m1.id, null, items.map((i) => ({ item_id: i.id, answer: 'done' }))));
    expect(sub.error?.message).toBe('round_missed');
    const upd = await svc().from('rounds').update({ note: 'x' }).eq('id', missed.id);
    expect(upd.error?.message).toContain('round_locked');
    const del = await svc().from('rounds').delete().eq('id', missed.id);
    expect(del.error?.message).toContain('round_locked');
  });
});

describe('submit_round_tx', () => {
  const date = '2041-04-03';
  let roundId: string;
  const key = randomUUID();

  beforeAll(async () => {
    await svc().rpc('ensure_daily_rounds', { p_date: date });
    roundId = (await qaRounds(date)).find((r) => r.restroom_id === world.rooms.a.id && r.shift === 'am')!.id;
  });

  it('يرفض الإرسال قبل اكتمال الصور الإلزامية', async () => {
    await addPhotos(roundId, ['tools', 'entry']);
    const items = await contractorItems();
    const res = await svc().rpc('submit_round_tx', submitArgs(roundId, world.users.m1.id, null, items.map((i) => ({ item_id: i.id, answer: 'done' }))));
    expect(res.error?.message).toBe('round_photos_missing');
  });

  it('النائب: executed_by = النائب و on_behalf_of = الأساسي، ثم تُقفل الجولة', async () => {
    await addPhotos(roundId, ['sinks', 'toilets', 'general']);
    const items = await contractorItems();
    const answers = items.map((i) => ({ item_id: i.id, answer: 'done' }));
    const res = await svc().rpc('submit_round_tx', submitArgs(roundId, world.users.sub.id, world.users.m1.id, answers, key));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ duplicate: false });
    const row = (await qaRounds(date)).find((r) => r.id === roundId)!;
    expect(row).toMatchObject({ status: 'submitted', executed_by_id: world.users.sub.id, on_behalf_of_id: world.users.m1.id });

    // نفس مفتاح الإرسال = نتيجة مكررة بلا كتابة، ومفتاح آخر = مرفوض
    const dup = await svc().rpc('submit_round_tx', submitArgs(roundId, world.users.sub.id, world.users.m1.id, answers, key));
    expect(dup.data).toMatchObject({ duplicate: true });
    const other = await svc().rpc('submit_round_tx', submitArgs(roundId, world.users.sub.id, world.users.m1.id, answers));
    expect(other.error?.message).toBe('round_already_submitted');

    // المرسلة غير قابلة للتعديل ولا لتغيير إجاباتها وصورها
    expect((await svc().from('rounds').update({ quality_score: 1 }).eq('id', roundId)).error?.message).toContain('round_locked');
    expect((await svc().from('round_answers').delete().eq('round_id', roundId)).error?.message).toContain('round_locked');
    expect((await svc().from('round_photos').delete().eq('round_id', roundId)).error?.message).toContain('round_locked');
    const audit = await svc().from('audit_log').select('action, data').eq('entity_id', roundId);
    expect(audit.data?.some((a) => a.action === 'round.submit')).toBe(true);
  });
});

describe('submit_feedback_tx', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const call = (overrides: Record<string, unknown> = {}) =>
    svc().rpc('submit_feedback_tx', {
      p_token: world.rooms.b.token,
      p_rating: 5,
      p_reason_keys: [],
      p_other_text: null,
      p_client_hash: hash(`qa-${world.runId}`),
      p_now: at('2041-04-04', '10:00'),
      p_window_minutes: 10,
      ...overrides,
    });

  it('رمز غير صالح أو معطّل يُرفض', async () => {
    expect((await call({ p_token: 'not-a-real-token-xxxxxxxxxxxx' })).error?.message).toBe('invalid_token');
  });

  it('«سيئ» بلا سبب يُرفض، و«أخرى» بلا نص يُرفض، والأسباب مع غير «سيئ» تُرفض', async () => {
    expect((await call({ p_rating: 1 })).error?.message).toBe('reasons_required');
    expect((await call({ p_rating: 1, p_reason_keys: ['other'], p_other_text: '  ' })).error?.message).toBe('other_text_required');
    expect((await call({ p_rating: 5, p_reason_keys: ['odors'] })).error?.message).toBe('reasons_not_allowed');
    expect((await call({ p_rating: 1, p_reason_keys: ['nope'] })).error?.message).toBe('invalid_reason');
  });

  it('تقييم واحد لكل جهاز ودورة مياه خلال 10 دقائق', async () => {
    const first = await call({ p_rating: 1, p_reason_keys: ['odors', 'other'], p_other_text: 'رائحة قوية' });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ ok: true });
    const second = await call({ p_now: at('2041-04-04', '10:09', 59) });
    expect(second.data).toMatchObject({ ok: false });
    expect(second.data.retry_after_seconds).toBeGreaterThan(0);
    // جهاز آخر مسموح، ونفس الجهاز بعد انقضاء النافذة مسموح
    expect((await call({ p_client_hash: hash(`qa-${world.runId}-2`), p_now: at('2041-04-04', '10:05') })).data).toMatchObject({ ok: true });
    expect((await call({ p_now: at('2041-04-04', '10:10', 1) })).data).toMatchObject({ ok: true });
    const { data: saved } = await svc().from('beneficiary_feedback').select('rating, other_text').eq('restroom_id', world.rooms.b.id);
    expect(saved).toHaveLength(3);
    expect(saved!.find((f) => f.rating === 1)?.other_text).toBe('رائحة قوية');
  });
});

describe('save_settings_tx', () => {
  it('يمنع الحفظ عند مجموع أوزان ≠ 100 دون أي تغيير', async () => {
    const { data: before } = await svc().from('checklist_items').select('id, title, weight, is_active, "group"').eq('group', 'contractor');
    const target = before!.find((i) => i.is_active)!;
    const res = await svc().rpc('save_settings_tx', {
      p_actor: world.users.admin.id,
      p_payload: {
        partial_credit_pct: 50,
        deep_clean_weekday: 1,
        items: [{ id: target.id, title: target.title, weight: Number(target.weight) + 5, is_active: true }],
      },
    });
    expect(res.error?.message).toBe('weights_sum_invalid');
    const { data: after } = await svc().from('checklist_items').select('id, weight').eq('id', target.id).single();
    expect(Number(after!.weight)).toBe(Number(target.weight));
  });

  it('غير الأدمن لا يحفظ الإعدادات', async () => {
    const res = await svc().rpc('save_settings_tx', { p_actor: world.users.m1.id, p_payload: { partial_credit_pct: 50, deep_clean_weekday: 1, items: [] } });
    expect(res.error?.message).toBe('forbidden');
  });
});

describe('مواءمة الجولات المفتوحة مع الإسناد الحالي', () => {
  it('تعطيل دورة المياه يحذف جولاتها المفتوحة فقط، وتغيير المراقب الأساسي يعيد إسنادها', async () => {
    const date = '2041-05-02';
    const db = svc();
    await db.rpc('ensure_daily_rounds', { p_date: date });
    // صباحية دورة ج مرسلة (لا تُمس)، والمسائية مفتوحة
    const cAm = (await qaRounds(date)).find((r) => r.restroom_id === world.rooms.c.id && r.shift === 'am')!;
    await addPhotos(cAm.id);
    const items = await contractorItems();
    expect((await db.rpc('submit_round_tx', submitArgs(cAm.id, world.users.m3.id, null, items.map((i) => ({ item_id: i.id, answer: 'done' }))))).error).toBeNull();

    // تعطيل دورة ج ← تُحذف مسائيتها المفتوحة ولا تتحول إلى «فائتة»
    await db.from('restrooms').update({ is_active: false }).eq('id', world.rooms.c.id);
    await db.rpc('close_overdue_rounds', { p_now: at(date, '16:30') });
    let rows = (await qaRounds(date)).filter((r) => r.restroom_id === world.rooms.c.id);
    expect(rows.map((r) => [r.shift, r.status])).toEqual([['am', 'submitted']]);
    await db.from('restrooms').update({ is_active: true }).eq('id', world.rooms.c.id);

    // نقل دورة ب إلى المراقب m3 (m2 يُعطَّل) ← m3 مسؤول عن دورتين، والجولات المفتوحة تُسند له
    const next = '2041-05-03';
    await db.rpc('ensure_daily_rounds', { p_date: next });
    await db.from('users').update({ is_active: false }).eq('id', world.users.m2.id);
    expect((await db.from('restrooms').update({ monitor_id: world.users.m3.id }).eq('id', world.rooms.b.id)).error).toBeNull();
    await db.rpc('ensure_daily_rounds', { p_date: next });
    rows = (await qaRounds(next)).filter((r) => r.restroom_id === world.rooms.b.id || r.restroom_id === world.rooms.c.id);
    expect(rows).toHaveLength(4);
    const { data: assigned } = await db.from('rounds').select('assigned_monitor_id').in('id', rows.map((r) => r.id));
    expect(assigned!.every((r) => r.assigned_monitor_id === world.users.m3.id)).toBe(true);

    // دورة ج بلا مراقب مسؤول ← تُحذف جولاتها المفتوحة
    await db.from('restrooms').update({ monitor_id: null }).eq('id', world.rooms.c.id);
    await db.rpc('ensure_daily_rounds', { p_date: next });
    expect((await qaRounds(next)).filter((r) => r.restroom_id === world.rooms.c.id)).toHaveLength(0);

    // المسؤول عن دورة المياه يجب أن يكون مراقبًا أساسيًا
    const bad = await db.from('restrooms').update({ monitor_id: world.users.sup.id }).eq('id', world.rooms.c.id);
    expect(bad.error?.message).toContain('restroom_monitor_must_be_primary');
  });
});
