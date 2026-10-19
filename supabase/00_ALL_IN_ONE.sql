-- =====================================================================
-- جُودِكس — كل الجداول والصلاحيات والدوال في ملف واحد (بديل npx supabase db push)
-- الصقه كاملًا في Supabase ← SQL Editor ← New query ← Run (مرة واحدة فقط على مشروع جديد).
-- يعمل داخل معاملة واحدة: إن فشل أي جزء لا يُحفظ شيء.
-- مُولَّد من مجلد supabase/migrations — لا تعدّله يدويًا.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.users') is not null then
    raise exception 'الجداول موجودة مسبقًا في هذا المشروع — لا تحتاج هذا الملف. انتقل إلى ملف البيانات';
  end if;
end $$;

-- ===== 20261015000100_schema.sql =====
-- =====================================================================
-- جُودِكس — المخطط الأساسي لقاعدة البيانات (Supabase PostgreSQL)
-- كل الأوقات تُخزَّن timestamptz، والتواريخ التشغيلية (round_date) بتوقيت Asia/Riyadh.
-- =====================================================================

create schema if not exists app;
comment on schema app is 'دوال داخلية مساعدة (غير معروضة عبر واجهة PostgREST).';

-- ---------------------------------------------------------------------
-- الأنواع
-- ---------------------------------------------------------------------
create type public.user_role as enum ('admin', 'supervisor', 'contractor_monitor');
create type public.monitor_kind as enum ('primary', 'substitute');
create type public.item_group as enum ('contractor', 'deep', 'supervisor');
create type public.shift as enum ('am', 'pm');
create type public.round_status as enum ('pending', 'submitted', 'missed');
create type public.compliance_level as enum ('full', 'behind', 'non');
create type public.round_answer as enum ('done', 'partial', 'not_done');
create type public.photo_slot as enum ('tools', 'entry', 'sinks', 'toilets', 'general', 'labor');
create type public.yes_no as enum ('yes', 'no');
create type public.note_severity as enum ('high', 'mid', 'low');
create type public.period_type as enum ('today', 'week', 'month');

-- ---------------------------------------------------------------------
-- دوال مساعدة عامة
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- المباني ودورات المياه
-- ---------------------------------------------------------------------
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  created_at timestamptz not null default now(),
  constraint buildings_name_key unique (name)
);

create table public.restrooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9-]{2,16}$'),
  building_id uuid not null references public.buildings(id) on delete restrict,
  floor_label text not null check (length(btrim(floor_label)) between 1 and 60),
  name text not null check (length(btrim(name)) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint restrooms_code_key unique (code)
);
create index restrooms_building_idx on public.restrooms (building_id);

-- ---------------------------------------------------------------------
-- المستخدمون (الهوية وكلمات المرور في Supabase Auth: auth.users)
-- ---------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  username text not null check (username = lower(username) and username ~ '^[a-z0-9._-]{2,32}$'),
  role public.user_role not null,
  monitor_kind public.monitor_kind,
  restroom_id uuid references public.restrooms(id) on delete restrict,
  substitute_for_id uuid references public.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_key unique (username),
  constraint users_monitor_shape check (
    (role = 'contractor_monitor' and monitor_kind = 'primary'
      and restroom_id is not null and substitute_for_id is null)
    or (role = 'contractor_monitor' and monitor_kind = 'substitute'
      and restroom_id is null and substitute_for_id is not null)
    or (role <> 'contractor_monitor' and monitor_kind is null
      and restroom_id is null and substitute_for_id is null)
  ),
  constraint users_not_self_substitute check (substitute_for_id is null or substitute_for_id <> id)
);
-- مراقب أساسي نشط واحد فقط لكل دورة مياه
create unique index users_one_active_primary_per_restroom
  on public.users (restroom_id) where monitor_kind = 'primary' and is_active;
create index users_substitute_for_idx on public.users (substitute_for_id);
create trigger users_touch before update on public.users
  for each row execute function app.touch_updated_at();

-- النائب يجب أن ينوب عن مراقب أساسي
create or replace function app.validate_user_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.monitor_kind = 'substitute' then
    if not exists (
      select 1 from public.users p
       where p.id = new.substitute_for_id
         and p.role = 'contractor_monitor' and p.monitor_kind = 'primary'
    ) then
      raise exception 'substitute_must_reference_primary' using errcode = '23514';
    end if;
  end if;
  -- لا يجوز تحويل مراقب أساسي له نواب إلى غير أساسي
  if tg_op = 'UPDATE' and old.monitor_kind = 'primary' and new.monitor_kind is distinct from 'primary' then
    if exists (select 1 from public.users s where s.substitute_for_id = new.id) then
      raise exception 'primary_has_substitutes' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger users_validate_links before insert or update on public.users
  for each row execute function app.validate_user_links();

-- ---------------------------------------------------------------------
-- إسناد المواقع لمشرفي الوزارة
-- ---------------------------------------------------------------------
create table public.supervisor_assignments (
  supervisor_id uuid not null references public.users(id) on delete cascade,
  restroom_id uuid not null references public.restrooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint supervisor_assignments_pkey primary key (supervisor_id, restroom_id)
);
create index supervisor_assignments_restroom_idx on public.supervisor_assignments (restroom_id);

create or replace function app.validate_supervisor_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.users u where u.id = new.supervisor_id and u.role = 'supervisor') then
    raise exception 'assignment_requires_supervisor' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger supervisor_assignments_validate before insert or update on public.supervisor_assignments
  for each row execute function app.validate_supervisor_assignment();

-- ---------------------------------------------------------------------
-- رموز QR (الرابط العام: /r/{token})
-- ---------------------------------------------------------------------
create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  restroom_id uuid not null references public.restrooms(id) on delete cascade,
  token text not null check (token ~ '^[A-Za-z0-9_-]{22,128}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint qr_codes_token_key unique (token)
);
create unique index qr_codes_one_active_per_restroom on public.qr_codes (restroom_id) where is_active;

-- ---------------------------------------------------------------------
-- بنود التقييم (قابلة للإدارة من الأدمن)
-- contractor و supervisor بنود محتسبة بوزن، deep قائمة تحقق بلا وزن.
-- ---------------------------------------------------------------------
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_]{2,64}$'),
  "group" public.item_group not null,
  title text not null check (length(btrim(title)) between 2 and 200),
  description text check (description is null or length(description) <= 500),
  weight numeric(5,2) check (weight is null or (weight >= 0 and weight <= 100)),
  default_weight numeric(5,2) check (default_weight is null or (default_weight >= 0 and default_weight <= 100)),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_items_key_key unique (key),
  constraint checklist_items_weight_by_group check (
    ("group" = 'deep' and weight is null and default_weight is null)
    or ("group" <> 'deep' and weight is not null)
  )
);
create index checklist_items_group_idx on public.checklist_items ("group", sort_order);
create trigger checklist_items_touch before update on public.checklist_items
  for each row execute function app.touch_updated_at();

-- لا يُسمح بتغيير مجموعة بند بعد إنشائه (حفاظًا على سلامة الإجابات التاريخية)
create or replace function app.guard_item_group() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new."group" <> old."group" then
    raise exception 'item_group_immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger checklist_items_guard_group before update on public.checklist_items
  for each row execute function app.guard_item_group();

