/**
 * Proxy (middleware) — يعمل قبل عرض الصفحات:
 * 1) HTTPS فقط في الإنتاج  2) CSP بـ nonce لكل طلب  3) تحديث جلسة Supabase
 * 4) توجيه حسب الدور: صفحة دور آخر ← 403، غير مسجل ← صفحة الدخول  5) كوكي CSRF
 * نقاط /api تتحقق بنفسها من الجلسة والدور والنطاق في كل طلب.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type Role = 'admin' | 'supervisor' | 'contractor_monitor';
const ROLE_HOME: Record<Role, string> = { admin: '/admin', supervisor: '/supervisor', contractor_monitor: '/monitor' };
const PROTECTED: { prefix: string; role: Role }[] = [
  { prefix: '/admin', role: 'admin' },
  { prefix: '/supervisor', role: 'supervisor' },
  { prefix: '/monitor', role: 'contractor_monitor' },
];
const CSRF_COOKIE = 'jodex_csrf';

const MISSING_ENV_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>جُودِكس — الإعدادات ناقصة</title></head>
<body style="margin:0;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#F2F6F3;color:#2F4F44;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<main style="max-width:620px;background:#fff;border:1px solid #E3EAE6;border-radius:20px;padding:28px;line-height:1.9">
<h1 style="margin:0 0 8px;font-size:22px">إعدادات الاتصال بقاعدة البيانات ناقصة</h1>
<p style="margin:0 0 14px">لم يجد النظام عنوان Supabase أو مفتاحه (<code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و <code dir="ltr">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>).</p>
<p style="margin:0 0 6px"><b>على جهازك:</b> أوقف التشغيل في الطرفية بـ <code dir="ltr">Ctrl+C</code> ثم نفّذ:</p>
<pre dir="ltr" style="background:#EAF3EC;border-radius:12px;padding:12px 14px;margin:0 0 6px;text-align:left">npm run setup:cloud
npm run dev</pre>
<p style="margin:0 0 14px;font-size:14px;color:#687D74">(أو <code dir="ltr">npm run setup:env</code> بدل الأول إن كنت تستخدم Supabase المحلي عبر Docker). تأكد أن الملف <code dir="ltr">.env.local</code> موجود بجانب <code dir="ltr">package.json</code>.</p>
<p style="margin:0"><b>على السيرفر (Render):</b> أضف القيم في Environment ثم أعد النشر.</p>
</main></body></html>`;

/** قراءة متغيرات البيئة وقت التشغيل (لا تُضمَّن قيم وقت البناء في الحزمة) */
function runtimeEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}
const DEVICE_COOKIE = 'jodex_device';

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString('base64url');
}

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === 'development';
  let supabaseOrigin = '';
  try {
    supabaseOrigin = new URL(runtimeEnv('NEXT_PUBLIC_SUPABASE_URL') ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    supabaseOrigin = '';
  }
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${supabaseOrigin}`.trim(),
    `font-src 'self' data:`,
    `connect-src 'self' ${supabaseOrigin}`.trim(),
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(process.env.NODE_ENV === 'production' && process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // HTTPS فقط في الإنتاج (خلف موازن تحميل يضبط x-forwarded-proto)
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true' &&
    request.headers.get('x-forwarded-proto') === 'http'
  ) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }

  // إعدادات Supabase ناقصة (ملف .env.local غير موجود أو فارغ): صفحة توضح الحل بدل خطأ غامض
  // وقت التشغيل أولًا (Docker/Render)، ثم القيمة المضمّنة وقت البناء (منصات مثل Netlify/Vercel)
  const supabaseUrl = runtimeEnv('NEXT_PUBLIC_SUPABASE_URL') ?? (process.env.NEXT_PUBLIC_SUPABASE_URL || undefined);
  const supabaseKey = runtimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined);
  if (!supabaseUrl || !supabaseKey) {
    console.error('[jodex] NEXT_PUBLIC_SUPABASE_URL أو NEXT_PUBLIC_SUPABASE_ANON_KEY غير مضبوط — نفّذ npm run setup:cloud أو npm run setup:env');
    return new NextResponse(MISSING_ENV_PAGE, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }

  const nonce = randomToken(16);
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // يجب استدعاء getUser مباشرة بعد إنشاء العميل لتحديث الجلسة
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = (user?.app_metadata?.jodex_role ?? null) as Role | null;

  const finalize = (res: NextResponse) => {
    // نقل كوكيز الجلسة المحدّثة إلى أي استجابة (إعادة توجيه/إعادة كتابة)
    if (res !== response) for (const c of response.cookies.getAll()) res.cookies.set(c);
    res.headers.set('Content-Security-Policy', csp);
    // معرّف جهاز عشوائي لصفحة تقييم المستفيد (لمنع الإساءة دون أي بيانات شخصية)
    if (pathname.startsWith('/r/') && !request.cookies.get(DEVICE_COOKIE)) {
      res.cookies.set(DEVICE_COOKIE, randomToken(18), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production' && process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    if (!request.cookies.get(CSRF_COOKIE)) {
      res.cookies.set(CSRF_COOKIE, randomToken(), {
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production' && process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true',
        path: '/',
        maxAge: 60 * 60 * 12,
      });
    }
    return res;
  };

  if (pathname === '/') {
    const target = request.nextUrl.clone();
    target.pathname = user && role ? ROLE_HOME[role] : '/login';
    target.search = '';
    return finalize(NextResponse.redirect(target));
  }

  if (pathname === '/login' && user && role) {
    const target = request.nextUrl.clone();
    target.pathname = ROLE_HOME[role];
    target.search = '';
    return finalize(NextResponse.redirect(target));
  }

  const area = PROTECTED.find((p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`));
  if (area) {
    if (!user || !role) {
      const target = request.nextUrl.clone();
      target.pathname = '/login';
      target.search = `?next=${encodeURIComponent(pathname + search)}`;
      return finalize(NextResponse.redirect(target));
    }
    if (role !== area.role) {
      const target = request.nextUrl.clone();
      target.pathname = '/forbidden';
      target.search = `?home=${encodeURIComponent(ROLE_HOME[role])}`;
      return finalize(NextResponse.rewrite(target, { status: 403, request: { headers: requestHeaders } }));
    }
  }

  return finalize(response);
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|fonts/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
