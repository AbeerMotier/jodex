# دليل النشر التجريبي — Supabase السحابي + Render

ثلاث مراحل: **(1)** المشروع على جهازك ← **(2)** قاعدة بيانات Supabase سحابية مربوطة به ← **(3)** رفعه على سيرفر Render.
كل الأوامر تُكتب في طرفية VS Code (`` Ctrl+` ``) داخل مجلد المشروع. الخطتان المجانيتان كافيتان للتجربة.

> لا تحتاج Docker في هذا الدليل: قاعدة البيانات في السحابة، و Render يبني صورة التطبيق بنفسه.

---

## المرحلة 1: المشروع على جهازك

إن لم تنزّله بعد: في VS Code اضغط `Ctrl+Shift+P` ← **Git: Clone** ← الصق `https://github.com/AbeerMotier/jodex.git` ← اختر مجلدًا ← **Open**.
وإن كان عندك مسبقًا فاسحب آخر نسخة: `git pull`

```
npm ci
npx playwright install chromium
```

---

## المرحلة 2: قاعدة البيانات السحابية (Supabase)

**1) أنشئ المشروع**
1. ادخل https://supabase.com واضغط **Start your project** (أسهل طريقة: Sign in with GitHub).
2. **New project**:
   - **Name:** `jodex`
   - **Database Password:** اضغط Generate ثم **انسخها واحفظها** (تحتاجها في الخطوة 3).
   - **Region:** `Central EU (Frankfurt)` (نفس منطقة سيرفر Render فيكون الاتصال سريعًا).
3. اضغط **Create new project** وانتظر دقيقتين حتى يجهز.

**2) سجّل دخول أداة Supabase من جهازك**
```
npx supabase login
```
يفتح المتصفح لتأكيد الدخول (أو يطلب لصق Access Token من https://supabase.com/dashboard/account/tokens).

**3) اربط المشروع وأنشئ الجداول**

رقم المشروع (Project ref) هو الجزء الأخير من رابط لوحة المشروع: `https://supabase.com/dashboard/project/`**`abcd1234`**
(أو من Project Settings ← General ← Project ID).
```
npx supabase link --project-ref abcd1234
```
يطلب **Database Password** من الخطوة 1. ثم:
```
npx supabase db push
```
اكتب `Y` للتأكيد. سترى `Applying migration …` سبع مرات ثم `Finished supabase db push.`
هذا ينشئ الجداول والصلاحيات (RLS) والدوال وحاوية الصور الخاصة والمهام المجدولة (إنشاء الجولات وإغلاق الفائتة تلقائيًا).

**4) امنع التسجيل الذاتي** (الحسابات تُنشأ من النظام فقط)

لوحة Supabase ← **Authentication** ← **Sign In / Providers** ← أوقف **Allow new users to sign up** ← **Save**.

**5) اربط المشروع على جهازك بالقاعدة السحابية**
```
npm run setup:cloud
```
سيسألك عن ثلاث قيم — انسخها من لوحة Supabase:

| السؤال | من أين |
|---|---|
| Project URL | زر **Connect** أعلى اللوحة، أو Project Settings ← Data API (مثل `https://abcd1234.supabase.co`) |
| Publishable key | Project Settings ← **API Keys** (يبدأ بـ `sb_publishable_`؛ أو anon key) |
| Secret key | نفس الصفحة ← Secret keys (يبدأ بـ `sb_secret_`؛ أو service_role key) — **سري، لا تشاركه** |

النتيجة: `✓ … مربوط بمشروع Supabase السحابي`. (الأمر يكتب ملف `.env.local` ويولّد الأسرار؛ الملف لا يُرفع إلى GitHub.)

**6) أنشئ الحسابات والبيانات الأساسية في القاعدة السحابية**
```
npm run db:seed
```
يظهر جدول بأسماء المستخدمين وكلمات المرور **مرة واحدة فقط** — انسخه واحفظه في مكان آمن.

**7) جرّب على جهازك**
```
npm run dev
```
افتح http://localhost:3000/login وادخل بحساب `admin`. أي بيانات تُدخلها الآن تُحفظ في القاعدة السحابية.
أوقفه بـ `Ctrl+C` قبل المرحلة التالية.