-- ---------------------------------------------------------------------
-- الإعدادات (صف واحد) وسجل التغييرات
-- ---------------------------------------------------------------------
create table public.settings (
  id boolean primary key default true check (id),
  partial_credit_pct numeric(5,2) not null default 50 check (partial_credit_pct between 0 and 100),
  deep_clean_weekday smallint not null default 1 check (deep_clean_weekday between 0 and 6),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on column public.settings.deep_clean_weekday is '0=الأحد … 6=السبت';

create table public.settings_history (
  id bigint generated always as identity primary key,
  snapshot jsonb not null,
  recalculation jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index settings_history_changed_at_idx on public.settings_history (changed_at desc);

-- ---------------------------------------------------------------------
-- جولات مراقب المقاول
-- ---------------------------------------------------------------------
create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  restroom_id uuid not null references public.restrooms(id) on delete restrict,
  round_date date not null,
  shift public.shift not null,
  assigned_monitor_id uuid not null references public.users(id) on delete restrict,
  status public.round_status not null default 'pending',
  executed_by_id uuid references public.users(id) on delete restrict,
  on_behalf_of_id uuid references public.users(id) on delete restrict,
  started_at timestamptz,
  submitted_at timestamptz,
  compliance_level public.compliance_level,
  compliance_score numeric(5,2) check (compliance_score between 0 and 100),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  weights_snapshot jsonb,
  note text check (note is null or length(note) <= 2000),
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rounds_restroom_date_shift_key unique (restroom_id, round_date, shift),
  constraint rounds_status_shape check (
    (status = 'pending' and submitted_at is null and compliance_level is null
      and compliance_score is null and quality_score is null and executed_by_id is null)
    or (status = 'submitted' and submitted_at is not null and compliance_level is not null
      and compliance_score is not null and quality_score is not null
      and executed_by_id is not null and weights_snapshot is not null)
    or (status = 'missed' and submitted_at is null and compliance_level is null
      and compliance_score = 0 and quality_score is null and executed_by_id is null)
  )
);
create index rounds_date_idx on public.rounds (round_date desc);
create index rounds_assigned_date_idx on public.rounds (assigned_monitor_id, round_date desc);
create index rounds_pending_idx on public.rounds (round_date) where status = 'pending';
create index rounds_submitted_at_idx on public.rounds (submitted_at desc);

-- الجولة المرسلة أو الفائتة لا تُعدَّل (باستثناء إعادة احتساب الدرجة من دالة الإعدادات)
create or replace function app.guard_round_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'round_locked' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'pending' then
    return new;
  end if;
  if coalesce(current_setting('jodex.allow_recalc', true), '') = 'on'
     and new.status = old.status
     and new.restroom_id = old.restroom_id and new.round_date = old.round_date and new.shift = old.shift
     and new.assigned_monitor_id = old.assigned_monitor_id
     and new.submitted_at is not distinct from old.submitted_at
     and new.compliance_level is not distinct from old.compliance_level
     and new.compliance_score is not distinct from old.compliance_score
     and new.executed_by_id is not distinct from old.executed_by_id
     and new.on_behalf_of_id is not distinct from old.on_behalf_of_id
     and new.note is not distinct from old.note then
    return new;
  end if;
  raise exception 'round_locked' using errcode = 'P0001';
end $$;
create trigger rounds_guard before update or delete on public.rounds
  for each row execute function app.guard_round_change();
create trigger rounds_touch before update on public.rounds
  for each row execute function app.touch_updated_at();

create table public.round_answers (
  round_id uuid not null references public.rounds(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete restrict,
  answer public.round_answer not null,
  constraint round_answers_pkey primary key (round_id, item_id)
);
create index round_answers_item_idx on public.round_answers (item_id);

create table public.round_photos (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  slot public.photo_slot not null,
  storage_key text not null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_at timestamptz not null default now(),
  constraint round_photos_round_slot_key unique (round_id, slot),
  constraint round_photos_storage_key_key unique (storage_key)
);

-- الإجابات والصور لا تتغير إلا والجولة قيد التنفيذ
create or replace function app.guard_round_children() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_round_id uuid := case when tg_op = 'DELETE' then old.round_id else new.round_id end;
  v_status public.round_status;
begin
  select r.status into v_status from public.rounds r where r.id = v_round_id;
  -- عند حذف الجولة نفسها (cascade) لا توجد جولة بعد
  if v_status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status <> 'pending' then
    raise exception 'round_locked' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger round_answers_guard before insert or update or delete on public.round_answers
  for each row execute function app.guard_round_children();
create trigger round_photos_guard before insert or update or delete on public.round_photos
  for each row execute function app.guard_round_children();

-- مسودات المراقب (لا تُحتسب في أي مؤشر)
create table public.round_drafts (
  monitor_id uuid not null references public.users(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint round_drafts_pkey primary key (monitor_id, round_id)
);
create index round_drafts_round_idx on public.round_drafts (round_id);

-- ---------------------------------------------------------------------
-- تقييمات مشرف الوزارة (submitted_at = null تعني تقييمًا قيد التعبئة)
-- ---------------------------------------------------------------------
create table public.supervisor_evaluations (
  id uuid primary key default gen_random_uuid(),
  restroom_id uuid not null references public.restrooms(id) on delete restrict,
  supervisor_id uuid not null references public.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  viewed_contractor_rounds boolean not null default false,
  viewed_contractor_rounds_at timestamptz,
  matches_round public.yes_no,
  needs_urgent public.yes_no,
  note text check (note is null or length(note) <= 2000),
  score numeric(5,2) check (score between 0 and 100),
  weights_snapshot jsonb,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint supervisor_evaluations_viewed_shape
    check (viewed_contractor_rounds = (viewed_contractor_rounds_at is not null)),
  constraint supervisor_evaluations_match_requires_view
    check (matches_round is null or viewed_contractor_rounds),
  constraint supervisor_evaluations_submitted_shape check (
    submitted_at is null
    or (matches_round is not null and needs_urgent is not null
        and score is not null and weights_snapshot is not null)
  )
);
create index supervisor_evaluations_submitted_idx on public.supervisor_evaluations (submitted_at desc)
  where submitted_at is not null;
create index supervisor_evaluations_restroom_idx on public.supervisor_evaluations (restroom_id, submitted_at desc);
create index supervisor_evaluations_supervisor_idx on public.supervisor_evaluations (supervisor_id, started_at desc);

create or replace function app.guard_evaluation_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.submitted_at is not null then
      raise exception 'evaluation_locked' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.submitted_at is null then
    return new;
  end if;
  if coalesce(current_setting('jodex.allow_recalc', true), '') = 'on'
     and new.submitted_at = old.submitted_at
     and new.restroom_id = old.restroom_id and new.supervisor_id = old.supervisor_id
     and new.matches_round is not distinct from old.matches_round
     and new.needs_urgent is not distinct from old.needs_urgent
     and new.note is not distinct from old.note then
    return new;
  end if;
  raise exception 'evaluation_locked' using errcode = 'P0001';
end $$;
create trigger supervisor_evaluations_guard before update or delete on public.supervisor_evaluations
  for each row execute function app.guard_evaluation_change();

create table public.supervisor_ratings (
  evaluation_id uuid not null references public.supervisor_evaluations(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  constraint supervisor_ratings_pkey primary key (evaluation_id, item_id)
);
create index supervisor_ratings_item_idx on public.supervisor_ratings (item_id);

create table public.supervisor_photos (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.supervisor_evaluations(id) on delete cascade,
  storage_key text not null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_at timestamptz not null default now(),
  constraint supervisor_photos_storage_key_key unique (storage_key)
);
create index supervisor_photos_evaluation_idx on public.supervisor_photos (evaluation_id);

create or replace function app.guard_evaluation_children() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_eval_id uuid := case when tg_op = 'DELETE' then old.evaluation_id else new.evaluation_id end;
  v_exists boolean;
  v_submitted timestamptz;
begin
  select true, e.submitted_at into v_exists, v_submitted
    from public.supervisor_evaluations e where e.id = v_eval_id;
  if v_exists is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_submitted is not null then
    raise exception 'evaluation_locked' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger supervisor_ratings_guard before insert or update or delete on public.supervisor_ratings
  for each row execute function app.guard_evaluation_children();
create trigger supervisor_photos_guard before insert or update or delete on public.supervisor_photos
  for each row execute function app.guard_evaluation_children();

create table public.supervisor_notes (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.supervisor_evaluations(id) on delete cascade,
  restroom_id uuid not null references public.restrooms(id) on delete restrict,
  supervisor_id uuid not null references public.users(id) on delete restrict,
  text text not null check (length(btrim(text)) between 1 and 2000),
  severity public.note_severity not null,
  created_at timestamptz not null default now(),
  constraint supervisor_notes_evaluation_key unique (evaluation_id)
);
create index supervisor_notes_created_idx on public.supervisor_notes (created_at desc);

-- ---------------------------------------------------------------------
-- تقييمات المستفيدين (بدون حساب)
-- ---------------------------------------------------------------------
create table public.feedback_reasons (
  id smallint primary key,
  key text not null,
  label text not null,
  sort_order smallint not null,
  requires_text boolean not null default false,
  constraint feedback_reasons_key_key unique (key)
);

-- قائمة ثابتة
insert into public.feedback_reasons (id, key, label, sort_order, requires_text) values
  (1, 'not_clean', 'دورة المياه غير نظيفة', 1, false),
  (2, 'odors', 'فيه روائح', 2, false),
  (3, 'floor_dirty_wet', 'الأرضية متسخة أو مبللة', 3, false),
  (4, 'supplies_missing', 'المستلزمات ناقصة', 4, false),
  (5, 'other', 'أخرى', 5, true);

create table public.beneficiary_feedback (
  id uuid primary key default gen_random_uuid(),
  restroom_id uuid not null references public.restrooms(id) on delete restrict,
  qr_code_id uuid not null references public.qr_codes(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  rating smallint not null check (rating in (1, 4, 5)),
  other_text text check (other_text is null or length(btrim(other_text)) between 1 and 500),
  client_hash text not null check (length(client_hash) between 16 and 128)
);
comment on column public.beneficiary_feedback.rating is 'excellent=5 | good=4 | bad=1';
create index beneficiary_feedback_submitted_idx on public.beneficiary_feedback (submitted_at desc);
create index beneficiary_feedback_restroom_idx on public.beneficiary_feedback (restroom_id, submitted_at desc);
create index beneficiary_feedback_client_idx on public.beneficiary_feedback (client_hash, restroom_id, submitted_at desc);

create table public.beneficiary_feedback_reasons (
  feedback_id uuid not null references public.beneficiary_feedback(id) on delete cascade,
  reason_id smallint not null references public.feedback_reasons(id) on delete restrict,
  constraint beneficiary_feedback_reasons_pkey primary key (feedback_id, reason_id)
);

-- ---------------------------------------------------------------------
-- اعتماد المكافآت
-- ---------------------------------------------------------------------
create table public.bonus_approvals (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.users(id) on delete cascade,
  period_type public.period_type not null,
  period_start date not null,
  period_end date not null,
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint bonus_approvals_period_check check (period_end >= period_start)
);
create unique index bonus_approvals_one_active
  on public.bonus_approvals (monitor_id, period_type, period_start, period_end)
  where revoked_at is null;

-- ---------------------------------------------------------------------
-- سجل التدقيق
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

-- ---------------------------------------------------------------------
-- جداول تقنية: قفل الدخول وتحديد معدل الطلبات
-- ---------------------------------------------------------------------
create table public.login_attempts (
  username text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- ===== 20261015000200_security.sql =====
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

-- ===== 20261015000300_functions.sql =====
-- =====================================================================
-- جُودِكس — دوال العمل الذرّية (تُستدعى من الخادم بدور service_role فقط)
-- القواعد الحسابية تُطبَّق في طبقة الخادم (TypeScript) وتُعاد هنا
-- كتحقق دفاعي، والدوال تضمن الذرّية ومنع الإرسال المكرر.
-- =====================================================================

-- آخر موعد للإنهاء بالدقائق من منتصف الليل (Asia/Riyadh): صباحية 11:00، مسائية 16:00
create or replace function app.shift_deadline_minutes(p_shift public.shift) returns integer
language sql immutable set search_path = '' as $$
  select case p_shift when 'am' then 660 else 960 end
$$;

-- بداية الجولة بالدقائق: صباحية 07:30، مسائية 13:00
create or replace function app.shift_start_minutes(p_shift public.shift) returns integer
language sql immutable set search_path = '' as $$
  select case p_shift when 'am' then 450 else 780 end
$$;

-- ---------------------------------------------------------------------
-- إنشاء جولات اليوم: جولتان pending لكل دورة مياه نشطة لها مراقب أساسي نشط
-- ---------------------------------------------------------------------
create or replace function public.ensure_daily_rounds(p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.rounds (restroom_id, round_date, shift, assigned_monitor_id)
  select r.id, p_date, s.shift, u.id
    from public.restrooms r
    join public.users u
      on u.restroom_id = r.id and u.role = 'contractor_monitor'
     and u.monitor_kind = 'primary' and u.is_active
   cross join (values ('am'::public.shift), ('pm'::public.shift)) as s(shift)
   where r.is_active
  on conflict (restroom_id, round_date, shift) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- إغلاق الجولات الفائتة: بعد آخر موعد (بدقة الدقيقة) أو أيام سابقة
-- ---------------------------------------------------------------------
create or replace function public.close_overdue_rounds(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Riyadh';
  v_today date := (p_now at time zone 'Asia/Riyadh')::date;
  v_minute integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_count integer;
begin
  with closed as (
    update public.rounds r
       set status = 'missed',
           compliance_level = null,
           compliance_score = 0,
           quality_score = null
     where r.status = 'pending'
       and (r.round_date < v_today
            or (r.round_date = v_today and v_minute > app.shift_deadline_minutes(r.shift)))
    returning r.id
  ), removed_drafts as (
    delete from public.round_drafts d using closed c where d.round_id = c.id
  )
  select count(*) into v_count from closed;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- إرسال جولة المراقب (ذرّي + منع التكرار)
-- ---------------------------------------------------------------------
create or replace function public.submit_round_tx(
  p_round_id uuid,
  p_executed_by uuid,
  p_on_behalf_of uuid,
  p_submitted_at timestamptz,
  p_compliance_level public.compliance_level,
  p_compliance_score numeric,
  p_quality_score numeric,
  p_weights_snapshot jsonb,
  p_note text,
  p_answers jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_round public.rounds%rowtype;
  v_missing integer;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    raise exception 'round_not_found' using errcode = 'P0002';
  end if;
  if v_round.status = 'submitted' then
    if v_round.idempotency_key is not null and v_round.idempotency_key = p_idempotency_key then
      return jsonb_build_object('duplicate', true, 'round_id', v_round.id);
    end if;
    raise exception 'round_already_submitted' using errcode = 'P0001';
  end if;
  if v_round.status = 'missed' then
    raise exception 'round_missed' using errcode = 'P0001';
  end if;

  select count(*) into v_missing
    from (values ('tools'::public.photo_slot), ('entry'), ('sinks'), ('toilets'), ('general')) as req(slot)
   where not exists (select 1 from public.round_photos p where p.round_id = p_round_id and p.slot = req.slot);
  if v_missing > 0 then
    raise exception 'round_photos_missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_answers) a
      left join public.checklist_items i on i.id = (a->>'item_id')::uuid
     where i.id is null or i."group" not in ('contractor', 'deep')
  ) then
    raise exception 'invalid_answer_item' using errcode = 'P0001';
  end if;

  insert into public.round_answers (round_id, item_id, answer)
  select p_round_id, (a->>'item_id')::uuid, (a->>'answer')::public.round_answer
    from jsonb_array_elements(p_answers) a;

  update public.rounds
     set status = 'submitted',
         executed_by_id = p_executed_by,
         on_behalf_of_id = p_on_behalf_of,
         submitted_at = p_submitted_at,
         started_at = coalesce(started_at, p_submitted_at),
         compliance_level = p_compliance_level,
         compliance_score = p_compliance_score,
         quality_score = p_quality_score,
         weights_snapshot = p_weights_snapshot,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         idempotency_key = p_idempotency_key
   where id = p_round_id;

  delete from public.round_drafts where round_id = p_round_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (p_executed_by, 'round.submit', 'rounds', p_round_id::text,
          jsonb_build_object('shift', v_round.shift, 'round_date', v_round.round_date,
                             'on_behalf_of', p_on_behalf_of, 'compliance_level', p_compliance_level,
                             'compliance_score', p_compliance_score, 'quality_score', p_quality_score));

  return jsonb_build_object('duplicate', false, 'round_id', p_round_id);
end $$;

-- ---------------------------------------------------------------------
-- إرسال تقييم مشرف الوزارة (ذرّي) + إنشاء الملاحظة عند الحاجة
-- ---------------------------------------------------------------------
create or replace function public.submit_evaluation_tx(
  p_evaluation_id uuid,
  p_supervisor_id uuid,
  p_submitted_at timestamptz,
  p_ratings jsonb,
  p_matches_round public.yes_no,
  p_needs_urgent public.yes_no,
  p_note text,
  p_score numeric,
  p_weights_snapshot jsonb,
  p_note_text text,
  p_note_severity public.note_severity,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_eval public.supervisor_evaluations%rowtype;
begin
  select * into v_eval from public.supervisor_evaluations where id = p_evaluation_id for update;
  if not found or v_eval.supervisor_id <> p_supervisor_id then
    raise exception 'evaluation_not_found' using errcode = 'P0002';
  end if;
  if v_eval.submitted_at is not null then
    if v_eval.idempotency_key is not null and v_eval.idempotency_key = p_idempotency_key then
      return jsonb_build_object('duplicate', true, 'evaluation_id', v_eval.id, 'submitted_at', v_eval.submitted_at);
    end if;
    raise exception 'evaluation_already_submitted' using errcode = 'P0001';
  end if;
  if p_matches_round is not null and not v_eval.viewed_contractor_rounds then
    raise exception 'contractor_rounds_not_viewed' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_ratings) r
      left join public.checklist_items i on i.id = (r->>'item_id')::uuid
     where i.id is null or i."group" <> 'supervisor'
  ) then
    raise exception 'invalid_rating_item' using errcode = 'P0001';
  end if;

  insert into public.supervisor_ratings (evaluation_id, item_id, rating)
  select p_evaluation_id, (r->>'item_id')::uuid, (r->>'rating')::smallint
    from jsonb_array_elements(p_ratings) r;

  update public.supervisor_evaluations
     set submitted_at = p_submitted_at,
         matches_round = p_matches_round,
         needs_urgent = p_needs_urgent,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         score = p_score,
         weights_snapshot = p_weights_snapshot,
         idempotency_key = p_idempotency_key
   where id = p_evaluation_id;

  if p_note_text is not null and length(btrim(p_note_text)) > 0 then
    insert into public.supervisor_notes (evaluation_id, restroom_id, supervisor_id, text, severity, created_at)
    values (p_evaluation_id, v_eval.restroom_id, p_supervisor_id, btrim(p_note_text), p_note_severity, p_submitted_at);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (p_supervisor_id, 'evaluation.submit', 'supervisor_evaluations', p_evaluation_id::text,
          jsonb_build_object('restroom_id', v_eval.restroom_id, 'score', p_score,
                             'matches_round', p_matches_round, 'needs_urgent', p_needs_urgent,
                             'note_severity', p_note_severity));

  return jsonb_build_object('duplicate', false, 'evaluation_id', p_evaluation_id, 'submitted_at', p_submitted_at);
end $$;

-- ---------------------------------------------------------------------
-- تقييم المستفيد (رمز QR صالح + منع الإساءة لكل جهاز/دورة مياه)
-- ---------------------------------------------------------------------
create or replace function public.submit_feedback_tx(
  p_token text,
  p_rating smallint,
  p_reason_keys text[],
  p_other_text text,
  p_client_hash text,
  p_now timestamptz,
  p_window_minutes integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_qr public.qr_codes%rowtype;
  v_last timestamptz;
  v_id uuid;
  v_keys text[] := coalesce(p_reason_keys, '{}');
  v_other text := nullif(btrim(coalesce(p_other_text, '')), '');
begin
  select q.* into v_qr
    from public.qr_codes q
    join public.restrooms r on r.id = q.restroom_id and r.is_active
   where q.token = p_token and q.is_active;
  if not found then
    raise exception 'invalid_token' using errcode = 'P0002';
  end if;

  if p_rating not in (1, 4, 5) then
    raise exception 'invalid_rating' using errcode = 'P0001';
  end if;
  if p_rating = 1 then
    if coalesce(array_length(v_keys, 1), 0) = 0 then
      raise exception 'reasons_required' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_keys) k where not exists (select 1 from public.feedback_reasons fr where fr.key = k)) then
      raise exception 'invalid_reason' using errcode = 'P0001';
    end if;
    if 'other' = any(v_keys) and v_other is null then
      raise exception 'other_text_required' using errcode = 'P0001';
    end if;
    if not ('other' = any(v_keys)) then
      v_other := null;
    end if;
  else
    if coalesce(array_length(v_keys, 1), 0) > 0 then
      raise exception 'reasons_not_allowed' using errcode = 'P0001';
    end if;
    v_other := null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_hash || ':' || v_qr.restroom_id::text, 0));
  select max(f.submitted_at) into v_last
    from public.beneficiary_feedback f
   where f.client_hash = p_client_hash
     and f.restroom_id = v_qr.restroom_id
     and f.submitted_at > p_now - make_interval(mins => p_window_minutes);
  if v_last is not null then
    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_last + make_interval(mins => p_window_minutes) - p_now)))::integer));
  end if;

  insert into public.beneficiary_feedback (restroom_id, qr_code_id, submitted_at, rating, other_text, client_hash)
  values (v_qr.restroom_id, v_qr.id, p_now, p_rating, v_other, p_client_hash)
  returning id into v_id;

  insert into public.beneficiary_feedback_reasons (feedback_id, reason_id)
  select v_id, fr.id from public.feedback_reasons fr where fr.key = any(v_keys);

  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (null, 'feedback.submit', 'beneficiary_feedback', v_id::text,
          jsonb_build_object('restroom_id', v_qr.restroom_id, 'rating', p_rating));

  return jsonb_build_object('ok', true, 'id', v_id, 'restroom_id', v_qr.restroom_id);
