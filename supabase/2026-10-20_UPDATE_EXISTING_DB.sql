-- =====================================================================
-- جُودِكس — تحديث قاعدة البيانات الحالية لتعديلات الجهة (20 أكتوبر 2026)
-- الصقه كاملًا في Supabase ← SQL Editor ← New query ← Run (مرة واحدة).
-- آمن لإعادة التشغيل. ثلاثة أجزاء، كل جزء في معاملة مستقلة:
--   1) دور «المقاول»  2) الجداول والدوال والصلاحيات  3) البنود والحسابات
-- لا يحذف أي جولة أو تقييم أو صورة؛ البنود ذات السجل تُعطَّل فقط.
-- =====================================================================

-- ===== الجزء 1 =====
begin;
alter type public.user_role add value if not exists 'contractor';
commit;

-- ===== الجزء 2 =====
begin;
-- =====================================================================
-- جُودِكس — تعديلات بطلب الجهة (أكتوبر 2026)
-- 1) صلاحية أدمن محدودة (بدون المستخدمين والمباني ودورات المياه والإعدادات والأوزان)
-- 2) دور «المقاول»: دورات مياه مسندة للعرض فقط
-- 3) نوافذ الجولات: صباحية 07:30–10:00، مسائية 12:00–14:30 (توقيت الرياض)
-- 4) صور الجولة الإلزامية: بدون «المراحيض»، و«العمالة» إلزامية
-- 5) تقييم المستفيد: مرة واحدة لكل دورة مياه كل 24 ساعة
-- 6) سجل الجولات يعرض إجابة «هل جولة المراقب مطابقة للواقع؟»
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) نطاق صلاحية الأدمن
-- ---------------------------------------------------------------------
alter table public.users add column if not exists admin_scope text not null default 'full'
  check (admin_scope in ('full', 'limited'));
comment on column public.users.admin_scope is
  'للأدمن فقط: full = كل الصفحات، limited = بدون المستخدمين والصلاحيات والمباني ودورات المياه والإعدادات والأوزان';

create or replace function app.is_full_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = p_user and u.is_active and u.role = 'admin' and u.admin_scope = 'full'
  )
$$;
revoke all on function app.is_full_admin(uuid) from public, anon, authenticated;
grant execute on function app.is_full_admin(uuid) to service_role;

-- حفظ الإعدادات والأوزان للأدمن الكامل فقط (تحقق دفاعي فوق تحقق الخادم)
do $$
declare
  v_def text;
  v_old text := $q$if not exists (select 1 from public.users u where u.id = p_actor and u.role = 'admin' and u.is_active) then$q$;
begin
  select pg_get_functiondef('public.save_settings_tx(uuid, jsonb, date, date)'::regprocedure) into v_def;
  if position(v_old in v_def) = 0 then
    if position('app.is_full_admin(p_actor)' in v_def) > 0 then
      return;
    end if;
    -- صيغة غير متوقعة: يبقى تحقق الخادم (fullAdminRoute) هو الحارس
    raise notice 'save_settings_tx: admin check not found — skipped';
    return;
  end if;
  execute replace(v_def, v_old, 'if not app.is_full_admin(p_actor) then');
end $$;

-- ---------------------------------------------------------------------
-- 2) المقاول ودورات المياه المسندة إليه
-- ---------------------------------------------------------------------
create table if not exists public.contractor_assignments (
  contractor_id uuid not null references public.users(id) on delete cascade,
  restroom_id uuid not null references public.restrooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint contractor_assignments_pkey primary key (contractor_id, restroom_id)
);
create index if not exists contractor_assignments_restroom_idx on public.contractor_assignments (restroom_id);

create or replace function app.validate_contractor_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.users u where u.id = new.contractor_id and u.role = 'contractor') then
    raise exception 'assignment_requires_contractor' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists contractor_assignments_validate on public.contractor_assignments;
create trigger contractor_assignments_validate before insert or update on public.contractor_assignments
  for each row execute function app.validate_contractor_assignment();

create or replace function app.contractor_restroom_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.restroom_id
    from public.contractor_assignments a
    join public.users u on u.id = a.contractor_id
   where a.contractor_id = (select auth.uid()) and u.is_active and u.role = 'contractor'
$$;
revoke all on function app.contractor_restroom_ids() from public;
grant execute on function app.contractor_restroom_ids() to authenticated, service_role;

