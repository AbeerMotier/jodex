-- =====================================================================
-- جُودِكس — الأمان: Row Level Security وصلاحيات الأدوار
-- المبدأ: القراءة عبر RLS حسب الدور والنطاق، والكتابة كلها من الخادم
-- (service_role) بعد التحقق من الجلسة والدور وقواعد العمل.
-- لا توجد أي سياسة INSERT/UPDATE/DELETE للأدوار anon و authenticated.
-- =====================================================================

grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- دوال مساعدة لسياسات RLS (security definer لتجنّب التكرار الذاتي في users)
-- ---------------------------------------------------------------------
create or replace function app.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select u.role from public.users u
   where u.id = (select auth.uid()) and u.is_active
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = (select auth.uid()) and u.is_active and u.role = 'admin'
  )
$$;

-- دورة المياه التي يعمل عليها المراقب: الأساسي = دورته، النائب = دورة الأساسي الذي ينوب عنه
create or replace function app.monitor_restroom_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case
           when u.monitor_kind = 'primary' then u.restroom_id
           when u.monitor_kind = 'substitute' then p.restroom_id
         end
    from public.users u
    left join public.users p
      on p.id = u.substitute_for_id and p.is_active and p.monitor_kind = 'primary'
   where u.id = (select auth.uid()) and u.is_active and u.role = 'contractor_monitor'
$$;

create or replace function app.supervisor_restroom_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.restroom_id
    from public.supervisor_assignments a
    join public.users u on u.id = a.supervisor_id
   where a.supervisor_id = (select auth.uid()) and u.is_active and u.role = 'supervisor'
$$;

revoke all on function app.current_user_role() from public;
revoke all on function app.is_admin() from public;
revoke all on function app.monitor_restroom_id() from public;
revoke all on function app.supervisor_restroom_ids() from public;
grant execute on function app.current_user_role() to authenticated, service_role;
grant execute on function app.is_admin() to authenticated, service_role;
grant execute on function app.monitor_restroom_id() to authenticated, service_role;
grant execute on function app.supervisor_restroom_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- تفعيل RLS على كل الجداول
-- ---------------------------------------------------------------------
alter table public.buildings enable row level security;
alter table public.restrooms enable row level security;
alter table public.users enable row level security;
alter table public.supervisor_assignments enable row level security;
alter table public.qr_codes enable row level security;
alter table public.checklist_items enable row level security;
alter table public.settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.rounds enable row level security;
alter table public.round_answers enable row level security;
alter table public.round_photos enable row level security;
alter table public.round_drafts enable row level security;
alter table public.supervisor_evaluations enable row level security;
alter table public.supervisor_ratings enable row level security;
alter table public.supervisor_photos enable row level security;
alter table public.supervisor_notes enable row level security;
alter table public.feedback_reasons enable row level security;
alter table public.beneficiary_feedback enable row level security;
alter table public.beneficiary_feedback_reasons enable row level security;
alter table public.bonus_approvals enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_attempts enable row level security;
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------
-- سحب صلاحيات الكتابة من الأدوار العامة (حماية إضافية فوق RLS)
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- الجداول التقنية والحساسة: لا قراءة إطلاقًا لغير service_role
revoke select on public.login_attempts, public.rate_limits from anon, authenticated;
-- لا قراءة لأي جدول من الدور anon إلا قائمة أسباب عدم الرضا
revoke select on all tables in schema public from anon;
alter default privileges in schema public revoke select on tables from anon;
grant select on public.feedback_reasons to anon;

-- ---------------------------------------------------------------------
-- سياسات القراءة
-- ---------------------------------------------------------------------

-- المستخدمون: كل مستخدم يرى صفه، والأدمن يرى الجميع
create policy users_select_self on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy users_select_admin on public.users
  for select to authenticated using ((select app.is_admin()));

-- دورات المياه: الأدمن الكل، المراقب دورته فقط، المشرف المواقع المسندة إليه
create policy restrooms_select on public.restrooms
  for select to authenticated using (
    (select app.is_admin())
    or id = (select app.monitor_restroom_id())
    or id in (select app.supervisor_restroom_ids())
  );

create policy buildings_select on public.buildings
  for select to authenticated using (
    (select app.is_admin())
    or exists (
      select 1 from public.restrooms r
       where r.building_id = buildings.id
         and (r.id = (select app.monitor_restroom_id())
              or r.id in (select app.supervisor_restroom_ids()))
    )
  );

create policy supervisor_assignments_select on public.supervisor_assignments
  for select to authenticated using (
    (select app.is_admin()) or supervisor_id = (select auth.uid())
  );

-- رموز QR: الأدمن فقط (الصفحة العامة تُخدم من الخادم)
create policy qr_codes_select_admin on public.qr_codes
  for select to authenticated using ((select app.is_admin()));

-- البنود والإعدادات: أي مستخدم نشط (لبناء نماذج التقييم)
create policy checklist_items_select on public.checklist_items
  for select to authenticated using ((select app.current_user_role()) is not null);
create policy settings_select on public.settings
  for select to authenticated using ((select app.current_user_role()) is not null);
create policy settings_history_select_admin on public.settings_history
  for select to authenticated using ((select app.is_admin()));

-- الجولات: الأدمن الكل، المراقب جولات دورته، المشرف (قراءة فقط) جولات مواقعه للتحقق الرقابي
create policy rounds_select on public.rounds
  for select to authenticated using (
    (select app.is_admin())
    or restroom_id = (select app.monitor_restroom_id())
    or restroom_id in (select app.supervisor_restroom_ids())
  );
-- التوابع ترث رؤية الجولة (الاستعلام الفرعي يخضع لسياسة rounds)
create policy round_answers_select on public.round_answers
  for select to authenticated using (
    exists (select 1 from public.rounds r where r.id = round_answers.round_id)
  );
create policy round_photos_select on public.round_photos
  for select to authenticated using (
    exists (select 1 from public.rounds r where r.id = round_photos.round_id)
  );
create policy round_drafts_select_own on public.round_drafts
  for select to authenticated using (monitor_id = (select auth.uid()));

-- تقييمات المشرف: المشرف تقييماته، والأدمن الكل
create policy supervisor_evaluations_select on public.supervisor_evaluations
  for select to authenticated using (
    (select app.is_admin()) or supervisor_id = (select auth.uid())
  );
create policy supervisor_ratings_select on public.supervisor_ratings
  for select to authenticated using (
    exists (select 1 from public.supervisor_evaluations e where e.id = supervisor_ratings.evaluation_id)
  );
create policy supervisor_photos_select on public.supervisor_photos
  for select to authenticated using (
    exists (select 1 from public.supervisor_evaluations e where e.id = supervisor_photos.evaluation_id)
  );
create policy supervisor_notes_select on public.supervisor_notes
  for select to authenticated using (
    (select app.is_admin()) or supervisor_id = (select auth.uid())
  );

-- أسباب عدم الرضا: قائمة ثابتة عامة
create policy feedback_reasons_select on public.feedback_reasons
  for select to anon, authenticated using (true);

-- تقييمات المستفيدين: الأدمن فقط
create policy beneficiary_feedback_select_admin on public.beneficiary_feedback
  for select to authenticated using ((select app.is_admin()));
create policy beneficiary_feedback_reasons_select_admin on public.beneficiary_feedback_reasons
  for select to authenticated using ((select app.is_admin()));

-- المكافآت وسجل التدقيق: الأدمن فقط
create policy bonus_approvals_select_admin on public.bonus_approvals
  for select to authenticated using ((select app.is_admin()));
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ((select app.is_admin()));

-- login_attempts و rate_limits: بلا سياسات (service_role فقط)
