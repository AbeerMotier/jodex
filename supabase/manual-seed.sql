-- =====================================================================
-- جُودِكس — البيانات الأساسية (بديل npm run db:seed) لتشغيلها في Supabase SQL Editor
-- شغّله بعد ملف الجداول supabase/00_ALL_IN_ONE.sql. آمن للتكرار: لا يكرر شيئًا موجودًا.
-- في النهاية يعرض جدول الحسابات الجديدة وكلمات مرورها العشوائية — مرة واحدة فقط، احفظه.
-- =====================================================================

-- 1) المباني ودورات المياه
insert into public.buildings (name) values ('المبنى الرئيسي'), ('مبنى الخدمات')
on conflict (name) do nothing;

insert into public.restrooms (code, name, floor_label, building_id)
select r.code, r.name, r.floor, b.id
  from (values
    ('A0M', 'دورة مياه الرجال', 'الدور الأرضي', 'المبنى الرئيسي'),
    ('A0F', 'دورة مياه النساء', 'الدور الأرضي', 'المبنى الرئيسي'),
    ('A1M', 'دورة مياه الرجال', 'الدور الأول',  'المبنى الرئيسي'),
    ('B0M', 'دورة مياه الرجال', 'الدور الأرضي', 'مبنى الخدمات'),
    ('B1F', 'دورة مياه النساء', 'الدور الأول',  'مبنى الخدمات'),
    ('B2M', 'دورة مياه الرجال', 'الدور الثاني', 'مبنى الخدمات')
  ) as r(code, name, floor, building)
  join public.buildings b on b.name = r.building
on conflict (code) do nothing;

-- 2) بنود التقييم وأوزانها (تُعدَّل لاحقًا من صفحة الإعدادات)
insert into public.checklist_items (key, "group", title, description, weight, default_weight, is_default, sort_order, is_active)
select i.key, i.grp::public.item_group, i.title, i.descr, i.weight, i.weight, true, i.sort, true
  from (values
    ('contractor_floors_sinks', 'contractor', 'نظافة دورات المياه', 'الأرضيات والأحواض والأدوات الصحية', 25, 10),
    ('contractor_odor', 'contractor', 'رائحة دورات المياه', null, 15, 20),
    ('contractor_fresheners', 'contractor', 'تعبئة الفواحات', null, 10, 30),
    ('contractor_mirrors_doors', 'contractor', 'نظافة المرايا والأبواب ومقابضها', null, 12, 40),
    ('contractor_glass_partitions', 'contractor', 'نظافة الزجاج والقواطع', null, 10, 50),
    ('contractor_waste', 'contractor', 'جمع النفايات وتفريغ السلال', null, 15, 60),
    ('contractor_work_plan', 'contractor', 'الالتزام بخطة العمل', null, 13, 70),
    ('deep_sinks_toilet_bases', 'deep', 'تنظيف وتعقيم الأحواض وقواعد الحمام', null, null, 10),
    ('deep_drains', 'deep', 'تنظيف البلاعات', null, null, 20),
    ('deep_glass_partitions', 'deep', 'تنظيف فواصل الزجاج بالكامل', null, null, 30),
    ('deep_ac_grilles', 'deep', 'تنظيف جريلات التكييف', null, null, 40),
    ('supervisor_cleanliness', 'supervisor', 'نظافة دورات المياه ومحتوياتها', null, 30, 10),
    ('supervisor_engineer_instructions', 'supervisor', 'الاستجابة لتعليمات المهندس المشرف', null, 15, 20),
    ('supervisor_emergency_response', 'supervisor', 'الاستجابة السريعة لأي حالة طارئة', null, 15, 30),
    ('supervisor_sanitary_maintenance', 'supervisor', 'صيانة الأجهزة الصحية وتأمين قطع الغيار', null, 18, 40),
    ('supervisor_lighting', 'supervisor', 'صيانة الإنارة والكشافات', null, 12, 50),
    ('supervisor_exhaust_fans', 'supervisor', 'صيانة مراوح الشفط', null, 10, 60)
  ) as i(key, grp, title, descr, weight, sort)
