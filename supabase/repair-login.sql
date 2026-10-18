-- =====================================================================
-- جُودِكس — إصلاح دخول حساب واحد وضبط كلمة مروره
-- عدّل السطرين في «الإعدادات» فقط، ثم الصق الملف كاملًا في Supabase SQL Editor واضغط Run.
-- يصلح كل ما يمنع الدخول: كلمة المرور، البريد الداخلي، التأكيد، الحظر، القفل،
-- الحقول الفارغة التي ترفضها Supabase Auth، وسجل الهوية (identity).
-- في النهاية يعرض فحصًا للحساب: كل الأعمدة يجب أن تكون true.
-- =====================================================================

-- ======================= الإعدادات (عدّل هنا فقط) =======================
create temp table if not exists jodex_repair (username text, password text);
truncate jodex_repair;
insert into jodex_repair values ('admin', 'اكتب_كلمة_المرور_هنا');
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_username text := (select lower(btrim(username)) from jodex_repair);
  v_password text := (select password from jodex_repair);
  v_user public.users%rowtype;
begin
  if v_password is null or length(v_password) < 8 or v_password = 'اكتب_كلمة_المرور_هنا' then
    raise exception 'اكتب كلمة مرور جديدة (8 أحرف أو أكثر) في قسم الإعدادات أعلى الملف';
  end if;
  select * into v_user from public.users where username = v_username;
  if not found then
    raise exception 'الحساب "%" غير موجود في public.users — شغّل three-accounts.sql أولًا', v_username;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
         email = coalesce(nullif(email, ''), 'u-' || replace(id::text, '-', '') || '@jodex.local'),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         aud = 'authenticated',
         role = 'authenticated',
         instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
         banned_until = null,
         deleted_at = null,
         confirmation_token = coalesce(confirmation_token, ''),
         recovery_token = coalesce(recovery_token, ''),
         email_change_token_new = coalesce(email_change_token_new, ''),
         email_change = coalesce(email_change, ''),
         email_change_token_current = coalesce(email_change_token_current, ''),
         phone_change = coalesce(phone_change, ''),
         phone_change_token = coalesce(phone_change_token, ''),
         reauthentication_token = coalesce(reauthentication_token, ''),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                                 'jodex_role', v_user.role::text, 'jodex_username', v_user.username),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb),
         updated_at = now()
   where id = v_user.id;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), a.id, a.id::text, 'email',
         jsonb_build_object('sub', a.id::text, 'email', a.email, 'email_verified', true), now(), now(), now()
    from auth.users a
   where a.id = v_user.id
     and not exists (select 1 from auth.identities i where i.user_id = a.id and i.provider = 'email');

  update public.users set is_active = true where id = v_user.id;
  delete from public.login_attempts where username = v_user.username;
end $$;

-- الفحص: كل الأعمدة يجب أن تكون true
select u.username                                   as "اسم المستخدم",
       u.role                                       as "الدور",
       u.is_active                                  as active,
       a.email is not null                          as email_ok,
       a.email_confirmed_at is not null             as confirmed,
       a.banned_until is null                       as not_banned,
       a.encrypted_password = extensions.crypt(r.password, a.encrypted_password) as password_ok,
       exists (select 1 from auth.identities i where i.user_id = a.id) as identity_ok,
       (a.raw_app_meta_data->>'jodex_role') = u.role::text as role_ok
  from jodex_repair r
  join public.users u on u.username = lower(btrim(r.username))
  join auth.users a on a.id = u.id;