end $$;

-- ---------------------------------------------------------------------
-- لقطة كاملة للإعدادات والبنود والأوزان
-- ---------------------------------------------------------------------
create or replace function app.settings_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'partial_credit_pct', s.partial_credit_pct,
    'deep_clean_weekday', s.deep_clean_weekday,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'key', i.key, 'group', i."group", 'title', i.title,
               'weight', i.weight, 'is_active', i.is_active, 'sort_order', i.sort_order)
               order by i."group", i.sort_order, i.created_at), '[]'::jsonb)
        from public.checklist_items i)
  )
  from public.settings s where s.id
$$;

-- ---------------------------------------------------------------------
-- حفظ الإعدادات والبنود والأوزان (+ إعادة احتساب اختيارية لفترة)
-- ---------------------------------------------------------------------
create or replace function public.save_settings_tx(
  p_actor uuid,
  p_payload jsonb,
  p_recalc_from date default null,
  p_recalc_to date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_id uuid;
  v_group public.item_group;
  v_sum numeric;
  v_next_sort integer;
  v_partial numeric := (p_payload->>'partial_credit_pct')::numeric;
  v_weekday smallint := (p_payload->>'deep_clean_weekday')::smallint;
  v_snapshot jsonb;
  v_recalc jsonb;
  v_rounds integer := 0;
  v_evals integer := 0;
begin
  if not exists (select 1 from public.users u where u.id = p_actor and u.role = 'admin' and u.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_partial is null or v_partial < 0 or v_partial > 100 then
    raise exception 'invalid_partial_credit' using errcode = 'P0001';
  end if;
  if v_weekday is null or v_weekday < 0 or v_weekday > 6 then
    raise exception 'invalid_weekday' using errcode = 'P0001';
  end if;

  insert into public.settings (id) values (true) on conflict (id) do nothing;
  perform 1 from public.settings where id for update;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if coalesce((v_item->>'delete')::boolean, false) then
      if v_id is null then
        continue;
      end if;
      if exists (select 1 from public.round_answers a where a.item_id = v_id)
         or exists (select 1 from public.supervisor_ratings r where r.item_id = v_id) then
        raise exception 'item_in_use' using errcode = 'P0001', detail = v_id::text;
      end if;
      delete from public.checklist_items where id = v_id;
      continue;
    end if;

    if v_id is null then
      v_group := (v_item->>'group')::public.item_group;
      select coalesce(max(sort_order), 0) + 10 into v_next_sort
        from public.checklist_items where "group" = v_group;
      insert into public.checklist_items (key, "group", title, description, weight, sort_order, is_active, is_default)
      values ('custom_' || replace(gen_random_uuid()::text, '-', ''),
              v_group,
              btrim(v_item->>'title'),
              nullif(btrim(coalesce(v_item->>'description', '')), ''),
              case when v_group = 'deep' then null else (v_item->>'weight')::numeric end,
              coalesce((v_item->>'sort_order')::integer, v_next_sort),
              coalesce((v_item->>'is_active')::boolean, true),
              false);
    else
      update public.checklist_items
         set title = btrim(v_item->>'title'),
             description = nullif(btrim(coalesce(v_item->>'description', '')), ''),
             weight = case when "group" = 'deep' then null else (v_item->>'weight')::numeric end,
             is_active = coalesce((v_item->>'is_active')::boolean, is_active),
             sort_order = coalesce((v_item->>'sort_order')::integer, sort_order)
       where id = v_id;
      if not found then
        raise exception 'item_not_found' using errcode = 'P0002', detail = v_id::text;
      end if;
    end if;
  end loop;

  -- كل مجموعة محتسبة يجب أن يكون مجموع أوزان بنودها الفعالة = 100
  foreach v_group in array array['contractor', 'supervisor']::public.item_group[] loop
    select coalesce(sum(weight), 0) into v_sum
      from public.checklist_items where "group" = v_group and is_active;
    if abs(v_sum - 100) > 0.001 then
      raise exception 'weights_sum_invalid' using errcode = 'P0001',
        detail = v_group::text || ':' || v_sum::text;
    end if;
  end loop;

  update public.settings
     set partial_credit_pct = v_partial,
         deep_clean_weekday = v_weekday,
         updated_by = p_actor,
         updated_at = now()
   where id;

  if p_recalc_from is not null and p_recalc_to is not null then
    perform set_config('jodex.allow_recalc', 'on', true);

    with calc as (
      select a.round_id,
             sum(i.weight * case a.answer when 'done' then 1
                                          when 'partial' then v_partial / 100
                                          else 0 end) as pts,
             sum(i.weight) as wsum,
             jsonb_agg(jsonb_build_object('id', i.id, 'key', i.key, 'title', i.title,
                                          'weight', i.weight, 'group', i."group")
                       order by i.sort_order) as items
        from public.round_answers a
        join public.checklist_items i on i.id = a.item_id and i."group" = 'contractor' and i.is_active
        join public.rounds r on r.id = a.round_id
       where r.status = 'submitted' and r.round_date between p_recalc_from and p_recalc_to
       group by a.round_id
    ), upd as (
      update public.rounds r
         set quality_score = round(c.pts * 100 / c.wsum, 2),
             weights_snapshot = coalesce(r.weights_snapshot, '{}'::jsonb)
               || jsonb_build_object('items', c.items, 'partial_credit_pct', v_partial,
                                     'recalculated_at', now())
        from calc c
       where r.id = c.round_id and c.wsum > 0
      returning 1
    )
    select count(*) into v_rounds from upd;

    with calc as (
      select sr.evaluation_id,
             sum((sr.rating::numeric / 5) * i.weight) as pts,
             sum(i.weight) as wsum,
             jsonb_agg(jsonb_build_object('id', i.id, 'key', i.key, 'title', i.title,
                                          'weight', i.weight, 'group', i."group")
                       order by i.sort_order) as items
        from public.supervisor_ratings sr
        join public.checklist_items i on i.id = sr.item_id and i."group" = 'supervisor' and i.is_active
        join public.supervisor_evaluations e on e.id = sr.evaluation_id
       where e.submitted_at is not null
         and (e.submitted_at at time zone 'Asia/Riyadh')::date between p_recalc_from and p_recalc_to
       group by sr.evaluation_id
    ), upd as (
      update public.supervisor_evaluations e
         set score = round(c.pts * 100 / c.wsum, 2),
             weights_snapshot = coalesce(e.weights_snapshot, '{}'::jsonb)
               || jsonb_build_object('items', c.items, 'recalculated_at', now())
        from calc c
       where e.id = c.evaluation_id and c.wsum > 0
      returning 1
    )
    select count(*) into v_evals from upd;

    perform set_config('jodex.allow_recalc', 'off', true);
    v_recalc := jsonb_build_object('from', p_recalc_from, 'to', p_recalc_to,
                                   'rounds', v_rounds, 'evaluations', v_evals);
  end if;

  v_snapshot := app.settings_snapshot();
  insert into public.settings_history (snapshot, recalculation, changed_by)
  values (v_snapshot, v_recalc, p_actor);
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (p_actor, 'settings.save', 'settings', null,
          jsonb_build_object('snapshot', v_snapshot, 'recalculation', v_recalc));

  return jsonb_build_object('snapshot', v_snapshot, 'recalculation', v_recalc);
end $$;

-- ---------------------------------------------------------------------
-- تحديد معدل الطلبات (نافذة زمنية ثابتة)
-- ---------------------------------------------------------------------
create or replace function public.rate_limit_hit(
  p_key text, p_window_seconds integer, p_max integer, p_now timestamptz default now()
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.rate_limits%rowtype;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, p_now, 1)
  on conflict (key) do update
     set window_start = case when rl.window_start + make_interval(secs => p_window_seconds) <= p_now
                             then p_now else rl.window_start end,
         count = case when rl.window_start + make_interval(secs => p_window_seconds) <= p_now
                      then 1 else rl.count + 1 end
  returning rl.* into v_row;
  if v_row.count > p_max then
    return query select false,
      greatest(1, ceil(extract(epoch from (v_row.window_start + make_interval(secs => p_window_seconds) - p_now)))::integer);
  else
    return query select true, 0;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- قفل الدخول بعد محاولات فاشلة متتالية
-- ---------------------------------------------------------------------
create or replace function public.register_login_failure(
  p_username text, p_now timestamptz, p_max_attempts integer, p_lock_minutes integer, p_reset_minutes integer
) returns table (failed_count integer, locked_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.login_attempts%rowtype;
begin
  insert into public.login_attempts as la (username, failed_count, locked_until, last_failed_at)
  values (p_username, 1, null, p_now)
  on conflict (username) do update
     set failed_count = case
           when la.locked_until is not null and la.locked_until <= p_now then 1
           when la.last_failed_at is not null and la.last_failed_at < p_now - make_interval(mins => p_reset_minutes) then 1
           else la.failed_count + 1 end,
         locked_until = case when la.locked_until is not null and la.locked_until <= p_now then null
                             else la.locked_until end,
         last_failed_at = p_now
  returning la.* into v_row;

  if v_row.failed_count >= p_max_attempts and (v_row.locked_until is null or v_row.locked_until <= p_now) then
    update public.login_attempts as la
       set locked_until = p_now + make_interval(mins => p_lock_minutes)
     where la.username = p_username
    returning la.* into v_row;
  end if;
  return query select v_row.failed_count, v_row.locked_until;
end $$;

create or replace function public.clear_login_failures(p_username text) returns void
language sql security definer set search_path = '' as $$
  delete from public.login_attempts where username = p_username
$$;

-- ---------------------------------------------------------------------
-- تنظيف دوري للجداول التقنية
-- ---------------------------------------------------------------------
create or replace function public.maintenance_cleanup(p_now timestamptz default now()) returns void
language sql security definer set search_path = '' as $$
  delete from public.rate_limits where window_start < p_now - interval '1 day';
  delete from public.login_attempts
   where coalesce(locked_until, last_failed_at) < p_now - interval '1 day';
$$;

-- ---------------------------------------------------------------------
-- ملخص تقييمات المستفيدين لفترة (security invoker: يخضع لـ RLS = الأدمن فقط)
-- ---------------------------------------------------------------------
create or replace function public.feedback_summary(p_from timestamptz, p_to timestamptz)
returns table (restroom_id uuid, rating smallint, total bigint)
language sql stable security invoker set search_path = '' as $$
  select f.restroom_id, f.rating, count(*)::bigint
    from public.beneficiary_feedback f
   where f.submitted_at >= p_from and f.submitted_at < p_to
   group by f.restroom_id, f.rating
$$;

-- ---------------------------------------------------------------------
-- عرض موحّد لسجل الجولات (جولات المراقبين + تقييمات المشرفين المرسلة)
-- security_invoker: يخضع لسياسات RLS على الجداول الأصلية
-- ---------------------------------------------------------------------
create or replace view public.admin_log_entries with (security_invoker = true) as
select
  'round'::text as kind,
  r.id,
  r.restroom_id,
  rs.building_id,
  rs.floor_label,
  r.round_date as entry_date,
  coalesce(r.submitted_at,
           ((r.round_date + make_interval(mins => app.shift_start_minutes(r.shift))) at time zone 'Asia/Riyadh')) as sort_at,
  r.submitted_at as occurred_at,
  r.shift::text as round_type,
  r.status::text as status,
  r.compliance_level::text as compliance_level,
  r.compliance_score,
  r.quality_score as score,
  coalesce(r.executed_by_id, r.assigned_monitor_id) as employee_id,
  r.assigned_monitor_id as responsible_id,
  r.on_behalf_of_id,
  'contractor_monitor'::public.user_role as employee_role,
  null::public.yes_no as needs_urgent
from public.rounds r
join public.restrooms rs on rs.id = r.restroom_id
union all
select
  'supervisor'::text,
  e.id,
  e.restroom_id,
  rs.building_id,
  rs.floor_label,
  (e.submitted_at at time zone 'Asia/Riyadh')::date,
  e.submitted_at,
  e.submitted_at,
  'visit'::text,
  'submitted'::text,
  null::text,
  null::numeric,
  e.score,
  e.supervisor_id,
  e.supervisor_id,
  null::uuid,
  'supervisor'::public.user_role,
  e.needs_urgent
from public.supervisor_evaluations e
join public.restrooms rs on rs.id = e.restroom_id
where e.submitted_at is not null;

revoke all on public.admin_log_entries from anon;
grant select on public.admin_log_entries to authenticated, service_role;

-- ---------------------------------------------------------------------
-- الصلاحيات على الدوال: دوال العمل لـ service_role فقط
-- ---------------------------------------------------------------------
revoke all on function public.ensure_daily_rounds(date) from public, anon, authenticated;
revoke all on function public.close_overdue_rounds(timestamptz) from public, anon, authenticated;
revoke all on function public.submit_round_tx(uuid, uuid, uuid, timestamptz, public.compliance_level, numeric, numeric, jsonb, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.submit_evaluation_tx(uuid, uuid, timestamptz, jsonb, public.yes_no, public.yes_no, text, numeric, jsonb, text, public.note_severity, uuid) from public, anon, authenticated;
revoke all on function public.submit_feedback_tx(text, smallint, text[], text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.save_settings_tx(uuid, jsonb, date, date) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.register_login_failure(text, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_login_failures(text) from public, anon, authenticated;
revoke all on function public.maintenance_cleanup(timestamptz) from public, anon, authenticated;
revoke all on function public.feedback_summary(timestamptz, timestamptz) from public, anon;
revoke all on function app.settings_snapshot() from public, anon, authenticated;
revoke all on function app.shift_deadline_minutes(public.shift) from public, anon;
revoke all on function app.shift_start_minutes(public.shift) from public, anon;

grant execute on function public.ensure_daily_rounds(date) to service_role;
grant execute on function public.close_overdue_rounds(timestamptz) to service_role;
grant execute on function public.submit_round_tx(uuid, uuid, uuid, timestamptz, public.compliance_level, numeric, numeric, jsonb, text, jsonb, uuid) to service_role;
grant execute on function public.submit_evaluation_tx(uuid, uuid, timestamptz, jsonb, public.yes_no, public.yes_no, text, numeric, jsonb, text, public.note_severity, uuid) to service_role;
grant execute on function public.submit_feedback_tx(text, smallint, text[], text, text, timestamptz, integer) to service_role;
grant execute on function public.save_settings_tx(uuid, jsonb, date, date) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer, timestamptz) to service_role;
grant execute on function public.register_login_failure(text, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.clear_login_failures(text) to service_role;
grant execute on function public.maintenance_cleanup(timestamptz) to service_role;
grant execute on function public.feedback_summary(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function app.settings_snapshot() to service_role;
grant execute on function app.shift_deadline_minutes(public.shift) to authenticated, service_role;
grant execute on function app.shift_start_minutes(public.shift) to authenticated, service_role;

-- ===== 20261015000400_storage.sql =====
-- =====================================================================
-- جُودِكس — التخزين: حاوية خاصة لصور الجولات وتقييمات المشرفين
-- الحاوية غير عامة، ولا توجد سياسات على storage.objects للأدوار
-- anon/authenticated؛ الرفع والحذف وإنشاء الروابط الموقّعة قصيرة الأمد
-- تتم من الخادم (service_role) بعد التحقق من الصلاحية والنطاق.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ===== 20261015000500_cron.sql =====
-- =====================================================================
-- جُودِكس — المهام المجدولة (pg_cron داخل Supabase)
-- pg_cron يعمل بتوقيت UTC، والرياض = UTC+3 بلا توقيت صيفي:
--   00:01 الرياض = 21:01 UTC  → إنشاء جولات اليوم
--   11:01 الرياض = 08:01 UTC  → إغلاق الجولات الصباحية الفائتة
--   16:01 الرياض = 13:01 UTC  → إغلاق الجولات المسائية الفائتة
--   00:05 الرياض = 21:05 UTC  → إغلاق أي جولة متبقية من الأمس + تنظيف تقني
-- الدقيقة 11:00 و16:00 نفسها مسموحة للإرسال (آخر موعد شامل بدقة الدقيقة)،
-- لذلك يعمل الإغلاق في الدقيقة التالية. القراءة من الخادم تُغلق أيضًا الجولات
-- المتأخرة فورًا، فلا يعتمد النظام على دقة توقيت المهمة.
-- =====================================================================
create extension if not exists pg_cron;

select cron.schedule(
  'jodex-create-daily-rounds',
  '1 21 * * *',
  $$select public.ensure_daily_rounds((now() at time zone 'Asia/Riyadh')::date)$$
);

select cron.schedule(
  'jodex-close-morning-rounds',
  '1 8 * * *',
  $$select public.close_overdue_rounds(now())$$
);

select cron.schedule(
  'jodex-close-evening-rounds',
  '1 13 * * *',
  $$select public.close_overdue_rounds(now())$$
);

select cron.schedule(
  'jodex-nightly-maintenance',
  '5 21 * * *',
  $$select public.close_overdue_rounds(now()); select public.maintenance_cleanup(now());$$
);

-- ===== 20261015000600_items_in_use.sql =====
-- =====================================================================
-- جُودِكس — البنود المستخدمة في نتائج محفوظة (لا يجوز حذفها، يمكن تعطيلها فقط)
-- فحص EXISTS لكل بند عبر الفهارس (round_answers_item_idx و supervisor_ratings_item_idx)
-- بدل تحميل الإجابات نفسها.
-- =====================================================================
create or replace function public.checklist_items_in_use() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select i.id
    from public.checklist_items i
   where exists (select 1 from public.round_answers a where a.item_id = i.id)
      or exists (select 1 from public.supervisor_ratings r where r.item_id = i.id)
$$;

revoke all on function public.checklist_items_in_use() from public, anon, authenticated;
grant execute on function public.checklist_items_in_use() to service_role;

-- ===== 20261015000700_reconcile_pending_rounds.sql =====
-- =====================================================================
-- جُودِكس — مواءمة الجولات المفتوحة (pending) مع الإسناد الحالي
-- عند تعطيل دورة مياه أو مراقبها الأساسي: تُحذف جولاتها المفتوحة (لا تتحول إلى «فائتة» ظلمًا).
-- عند تغيير المراقب الأساسي لدورة مياه: تُسند جولاتها المفتوحة إلى المراقب الجديد.
-- الجولات المرسلة والفائتة لا تُمس إطلاقًا (سجل تاريخي مقفل).
-- تُستدعى في بداية إنشاء الجولات وإغلاق الفائتة (pg_cron والمزامنة عند الطلب).
-- =====================================================================
create or replace function app.reconcile_pending_rounds() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rounds r
   where r.status = 'pending'
     and not exists (
       select 1
         from public.restrooms rs
         join public.users u
           on u.restroom_id = rs.id and u.role = 'contractor_monitor'
          and u.monitor_kind = 'primary' and u.is_active
        where rs.id = r.restroom_id and rs.is_active
     );

  update public.rounds r
     set assigned_monitor_id = u.id
    from public.users u
   where r.status = 'pending'
     and u.restroom_id = r.restroom_id
     and u.role = 'contractor_monitor' and u.monitor_kind = 'primary' and u.is_active
     and r.assigned_monitor_id <> u.id;
end $$;

revoke all on function app.reconcile_pending_rounds() from public, anon, authenticated;
grant execute on function app.reconcile_pending_rounds() to service_role;

create or replace function public.ensure_daily_rounds(p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform app.reconcile_pending_rounds();
  insert into public.rounds (restroom_id, round_date, shift, assigned_monitor_id)
  select r.id, p_date, s.shift, u.id
    from public.restrooms r
    join public.users u
      on u.restroom_id = r.id and u.role = 'contractor_monitor'
     and u.monitor_kind = 'primary' and u.is_active
   cross join (values ('am'::public.shift), ('pm'::public.shift)) as s(shift)
   where r.is_active
  on conflict (restroom_id, round_date, shift) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.close_overdue_rounds(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Riyadh';
  v_today date := (p_now at time zone 'Asia/Riyadh')::date;
  v_minute integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_count integer;
begin
  perform app.reconcile_pending_rounds();
  with closed as (
    update public.rounds r
       set status = 'missed',
           compliance_level = null,
           compliance_score = 0,
           quality_score = null
     where r.status = 'pending'
       and (r.round_date < v_today
            or (r.round_date = v_today and v_minute > app.shift_deadline_minutes(r.shift)))
    returning r.id
  ), removed_drafts as (
    delete from public.round_drafts d using closed c where d.round_id = c.id
  )
  select count(*) into v_count from closed;
  return v_count;
end $$;

-- الصلاحيات كما في الترحيل الأصلي (create or replace يحافظ عليها، وتُعاد هنا للوضوح)
revoke all on function public.ensure_daily_rounds(date) from public, anon, authenticated;
revoke all on function public.close_overdue_rounds(timestamptz) from public, anon, authenticated;
grant execute on function public.ensure_daily_rounds(date) to service_role;
grant execute on function public.close_overdue_rounds(timestamptz) to service_role;

-- ===== 20261015000800_explicit_grants.sql =====
-- =====================================================================
-- جُودِكس — صلاحيات صريحة للأدوار
-- مشاريع Supabase الجديدة قد لا تمنح الأدوار صلاحيات تلقائية على الجداول الجديدة
-- (خيار «Automatically expose new tables» معطّل)، فيفشل الخادم بـ
-- «permission denied for table …». هنا تُمنح الصلاحيات صراحةً بنفس تصميم ملف الأمان:
--   service_role: كل شيء (الخادم فقط)، authenticated: قراءة تحكمها RLS،
--   anon: قائمة أسباب عدم الرضا فقط. آمن للتكرار.
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app to service_role;

grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke select on public.login_attempts, public.rate_limits from anon, authenticated;
revoke select on all tables in schema public from anon;
grant select on public.feedback_reasons to anon;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- ===== 20261015000900_monitor_many_restrooms.sql =====
-- =====================================================================
-- جُودِكس — المراقب الأساسي مسؤول عن عدة دورات مياه (مبنى كامل مثلًا)
-- كانت المسؤولية في users.restroom_id (دورة واحدة لكل مراقب)، وصارت في
-- restrooms.monitor_id: لكل دورة مياه مراقب أساسي واحد، وللمراقب عدة دورات.
-- النائب يعمل على كل دورات المراقب الأساسي الذي ينوب عنه.
-- يوسّع أيضًا طول ترميز دورة المياه إلى 40 حرفًا (مثل 100-HMR-HQ1003-00-0001).
-- =====================================================================

-- 1) عمود المسؤولية على دورة المياه ونقل الإسناد الحالي
alter table public.restrooms add column monitor_id uuid references public.users(id) on delete restrict;
create index restrooms_monitor_idx on public.restrooms (monitor_id);

update public.restrooms r
   set monitor_id = u.id
  from public.users u
 where u.restroom_id = r.id and u.role = 'contractor_monitor' and u.monitor_kind = 'primary' and u.is_active;

-- المسؤول يجب أن يكون مراقبًا أساسيًا
create or replace function app.validate_restroom_monitor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.monitor_id is not null and not exists (
    select 1 from public.users u
     where u.id = new.monitor_id and u.role = 'contractor_monitor' and u.monitor_kind = 'primary'
  ) then
    raise exception 'restroom_monitor_must_be_primary' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger restrooms_validate_monitor before insert or update of monitor_id on public.restrooms
  for each row execute function app.validate_restroom_monitor();

alter table public.restrooms drop constraint restrooms_code_check;
alter table public.restrooms add constraint restrooms_code_check check (code ~ '^[A-Z0-9-]{2,40}$');

-- 2) سياسات القراءة: دورات المراقب = كل دوراته (أو دورات الأساسي للنائب)
create or replace function app.monitor_restroom_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select r.id
    from public.users u
    left join public.users p
      on p.id = u.substitute_for_id and p.is_active and p.monitor_kind = 'primary'
    join public.restrooms r
      on r.monitor_id = case when u.monitor_kind = 'primary' then u.id else p.id end
   where u.id = (select auth.uid()) and u.is_active and u.role = 'contractor_monitor'
$$;
revoke all on function app.monitor_restroom_ids() from public;
grant execute on function app.monitor_restroom_ids() to authenticated, service_role;

alter policy restrooms_select on public.restrooms using (
  (select app.is_admin())
  or id in (select app.monitor_restroom_ids())
  or id in (select app.supervisor_restroom_ids())
);
alter policy buildings_select on public.buildings using (
  (select app.is_admin())
  or exists (
    select 1 from public.restrooms r
     where r.building_id = buildings.id
       and (r.id in (select app.monitor_restroom_ids())
            or r.id in (select app.supervisor_restroom_ids()))
  )
);
alter policy rounds_select on public.rounds using (
  (select app.is_admin())
  or restroom_id in (select app.monitor_restroom_ids())
  or restroom_id in (select app.supervisor_restroom_ids())
);
drop function app.monitor_restroom_id();

-- 3) حذف العمود القديم من المستخدمين
drop index public.users_one_active_primary_per_restroom;
alter table public.users drop constraint users_monitor_shape;
alter table public.users drop column restroom_id;
alter table public.users add constraint users_monitor_shape check (
  (role = 'contractor_monitor' and monitor_kind = 'primary' and substitute_for_id is null)
  or (role = 'contractor_monitor' and monitor_kind = 'substitute' and substitute_for_id is not null)
  or (role <> 'contractor_monitor' and monitor_kind is null and substitute_for_id is null)
);

-- مراقب أساسي له دورات مياه أو نواب لا يتحول إلى غير أساسي
create or replace function app.validate_user_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.monitor_kind = 'substitute' then
    if not exists (
      select 1 from public.users p
       where p.id = new.substitute_for_id
         and p.role = 'contractor_monitor' and p.monitor_kind = 'primary'
    ) then
      raise exception 'substitute_must_reference_primary' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.monitor_kind = 'primary' and new.monitor_kind is distinct from 'primary' then
    if exists (select 1 from public.users s where s.substitute_for_id = new.id) then
      raise exception 'primary_has_substitutes' using errcode = '23514';
    end if;
    if exists (select 1 from public.restrooms r where r.monitor_id = new.id) then
      raise exception 'primary_has_restrooms' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- 4) إنشاء الجولات ومواءمتها حسب المسؤول الحالي لكل دورة مياه
create or replace function app.reconcile_pending_rounds() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rounds r
   where r.status = 'pending'
     and not exists (
       select 1
         from public.restrooms rs
         join public.users u
           on u.id = rs.monitor_id and u.role = 'contractor_monitor'
          and u.monitor_kind = 'primary' and u.is_active
        where rs.id = r.restroom_id and rs.is_active
     );

  update public.rounds r
     set assigned_monitor_id = rs.monitor_id
    from public.restrooms rs
   where r.status = 'pending'
     and rs.id = r.restroom_id
     and rs.monitor_id is not null
     and r.assigned_monitor_id <> rs.monitor_id;
end $$;

create or replace function public.ensure_daily_rounds(p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform app.reconcile_pending_rounds();
  insert into public.rounds (restroom_id, round_date, shift, assigned_monitor_id)
  select r.id, p_date, s.shift, u.id
    from public.restrooms r
    join public.users u
      on u.id = r.monitor_id and u.role = 'contractor_monitor'
     and u.monitor_kind = 'primary' and u.is_active
   cross join (values ('am'::public.shift), ('pm'::public.shift)) as s(shift)
   where r.is_active
  on conflict (restroom_id, round_date, shift) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function app.reconcile_pending_rounds() from public, anon, authenticated;
grant execute on function app.reconcile_pending_rounds() to service_role;
revoke all on function public.ensure_daily_rounds(date) from public, anon, authenticated;
grant execute on function public.ensure_daily_rounds(date) to service_role;

-- ===== 20261015001000_item_category.sql =====
-- =====================================================================
-- جُودِكس — مجال البند (مثل «النظافة» و«الصيانة» في نموذج التقييم الميداني)
-- اختياري لكل بند؛ يُستخدم لتجميع البنود في الواجهات وحساب مجموع كل مجال،
-- ويُحفظ ضمن لقطة الأوزان لكل جولة/تقييم. الوزن يبقى على البند نفسه (مجموع المجموعة 100%).
-- =====================================================================
alter table public.checklist_items add column if not exists category text
  check (category is null or length(btrim(category)) between 1 and 60);

create or replace function app.settings_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'partial_credit_pct', s.partial_credit_pct,
    'deep_clean_weekday', s.deep_clean_weekday,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'key', i.key, 'group', i."group", 'title', i.title, 'category', i.category,
               'weight', i.weight, 'is_active', i.is_active, 'sort_order', i.sort_order)
               order by i."group", i.sort_order, i.created_at), '[]'::jsonb)
        from public.checklist_items i)
  )
  from public.settings s where s.id
$$;

create or replace function public.save_settings_tx(
  p_actor uuid,
  p_payload jsonb,
  p_recalc_from date default null,
  p_recalc_to date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_id uuid;
  v_group public.item_group;
  v_sum numeric;
  v_next_sort integer;
  v_partial numeric := (p_payload->>'partial_credit_pct')::numeric;
  v_weekday smallint := (p_payload->>'deep_clean_weekday')::smallint;
  v_snapshot jsonb;
  v_recalc jsonb;
  v_rounds integer := 0;
  v_evals integer := 0;
begin
  if not exists (select 1 from public.users u where u.id = p_actor and u.role = 'admin' and u.is_active) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_partial is null or v_partial < 0 or v_partial > 100 then
    raise exception 'invalid_partial_credit' using errcode = 'P0001';
  end if;
  if v_weekday is null or v_weekday < 0 or v_weekday > 6 then
    raise exception 'invalid_weekday' using errcode = 'P0001';
  end if;

  insert into public.settings (id) values (true) on conflict (id) do nothing;
  perform 1 from public.settings where id for update;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if coalesce((v_item->>'delete')::boolean, false) then
      if v_id is null then
        continue;
      end if;
      if exists (select 1 from public.round_answers a where a.item_id = v_id)
         or exists (select 1 from public.supervisor_ratings r where r.item_id = v_id) then
        raise exception 'item_in_use' using errcode = 'P0001', detail = v_id::text;
      end if;
      delete from public.checklist_items where id = v_id;
      continue;
    end if;

    if v_id is null then
      v_group := (v_item->>'group')::public.item_group;
      select coalesce(max(sort_order), 0) + 10 into v_next_sort
        from public.checklist_items where "group" = v_group;
      insert into public.checklist_items (key, "group", title, description, category, weight, sort_order, is_active, is_default)
      values ('custom_' || replace(gen_random_uuid()::text, '-', ''),
              v_group,
              btrim(v_item->>'title'),
              nullif(btrim(coalesce(v_item->>'description', '')), ''),
              nullif(btrim(coalesce(v_item->>'category', '')), ''),
              case when v_group = 'deep' then null else (v_item->>'weight')::numeric end,
              coalesce((v_item->>'sort_order')::integer, v_next_sort),
              coalesce((v_item->>'is_active')::boolean, true),
              false);
    else
      update public.checklist_items
         set title = btrim(v_item->>'title'),
             description = nullif(btrim(coalesce(v_item->>'description', '')), ''),
             category = nullif(btrim(coalesce(v_item->>'category', '')), ''),
             weight = case when "group" = 'deep' then null else (v_item->>'weight')::numeric end,
             is_active = coalesce((v_item->>'is_active')::boolean, is_active),
             sort_order = coalesce((v_item->>'sort_order')::integer, sort_order)
       where id = v_id;
      if not found then
        raise exception 'item_not_found' using errcode = 'P0002', detail = v_id::text;
      end if;
    end if;
  end loop;

  -- كل مجموعة محتسبة يجب أن يكون مجموع أوزان بنودها الفعالة = 100
  foreach v_group in array array['contractor', 'supervisor']::public.item_group[] loop
    select coalesce(sum(weight), 0) into v_sum
      from public.checklist_items where "group" = v_group and is_active;
    if abs(v_sum - 100) > 0.001 then
      raise exception 'weights_sum_invalid' using errcode = 'P0001',
        detail = v_group::text || ':' || v_sum::text;
    end if;
  end loop;

  update public.settings
     set partial_credit_pct = v_partial,
         deep_clean_weekday = v_weekday,
         updated_by = p_actor,
         updated_at = now()
   where id;

  if p_recalc_from is not null and p_recalc_to is not null then
    perform set_config('jodex.allow_recalc', 'on', true);

    with calc as (
      select a.round_id,
             sum(i.weight * case a.answer when 'done' then 1
                                          when 'partial' then v_partial / 100
                                          else 0 end) as pts,
             sum(i.weight) as wsum,
             jsonb_agg(jsonb_build_object('id', i.id, 'key', i.key, 'title', i.title,
                                          'weight', i.weight, 'group', i."group", 'category', i.category)
                       order by i.sort_order) as items
        from public.round_answers a
        join public.checklist_items i on i.id = a.item_id and i."group" = 'contractor' and i.is_active
        join public.rounds r on r.id = a.round_id
       where r.status = 'submitted' and r.round_date between p_recalc_from and p_recalc_to
       group by a.round_id
    ), upd as (
      update public.rounds r
         set quality_score = round(c.pts * 100 / c.wsum, 2),
             weights_snapshot = coalesce(r.weights_snapshot, '{}'::jsonb)
               || jsonb_build_object('items', c.items, 'partial_credit_pct', v_partial,
                                     'recalculated_at', now())
        from calc c
       where r.id = c.round_id and c.wsum > 0
      returning 1
    )
    select count(*) into v_rounds from upd;

    with calc as (
      select sr.evaluation_id,
             sum((sr.rating::numeric / 5) * i.weight) as pts,
             sum(i.weight) as wsum,
             jsonb_agg(jsonb_build_object('id', i.id, 'key', i.key, 'title', i.title,
                                          'weight', i.weight, 'group', i."group", 'category', i.category)
                       order by i.sort_order) as items
        from public.supervisor_ratings sr
        join public.checklist_items i on i.id = sr.item_id and i."group" = 'supervisor' and i.is_active
        join public.supervisor_evaluations e on e.id = sr.evaluation_id
       where e.submitted_at is not null
         and (e.submitted_at at time zone 'Asia/Riyadh')::date between p_recalc_from and p_recalc_to
       group by sr.evaluation_id
    ), upd as (
      update public.supervisor_evaluations e
         set score = round(c.pts * 100 / c.wsum, 2),
             weights_snapshot = coalesce(e.weights_snapshot, '{}'::jsonb)
               || jsonb_build_object('items', c.items, 'recalculated_at', now())
        from calc c
       where e.id = c.evaluation_id and c.wsum > 0
      returning 1
    )
    select count(*) into v_evals from upd;

    perform set_config('jodex.allow_recalc', 'off', true);
    v_recalc := jsonb_build_object('from', p_recalc_from, 'to', p_recalc_to,
                                   'rounds', v_rounds, 'evaluations', v_evals);
  end if;

  v_snapshot := app.settings_snapshot();
  insert into public.settings_history (snapshot, recalculation, changed_by)
  values (v_snapshot, v_recalc, p_actor);
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (p_actor, 'settings.save', 'settings', null,
          jsonb_build_object('snapshot', v_snapshot, 'recalculation', v_recalc));

  return jsonb_build_object('snapshot', v_snapshot, 'recalculation', v_recalc);
end $$;


revoke all on function public.save_settings_tx(uuid, jsonb, date, date) from public, anon, authenticated;
grant execute on function public.save_settings_tx(uuid, jsonb, date, date) to service_role;
revoke all on function app.settings_snapshot() from public, anon, authenticated;
grant execute on function app.settings_snapshot() to service_role;

commit;
