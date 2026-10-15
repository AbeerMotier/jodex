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