alter table public.contractor_assignments enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.contractor_assignments from anon, authenticated;
revoke select on public.contractor_assignments from anon;
grant select on public.contractor_assignments to authenticated;
grant all on public.contractor_assignments to service_role;
drop policy if exists contractor_assignments_select on public.contractor_assignments;
create policy contractor_assignments_select on public.contractor_assignments
  for select to authenticated using (
    (select app.is_admin()) or contractor_id = (select auth.uid())
  );

-- القراءة للمقاول: دوراته ومبانيها وحالة جولاتها (بدون أي كتابة)
alter policy restrooms_select on public.restrooms using (
  (select app.is_admin())
  or id in (select app.monitor_restroom_ids())
  or id in (select app.supervisor_restroom_ids())
  or id in (select app.contractor_restroom_ids())
);
alter policy buildings_select on public.buildings using (
  (select app.is_admin())
  or exists (
    select 1 from public.restrooms r
     where r.building_id = buildings.id
       and (r.id in (select app.monitor_restroom_ids())
            or r.id in (select app.supervisor_restroom_ids())
            or r.id in (select app.contractor_restroom_ids()))
  )
);
alter policy rounds_select on public.rounds using (
  (select app.is_admin())
  or restroom_id in (select app.monitor_restroom_ids())
  or restroom_id in (select app.supervisor_restroom_ids())
  or restroom_id in (select app.contractor_restroom_ids())
);

-- ---------------------------------------------------------------------
-- 3) نوافذ الجولات (بالدقائق من منتصف ليل الرياض)
-- ---------------------------------------------------------------------
-- آخر موعد: صباحية 10:00، مسائية 14:30
create or replace function app.shift_deadline_minutes(p_shift public.shift) returns integer
language sql immutable set search_path = '' as $$
  select case p_shift when 'am' then 600 else 870 end
$$;

-- البداية: صباحية 07:30، مسائية 12:00
create or replace function app.shift_start_minutes(p_shift public.shift) returns integer
language sql immutable set search_path = '' as $$
  select case p_shift when 'am' then 450 else 720 end
$$;

-- ---------------------------------------------------------------------
-- 3+4) إرسال الجولة: داخل نافذتها فقط، والصور الإلزامية الجديدة
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
  v_local timestamp := p_submitted_at at time zone 'Asia/Riyadh';
  v_minute integer := extract(hour from (p_submitted_at at time zone 'Asia/Riyadh'))::integer * 60
                      + extract(minute from (p_submitted_at at time zone 'Asia/Riyadh'))::integer;
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

  -- الإرسال داخل نافذة الجولة فقط (نفس اليوم، من البداية حتى آخر موعد شاملًا)
  if v_local::date <> v_round.round_date or v_minute < app.shift_start_minutes(v_round.shift) then
    raise exception 'round_not_open' using errcode = 'P0001';
  end if;
  if v_minute > app.shift_deadline_minutes(v_round.shift) then
    raise exception 'round_missed' using errcode = 'P0001';
  end if;

  select count(*) into v_missing
    from (values ('tools'::public.photo_slot), ('entry'), ('sinks'), ('general'), ('labor')) as req(slot)
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

revoke all on function public.submit_round_tx(uuid, uuid, uuid, timestamptz, public.compliance_level, numeric, numeric, jsonb, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.submit_round_tx(uuid, uuid, uuid, timestamptz, public.compliance_level, numeric, numeric, jsonb, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5) تقييم المستفيد: نافذة المنع 24 ساعة على الأقل لكل هوية (حساب أو جهاز) ودورة مياه
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
  v_window integer := greatest(coalesce(p_window_minutes, 0), 1440);
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
     and f.submitted_at > p_now - make_interval(mins => v_window);
  if v_last is not null then
    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_last + make_interval(mins => v_window) - p_now)))::integer));
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

revoke all on function public.submit_feedback_tx(text, smallint, text[], text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.submit_feedback_tx(text, smallint, text[], text, text, timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------
-- 6) سجل الجولات: إجابة المشرف عن مطابقة جولة المراقب (عمود جديد في آخر العرض)
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
  null::public.yes_no as needs_urgent,
  null::public.yes_no as matches_round
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
  e.needs_urgent,
  e.matches_round
from public.supervisor_evaluations e
join public.restrooms rs on rs.id = e.restroom_id
where e.submitted_at is not null;

revoke all on public.admin_log_entries from anon;
grant select on public.admin_log_entries to authenticated, service_role;
commit;

-- ===== الجزء 3 =====
-- =====================================================================
-- جُودِكس — بيانات تعديلات الجهة (أكتوبر 2026) — آمن لإعادة التشغيل
-- 1) إلغاء بنود «التنظيف العميق»
-- 2) «هيئة العامل» بدل «الالتزام بخطة العمل» (بنفس الوزن 13 وموضعه)
-- 3) بنود تقييم المشرف الميداني = بنود جولة المقاول بعد التعديل
-- 4) الصلاحيات: إيهاب سمارن وسلطان الجبالي أدمن محدود، وعبدالحميد النحاس «مقاول»
-- البند المستخدم في نتائج محفوظة يُعطَّل فقط (حفاظًا على السجل)، وغير المستخدم يُحذف.
-- =====================================================================
begin;

