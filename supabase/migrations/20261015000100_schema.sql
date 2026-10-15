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
