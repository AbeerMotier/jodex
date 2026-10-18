-- =====================================================================
-- جُودِكس — ثلاثة حسابات فقط: أدمن + مراقب مقاول + مشرف وزارة
-- عدّل القيم في «الإعدادات» فقط، ثم الصق الملف كاملًا في Supabase SQL Editor واضغط Run.
-- يمكن تشغيله أكثر من مرة: يحدّث الأسماء وكلمات المرور ولا يكرر شيئًا.
-- الحسابات الأخرى تُعطَّل (لا تُحذف) ويمكن إعادتها لاحقًا.
-- يتطلب تشغيل ملف الجداول وملف البيانات الأساسية قبله (دورات المياه موجودة).
-- =====================================================================

-- ======================= الإعدادات (عدّل هنا فقط) =======================
create temp table if not exists jodex_settings (key text primary key, value text);
truncate jodex_settings;
insert into jodex_settings values
  -- الأدمن (كل الصلاحيات)
  ('admin_username',      'admin'),
  ('admin_name',          'مدير النظام'),
  ('admin_password',      'Admin-Change-2026!'),
  -- مراقب المقاول (يرسل الجولات)
  ('monitor_username',    'monitor'),
  ('monitor_name',        'مراقب المقاول'),
  ('monitor_password',    'Monitor-Change-2026!'),
  ('monitor_restroom',    'A0M'),            -- كود دورة المياه المسؤول عنها
  -- مشرف الوزارة (يقيّم المواقع)
  ('supervisor_username', 'supervisor'),
  ('supervisor_name',     'مشرف الوزارة'),
  ('supervisor_password', 'Supervisor-Change-2026!'),
  -- تعطيل كل الحسابات الأخرى؟ (yes / no)
  ('disable_others',      'yes');
-- =====================================================================

create or replace function pg_temp.cfg(k text) returns text language sql as $$
  select value from jodex_settings where key = k
$$;

create or replace function pg_temp.jodex_upsert_user(
  p_username text, p_full_name text, p_role public.user_role, p_password text,
  p_kind public.monitor_kind default null, p_restroom_code text default null
) returns void language plpgsql as $fn$
declare
  v_id uuid;
  v_restroom uuid;
  v_meta jsonb := jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                                     'jodex_role', p_role::text, 'jodex_username', p_username);
begin
  if p_username !~ '^[a-z0-9._-]{2,32}$' then
    raise exception 'اسم المستخدم "%" غير صالح: حروف إنجليزية صغيرة وأرقام و . _ - فقط', p_username;
  end if;
  if length(p_password) < 8 then
    raise exception 'كلمة مرور "%" قصيرة جدًا (8 أحرف على الأقل، ويُفضّل 12)', p_username;
  end if;
  if p_restroom_code is not null then
    select id into v_restroom from public.restrooms where code = upper(p_restroom_code) and is_active;
    if v_restroom is null then raise exception 'دورة المياه "%" غير موجودة', p_restroom_code; end if;
  end if;

  select id into v_id from public.users where username = p_username;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'u-' || replace(gen_random_uuid()::text, '-', '') || '@jodex.local',
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      v_meta, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), v_id, v_id::text, 'email',
           jsonb_build_object('sub', v_id::text, 'email', email, 'email_verified', true), now(), now(), now()
      from auth.users where id = v_id;
    insert into public.users (id, username, full_name, role, monitor_kind, restroom_id)
    values (v_id, p_username, p_full_name, p_role, p_kind, v_restroom);
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || v_meta,
           banned_until = null, updated_at = now()
     where id = v_id;
    update public.users
       set full_name = p_full_name, role = p_role, monitor_kind = p_kind,
           restroom_id = v_restroom, substitute_for_id = null, is_active = true
     where id = v_id;
  end if;
  delete from public.login_attempts where username = p_username;
end $fn$;

-- 1) تعطيل الحسابات الأخرى (قبل الإنشاء حتى تتحرر دورة المياه للمراقب الجديد)
update public.users
   set is_active = false
 where pg_temp.cfg('disable_others') = 'yes'
   and username not in (pg_temp.cfg('admin_username'), pg_temp.cfg('monitor_username'), pg_temp.cfg('supervisor_username'));
update auth.users a
   set banned_until = '2999-01-01'
  from public.users u
 where u.id = a.id and not u.is_active;

-- إن بقي مراقب أساسي فعّال آخر على نفس دورة المياه يُعطَّل (لكل دورة مياه مراقب أساسي واحد)
update public.users
   set is_active = false
 where monitor_kind = 'primary' and is_active
   and restroom_id = (select id from public.restrooms where code = upper(pg_temp.cfg('monitor_restroom')))
   and username <> pg_temp.cfg('monitor_username');

-- 2) الحسابات الثلاثة
select pg_temp.jodex_upsert_user(pg_temp.cfg('admin_username'), pg_temp.cfg('admin_name'), 'admin', pg_temp.cfg('admin_password'));
select pg_temp.jodex_upsert_user(pg_temp.cfg('monitor_username'), pg_temp.cfg('monitor_name'), 'contractor_monitor',
                                 pg_temp.cfg('monitor_password'), 'primary', pg_temp.cfg('monitor_restroom'));
select pg_temp.jodex_upsert_user(pg_temp.cfg('supervisor_username'), pg_temp.cfg('supervisor_name'), 'supervisor', pg_temp.cfg('supervisor_password'));

-- 3) المشرف يقيّم كل دورات المياه النشطة
insert into public.supervisor_assignments (supervisor_id, restroom_id)
select u.id, r.id
  from public.users u cross join public.restrooms r
 where u.username = pg_temp.cfg('supervisor_username') and r.is_active
on conflict do nothing;

-- 4) جولات اليوم لدورة مياه المراقب الجديد
select public.ensure_daily_rounds((now() at time zone 'Asia/Riyadh')::date);

-- النتيجة: الحسابات الفعّالة الآن
select u.username as "اسم المستخدم", u.full_name as "الاسم", u.role as "الدور", r.code as "دورة المياه"
  from public.users u left join public.restrooms r on r.id = u.restroom_id
 where u.is_active
 order by u.role;
