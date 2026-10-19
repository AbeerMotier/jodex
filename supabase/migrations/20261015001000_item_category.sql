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
