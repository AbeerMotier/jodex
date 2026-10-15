-- =====================================================================
-- جُودِكس — التخزين: حاوية خاصة لصور الجولات وتقييمات المشرفين
-- الحاوية غير عامة، ولا توجد سياسات على storage.objects للأدوار
-- anon/authenticated؛ الرفع والحذف وإنشاء الروابط الموقّعة قصيرة الأمد
-- تتم من الخادم (service_role) بعد التحقق من الصلاحية والنطاق.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;