---

## المرحلة 3: الرفع على سيرفر Render

1. ادخل https://render.com ← **Get Started** ← **GitHub** (اسمح له بالوصول إلى مستودع `jodex`).
2. من اللوحة: **New** ← **Blueprint** ← اختر المستودع **AbeerMotier/jodex** ← **Connect**.
   Render يقرأ ملف `render.yaml` من المستودع (خدمة ويب مجانية في فرانكفورت تُبنى من Dockerfile).
3. يطلب ثلاث قيم — الصق نفس قيم الخطوة 5 (تجدها في ملف `.env.local` على جهازك):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. اضغط **Apply** / **Deploy Blueprint**. البناء الأول يأخذ 5–10 دقائق (يمكنك متابعة **Logs**)، وينتهي بـ `Your service is live`.
5. افتح رابط الخدمة الظاهر أعلى الصفحة، مثل `https://jodex-xxxx.onrender.com/login`، وادخل بنفس الحسابات.
6. (اختياري) في Supabase ← Authentication ← **URL Configuration** ← **Site URL** = رابط Render.

روابط رموز QR تستخدم رابط Render تلقائيًا. جرّب: ادخل كأدمن ← «رموز QR» ← امسح الرمز بجوالك.

---

## ملاحظات الخطط المجانية

- **Render المجاني ينام** بعد 15 دقيقة بلا استخدام؛ أول فتح بعدها يأخذ نحو دقيقة.
- **ذاكرة 512MB**: تقارير PDF تعمل بوضع الذاكرة المنخفضة (`JODEX_PDF_LOW_MEMORY`)، فقد تأخذ بضع ثوانٍ.
- **المهام المجدولة** (إنشاء الجولات 00:01 وإغلاق الفائتة 11:01 و16:01) تعمل داخل Supabase حتى لو كان Render نائمًا.
- **Supabase المجاني يتوقف مؤقتًا** إن لم يُستخدم 7 أيام؛ أعد تشغيله من لوحته بزر Restore.
- **التحديثات**: أي تعديل يُرفع إلى فرع `main` في GitHub ← Render يعيد النشر تلقائيًا.
  وإن تضمّن التحديث ملف ترحيل جديد في `supabase/migrations` نفّذ من جهازك: `npx supabase db push`
- **إدارة الحسابات** على القاعدة السحابية من جهازك: `npm run admin -- help` (مثلًا إعادة كلمة مرور:
  `npm run admin -- users:reset-password --username admin`).

## الرجوع للقاعدة المحلية (Docker) على جهازك

```
del .env.local          (على Mac: rm .env.local)
npx supabase start
npm run setup:env
npm run db:seed
```
الاختبارات الآلية (`npm run test:*`) تعمل على القاعدة المحلية فقط، وترفض القاعدة السحابية عمدًا لحمايتها.

---

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `db push` يرفض كلمة المرور | أعد ضبطها من Project Settings ← Database ← Reset database password، ثم أعد `npx supabase link --project-ref …` |
| `npm run db:seed` يقول إن البريد الداخلي مرفوض | أضف في `.env.local` السطر `AUTH_EMAIL_DOMAIN=users.نطاقك` (نطاق حقيقي تملكه) وأعد الأمر، وأضف نفس المتغير في Render ← Environment |
| صفحة Render تعرض «حدث خطأ غير متوقع في الخادم» | تأكد من القيم الثلاث في Render ← **Environment** ثم **Manual Deploy** ← Deploy latest commit |
| البناء على Render فشل | افتح **Logs** وانسخ آخر 30 سطرًا وأرسلها |
| رسالة «محاولات كثيرة» عند دخول عدة موظفين معًا | الدخول يتم من السيرفر فيظهر لـ Supabase كجهاز واحد؛ ارفع الحد من Supabase ← Authentication ← **Rate Limits** (Sign-ins/Sign-ups) |
| `running scripts is disabled on this system` في الطرفية | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` ثم `Y`، وافتح طرفية جديدة |