on conflict (key) do nothing;

-- 3) الإعدادات: «جزئي» 50% ويوم التنظيف العميق الاثنين
insert into public.settings (id, partial_credit_pct, deep_clean_weekday) values (true, 50, 1)
on conflict (id) do nothing;

-- 4) الحسابات: كلمة مرور عشوائية لكل حساب جديد
create temp table if not exists jodex_new_accounts (username text, full_name text, role text, password text);

create or replace function pg_temp.jodex_add_user(
  p_username text, p_full_name text, p_role public.user_role,
  p_kind public.monitor_kind default null, p_restroom_code text default null, p_substitute_for text default null
) returns void language plpgsql as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_email text := 'u-' || replace(gen_random_uuid()::text, '-', '') || '@jodex.local';
  v_password text := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', 'xyz');
begin
  if exists (select 1 from public.users where username = p_username) then
    return;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                       'jodex_role', p_role::text, 'jodex_username', p_username),
    '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  insert into public.users (id, username, full_name, role, monitor_kind, restroom_id, substitute_for_id)
  values (v_id, p_username, p_full_name, p_role, p_kind,
          (select id from public.restrooms where code = p_restroom_code),
          (select id from public.users where username = p_substitute_for));
  insert into jodex_new_accounts values (p_username, p_full_name, p_role::text, v_password);
end $fn$;

select pg_temp.jodex_add_user('khaled', 'خالد العتيبي', 'contractor_monitor', 'primary', 'A0M');
select pg_temp.jodex_add_user('noura', 'نورة الدوسري', 'contractor_monitor', 'primary', 'A0F');
select pg_temp.jodex_add_user('fahad', 'فهد الشمري', 'contractor_monitor', 'primary', 'A1M');
select pg_temp.jodex_add_user('saeed', 'سعيد القحطاني', 'contractor_monitor', 'primary', 'B0M');
select pg_temp.jodex_add_user('haya', 'هيا المطيري', 'contractor_monitor', 'primary', 'B1F');
select pg_temp.jodex_add_user('turki', 'تركي المالكي', 'contractor_monitor', 'primary', 'B2M');
select pg_temp.jodex_add_user('yaser', 'ياسر الزهراني', 'contractor_monitor', 'substitute', null, 'khaled');
select pg_temp.jodex_add_user('abdullah', 'عبدالله السبيعي', 'contractor_monitor', 'substitute', null, 'saeed');
select pg_temp.jodex_add_user('omar.z', 'عمر زليخة', 'contractor_monitor', 'substitute', null, 'turki');
select pg_temp.jodex_add_user('reem', 'ريم الغامدي', 'supervisor');
select pg_temp.jodex_add_user('salman', 'سلمان الحربي', 'supervisor');
select pg_temp.jodex_add_user('admin', 'عبدالرحمن الشهري', 'admin');

-- 5) إسناد المواقع لمشرفي الوزارة
insert into public.supervisor_assignments (supervisor_id, restroom_id)
select u.id, r.id
  from (values ('reem', 'A0M'), ('reem', 'A0F'), ('reem', 'A1M'),
               ('salman', 'B0M'), ('salman', 'B1F'), ('salman', 'B2M')) as a(username, code)
  join public.users u on u.username = a.username
  join public.restrooms r on r.code = a.code
on conflict do nothing;

-- 6) رمز QR عشوائي لكل دورة مياه لا تملك رمزًا نشطًا
insert into public.qr_codes (restroom_id, token)
select r.id, translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
  from public.restrooms r
 where not exists (select 1 from public.qr_codes q where q.restroom_id = r.id and q.is_active);

-- 7) جولات اليوم
select public.ensure_daily_rounds((now() at time zone 'Asia/Riyadh')::date);
select public.close_overdue_rounds(now());

-- الحسابات الجديدة وكلمات مرورها (تظهر مرة واحدة — احفظها الآن)
select username as "اسم المستخدم", full_name as "الاسم", role as "الدور", password as "كلمة المرور"
  from jodex_new_accounts;
