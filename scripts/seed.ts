/**
 * بيانات البداية الإلزامية — idempotent (تشغيله مرتين لا ينشئ أي تكرار).
 * كلمات المرور تُولَّد عشوائيًا للحسابات الجديدة فقط وتُطبع مرة واحدة.
 *   npm run db:seed
 */
import { serviceClient } from './lib/env';
import { newQrToken, upsertAccount, type ProfileFields } from './lib/accounts';

const BUILDINGS = ['المبنى الرئيسي', 'مبنى الخدمات'];

const RESTROOMS = [
  { code: 'A0M', name: 'دورة مياه الرجال', floor: 'الدور الأرضي', building: 'المبنى الرئيسي' },
  { code: 'A0F', name: 'دورة مياه النساء', floor: 'الدور الأرضي', building: 'المبنى الرئيسي' },
  { code: 'A1M', name: 'دورة مياه الرجال', floor: 'الدور الأول', building: 'المبنى الرئيسي' },
  { code: 'B0M', name: 'دورة مياه الرجال', floor: 'الدور الأرضي', building: 'مبنى الخدمات' },
  { code: 'B1F', name: 'دورة مياه النساء', floor: 'الدور الأول', building: 'مبنى الخدمات' },
  { code: 'B2M', name: 'دورة مياه الرجال', floor: 'الدور الثاني', building: 'مبنى الخدمات' },
];

const PRIMARY_MONITORS = [
  { username: 'khaled', full_name: 'خالد العتيبي', restroom: 'A0M' },
  { username: 'noura', full_name: 'نورة الدوسري', restroom: 'A0F' },
  { username: 'fahad', full_name: 'فهد الشمري', restroom: 'A1M' },
  { username: 'saeed', full_name: 'سعيد القحطاني', restroom: 'B0M' },
  { username: 'haya', full_name: 'هيا المطيري', restroom: 'B1F' },
  { username: 'turki', full_name: 'تركي المالكي', restroom: 'B2M' },
];

const SUBSTITUTES = [
  { username: 'yaser', full_name: 'ياسر الزهراني', substitute_for: 'khaled' },
  { username: 'abdullah', full_name: 'عبدالله السبيعي', substitute_for: 'saeed' },
  { username: 'omar.z', full_name: 'عمر زليخة', substitute_for: 'turki' },
];

const SUPERVISORS = [
  { username: 'reem', full_name: 'ريم الغامدي', restrooms: ['A0M', 'A0F', 'A1M'] },
  { username: 'salman', full_name: 'سلمان الحربي', restrooms: ['B0M', 'B1F', 'B2M'] },
];

const ADMINS = [{ username: 'admin', full_name: 'عبدالرحمن الشهري' }];

type SeedItem = { key: string; group: 'contractor' | 'deep' | 'supervisor'; title: string; description?: string; weight: number | null };

const ITEMS: SeedItem[] = [
  { key: 'contractor_floors_sinks', group: 'contractor', title: 'نظافة دورات المياه', description: 'الأرضيات والأحواض والأدوات الصحية', weight: 25 },
  { key: 'contractor_odor', group: 'contractor', title: 'رائحة دورات المياه', weight: 15 },
  { key: 'contractor_fresheners', group: 'contractor', title: 'تعبئة الفواحات', weight: 10 },
  { key: 'contractor_mirrors_doors', group: 'contractor', title: 'نظافة المرايا والأبواب ومقابضها', weight: 12 },
  { key: 'contractor_glass_partitions', group: 'contractor', title: 'نظافة الزجاج والقواطع', weight: 10 },
  { key: 'contractor_waste', group: 'contractor', title: 'جمع النفايات وتفريغ السلال', weight: 15 },
  { key: 'contractor_work_plan', group: 'contractor', title: 'الالتزام بخطة العمل', weight: 13 },
  { key: 'deep_sinks_toilet_bases', group: 'deep', title: 'تنظيف وتعقيم الأحواض وقواعد الحمام', weight: null },
  { key: 'deep_drains', group: 'deep', title: 'تنظيف البلاعات', weight: null },
  { key: 'deep_glass_partitions', group: 'deep', title: 'تنظيف فواصل الزجاج بالكامل', weight: null },
  { key: 'deep_ac_grilles', group: 'deep', title: 'تنظيف جريلات التكييف', weight: null },
  { key: 'supervisor_cleanliness', group: 'supervisor', title: 'نظافة دورات المياه ومحتوياتها', weight: 30 },
  { key: 'supervisor_engineer_instructions', group: 'supervisor', title: 'الاستجابة لتعليمات المهندس المشرف', weight: 15 },
  { key: 'supervisor_emergency_response', group: 'supervisor', title: 'الاستجابة السريعة لأي حالة طارئة', weight: 15 },
  { key: 'supervisor_sanitary_maintenance', group: 'supervisor', title: 'صيانة الأجهزة الصحية وتأمين قطع الغيار', weight: 18 },
  { key: 'supervisor_lighting', group: 'supervisor', title: 'صيانة الإنارة والكشافات', weight: 12 },
  { key: 'supervisor_exhaust_fans', group: 'supervisor', title: 'صيانة مراوح الشفط', weight: 10 },
];

function fail(step: string, error: unknown): never {
  console.error(`✗ فشل: ${step}`);
  console.error(error);
  process.exit(1);
}

