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