-- 1) التنظيف العميق
update public.checklist_items set is_active = false where "group" = 'deep' and is_active;
delete from public.checklist_items i
 where i."group" = 'deep'
   and not exists (select 1 from public.round_answers a where a.item_id = i.id)
   and not exists (select 1 from public.supervisor_ratings r where r.item_id = i.id);

-- 2) هيئة العامل بدل الالتزام بخطة العمل
insert into public.checklist_items (key, "group", title, weight, default_weight, is_default, sort_order, is_active)
select 'contractor_worker_appearance', 'contractor', 'هيئة العامل', w.weight, w.weight, true, w.sort_order, true
  from (select coalesce(max(weight) filter (where title = 'الالتزام بخطة العمل'), 13) as weight,
               coalesce(max(sort_order) filter (where title = 'الالتزام بخطة العمل'), 70) as sort_order
          from public.checklist_items where "group" = 'contractor') w
on conflict (key) do nothing;
update public.checklist_items set is_active = false
 where "group" = 'contractor' and title = 'الالتزام بخطة العمل' and is_active;
delete from public.checklist_items i
 where i."group" = 'contractor' and i.title = 'الالتزام بخطة العمل'
   and not exists (select 1 from public.round_answers a where a.item_id = i.id);

-- 3) بنود المشرف = بنود جولة المقاول الفعالة (العنوان والوصف والوزن والترتيب)
insert into public.checklist_items (key, "group", title, description, category, weight, default_weight, is_default, sort_order, is_active)
select 'supervisor_' || substr(regexp_replace(c.key, '^contractor_', ''), 1, 53), 'supervisor', c.title, c.description, null, c.weight, c.weight, true, c.sort_order, true
  from public.checklist_items c
 where c."group" = 'contractor' and c.is_active
on conflict (key) do update
   set title = excluded.title, description = excluded.description, weight = excluded.weight,
       sort_order = excluded.sort_order, is_active = true;
update public.checklist_items s set is_active = false
 where s."group" = 'supervisor' and s.is_active
   and s.key not in (select 'supervisor_' || substr(regexp_replace(c.key, '^contractor_', ''), 1, 53) from public.checklist_items c where c."group" = 'contractor' and c.is_active);
delete from public.checklist_items i
 where i."group" = 'supervisor' and not i.is_active
   and not exists (select 1 from public.supervisor_ratings r where r.item_id = i.id);

-- 4) الصلاحيات والحسابات (بأسماء المستخدمين في قاعدة بيانات الجهة؛ لا أثر لها إن لم توجد)
update public.users set role = 'admin', admin_scope = 'limited'
 where username in ('unit.manager', 's.aljabali');
-- المشرف الذي صار أدمن لا تبقى له مواقع تقييم مسندة
delete from public.supervisor_assignments a using public.users u
 where u.id = a.supervisor_id and u.username = 's.aljabali' and u.role <> 'supervisor';
update public.users set role = 'contractor', admin_scope = 'full' where username = 'a.alnahhas';
-- المقاول يرى كل دورات المياه الفعالة (قابل للتعديل من «المستخدمون والصلاحيات» ← دورات المياه)
insert into public.contractor_assignments (contractor_id, restroom_id)
select u.id, r.id from public.users u cross join public.restrooms r
 where u.username = 'a.alnahhas' and u.role = 'contractor' and r.is_active
on conflict do nothing;
-- الدور في جلسة الدخول (يُقرأ في proxy) يتبع الدور الجديد
update auth.users au set raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('jodex_role', u.role::text)
  from public.users u
 where u.id = au.id and u.username in ('unit.manager', 's.aljabali', 'a.alnahhas');

insert into public.audit_log (actor_id, action, entity, data)
values (null, 'client_requirements.2026_10_20', 'checklist_items',
        jsonb_build_object('note', 'deep items removed, worker appearance item, supervisor items mirror contractor items, roles'));

commit;

-- تحقق
select "group", title, weight, is_active from public.checklist_items order by "group", is_active desc, sort_order;
select username, full_name, role, admin_scope from public.users where username in ('unit.manager', 's.aljabali', 'a.alnahhas');