async function main() {
  const svc = serviceClient();
  const credentials: { username: string; full_name: string; role: string; password: string }[] = [];
  const summary: string[] = [];

  // 1) المباني
  {
    const { error } = await svc
      .from('buildings')
      .upsert(BUILDINGS.map((name) => ({ name })), { onConflict: 'name', ignoreDuplicates: true });
    if (error) fail('المباني', error);
  }
  const { data: buildings, error: bErr } = await svc.from('buildings').select('id, name');
  if (bErr || !buildings) fail('قراءة المباني', bErr);
  const buildingId = new Map(buildings.map((b) => [b.name, b.id]));

  // 2) دورات المياه (upsert على code)
  {
    const rows = RESTROOMS.map((r) => ({
      code: r.code,
      name: r.name,
      floor_label: r.floor,
      building_id: buildingId.get(r.building)!,
    }));
    const { error } = await svc.from('restrooms').upsert(rows, { onConflict: 'code' });
    if (error) fail('دورات المياه', error);
  }
  const { data: restrooms, error: rErr } = await svc.from('restrooms').select('id, code');
  if (rErr || !restrooms) fail('قراءة دورات المياه', rErr);
  const restroomId = new Map(restrooms.map((r) => [r.code, r.id]));

  // 3) البنود: تُضاف الناقصة فقط (لا تُلغى تعديلات الأدمن على القائمة)
  {
    const groupOrder: Record<string, number> = {};
    const rows = ITEMS.map((i) => {
      groupOrder[i.group] = (groupOrder[i.group] ?? 0) + 10;
      return {
        key: i.key,
        group: i.group,
        title: i.title,
        description: i.description ?? null,
        weight: i.weight,
        default_weight: i.weight,
        is_default: true,
        sort_order: groupOrder[i.group],
        is_active: true,
      };
    });
    const { error } = await svc.from('checklist_items').upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
    if (error) fail('بنود التقييم', error);
  }

  // 4) الإعدادات (صف واحد)
  {
    const { error } = await svc
      .from('settings')
      .upsert({ id: true, partial_credit_pct: 50, deep_clean_weekday: 1 }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) fail('الإعدادات', error);
  }

  // 5) المستخدمون (upsert على username)
  const userIds = new Map<string, string>();
  const ensure = async (fields: ProfileFields) => {
    try {
      const res = await upsertAccount(svc, fields);
      userIds.set(fields.username, res.id);
      if (res.password) credentials.push({ username: fields.username, full_name: fields.full_name, role: fields.role, password: res.password });
      summary.push(`${res.created ? '＋ أُنشئ' : '✓ موجود'}  ${fields.username}`);
    } catch (e) {
      fail(`المستخدم ${fields.username}`, e);
    }
  };

  for (const m of PRIMARY_MONITORS) {
    await ensure({
      username: m.username,
      full_name: m.full_name,
      role: 'contractor_monitor',
      monitor_kind: 'primary',
      restroom_ids: [restroomId.get(m.restroom)!],
      substitute_for_id: null,
    });
  }
  for (const s of SUBSTITUTES) {
    await ensure({
      username: s.username,
      full_name: s.full_name,
      role: 'contractor_monitor',
      monitor_kind: 'substitute',
      substitute_for_id: userIds.get(s.substitute_for)!,
    });
  }
  for (const s of SUPERVISORS) {
    await ensure({ username: s.username, full_name: s.full_name, role: 'supervisor', monitor_kind: null, substitute_for_id: null });
  }
  for (const a of ADMINS) {
    await ensure({ username: a.username, full_name: a.full_name, role: 'admin', monitor_kind: null, substitute_for_id: null });
  }

  // 6) إسناد المواقع للمشرفين
  {
    const rows = SUPERVISORS.flatMap((s) =>
      s.restrooms.map((code) => ({ supervisor_id: userIds.get(s.username)!, restroom_id: restroomId.get(code)! })),
    );
    const { error } = await svc
      .from('supervisor_assignments')
      .upsert(rows, { onConflict: 'supervisor_id,restroom_id', ignoreDuplicates: true });
    if (error) fail('إسناد المواقع', error);
  }

  // 7) رمز QR نشط لكل دورة مياه
  {
    const { data: active, error } = await svc.from('qr_codes').select('restroom_id').eq('is_active', true);
    if (error) fail('رموز QR', error);
    const has = new Set((active ?? []).map((q) => q.restroom_id));
    const rows = restrooms.filter((r) => !has.has(r.id)).map((r) => ({ restroom_id: r.id, token: newQrToken() }));
    if (rows.length) {
      const { error: insErr } = await svc.from('qr_codes').insert(rows);
      if (insErr) fail('إنشاء رموز QR', insErr);
    }
  }

  // 8) جولات اليوم
  {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    const { error } = await svc.rpc('ensure_daily_rounds', { p_date: today });
    if (error) fail('جولات اليوم', error);
    await svc.rpc('close_overdue_rounds', { p_now: new Date().toISOString() });
  }

  console.log('\nجُودِكس — بيانات البداية');
  console.log('─'.repeat(48));
  for (const line of summary) console.log(line);
  if (credentials.length) {
    console.log('\nكلمات مرور الحسابات الجديدة (تُعرض مرة واحدة فقط — احفظها الآن):');
    console.table(credentials.map((c) => ({ 'اسم المستخدم': c.username, الاسم: c.full_name, الدور: c.role, 'كلمة المرور': c.password })));
  } else {
    console.log('\nلا توجد حسابات جديدة. لإعادة ضبط كلمة مرور: npm run admin -- users:reset-password --username <name>');
  }
}

main().catch((e) => fail('غير متوقع', e));
