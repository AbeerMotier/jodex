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
