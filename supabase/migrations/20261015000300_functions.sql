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
