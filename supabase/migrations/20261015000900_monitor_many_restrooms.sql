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
