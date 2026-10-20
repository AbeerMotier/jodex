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
