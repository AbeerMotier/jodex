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
