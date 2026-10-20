-- =====================================================================
-- جُودِكس — مستويات صلاحية الأدمن (20 أكتوبر 2026، الدفعة الثانية)
-- قبل التشغيل: ضع كلمة مرور قوية بدل CHANGE_ME_PASSWORD (للحساب الرئيسي admin).
-- آمن لإعادة التشغيل.
-- =====================================================================
begin;
-- =====================================================================
-- جُودِكس — مستويات صلاحية الأدمن (طلب الجهة 20 أكتوبر 2026)
--   super      : الأدمن الرئيسي — كل النظام وكل الحسابات
--   restricted : أدمن مقيّد — يطّلع ويعدّل ويضيف الحسابات، ولا يرى حساب الأدمن الرئيسي إطلاقًا
--   viewer     : مطّلع — يرى كل النظام بلا تعديل ولا إضافة ولا حذف
-- (القيم السابقة: full ← super، limited ← viewer)
-- =====================================================================
alter table public.users drop constraint if exists users_admin_scope_check;
update public.users set admin_scope = 'super' where admin_scope = 'full';
update public.users set admin_scope = 'viewer' where admin_scope = 'limited';
update public.users set admin_scope = 'restricted' where role <> 'admin' and admin_scope <> 'restricted';
alter table public.users alter column admin_scope set default 'restricted';
alter table public.users add constraint users_admin_scope_check check (admin_scope in ('super', 'restricted', 'viewer'));
comment on column public.users.admin_scope is
  'للأدمن فقط: super = الأدمن الرئيسي، restricted = إدارة كاملة دون رؤية الأدمن الرئيسي، viewer = اطلاع فقط';

-- من يحق له حفظ الإعدادات والأوزان (تحقق دفاعي في save_settings_tx)
create or replace function app.is_full_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = p_user and u.is_active and u.role = 'admin' and u.admin_scope in ('super', 'restricted')
  )
$$;
revoke all on function app.is_full_admin(uuid) from public, anon, authenticated;
grant execute on function app.is_full_admin(uuid) to service_role;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = (select auth.uid()) and u.is_active and u.role = 'admin' and u.admin_scope = 'super'
  )
$$;
revoke all on function app.is_super_admin() from public;
grant execute on function app.is_super_admin() to authenticated, service_role;

-- حساب الأدمن الرئيسي مخفي عن غيره حتى في القراءة المباشرة من قاعدة البيانات
alter policy users_select_admin on public.users using (
  (select app.is_admin())
  and (not (role = 'admin' and admin_scope = 'super') or (select app.is_super_admin()))
);

-- ---------------------------------------------------------------------
-- بيانات الجهة: مستويات الصلاحية والحساب الرئيسي
-- ---------------------------------------------------------------------
-- الأدمن المقيّد: حسام باشويه وفايز ميره
update public.users set role = 'admin', admin_scope = 'restricted', monitor_kind = null, substitute_for_id = null
 where username in ('facilities.manager', 'fmira');
delete from public.supervisor_assignments a using public.users u
 where u.id = a.supervisor_id and u.username = 'fmira' and u.role <> 'supervisor';
-- المطّلع (عرض فقط): سلطان الجبالي وإيهاب سمارن
update public.users set role = 'admin', admin_scope = 'viewer' where username in ('s.aljabali', 'unit.manager');
-- الدور في جلسة الدخول
update auth.users au set raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('jodex_role', u.role::text)
  from public.users u where u.id = au.id and u.username in ('facilities.manager', 'fmira', 's.aljabali', 'unit.manager');

-- الأدمن الرئيسي: اسم المستخدم admin (يُنشأ مرة واحدة)
do $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := 'u-' || substr(md5(random()::text), 1, 16) || '@' || coalesce(
    (select split_part(email, '@', 2) from auth.users where email like 'u-%@%' limit 1), 'users.jodex.local');
begin
  if exists (select 1 from public.users where username = 'admin') then
    update public.users set role = 'admin', admin_scope = 'super', is_active = true where username = 'admin';
    return;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt('CHANGE_ME_PASSWORD', extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'jodex_role', 'admin', 'jodex_username', 'admin'),
          '{}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', v_id::text, now(), now(), now());
  insert into public.users (id, username, full_name, role, admin_scope)
  values (v_id, 'admin', 'الأدمن', 'admin', 'super');
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (null, 'users.create', 'users', v_id::text, jsonb_build_object('username', 'admin', 'admin_scope', 'super', 'via', 'sql'));
end $$;
commit;
