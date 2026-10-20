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
