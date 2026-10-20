import { NextResponse, type NextRequest } from 'next/server';
import { ROLE_HOME, ROLE_LABEL, type Role } from '@/lib/domain/catalog';
import { LOGIN_INVALID_MESSAGE, loginSchema, normalizeUsername } from '@/lib/domain/validation';
import { audit } from '@/lib/server/audit';
import { firstName } from '@/lib/server/auth';
import { ApiError, clientIp, errorResponse, json, parseJson, verifyCsrf } from '@/lib/server/http';
import { serverNow } from '@/lib/server/clock';
import { hitRateLimit, minutesText } from '@/lib/server/rate-limit';
import { createServiceClient, createUserClient } from '@/lib/server/supabase';

/** قفل مؤقت بعد 5 محاولات فاشلة متتالية */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 15;
/** حد عام لكل عنوان IP */
const IP_WINDOW_SECONDS = 15 * 60;
const IP_MAX_ATTEMPTS = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lockedMessage(until: Date, now: Date) {
  const seconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
  return `تم إيقاف الدخول مؤقتًا بسبب محاولات فاشلة متكررة. حاول بعد ${minutesText(seconds)}.`;
}

/** يقبل مسار العودة فقط إن كان مسارًا داخليًا يخص دور المستخدم */
function safeNext(next: string | undefined, role: Role): string {
  const home = ROLE_HOME[role];
  if (!next || !next.startsWith('/') || next.startsWith('//')) return home;
  // الدخول من رمز QR لدورة مياه (تتحقق الصفحة نفسها من الدور والنطاق)
  if (/^\/go\/(?:[A-Za-z0-9_-]{22,128}|[A-Z0-9-]{2,40})$/.test(next)) return next;
  return next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`) ? next : home;
}

export async function POST(req: NextRequest) {
  try {
    verifyCsrf(req);
    const now = await serverNow();
    const body = await parseJson(req, loginSchema);
    const username = normalizeUsername(body.username);
    const ip = clientIp(req);
    const svc = createServiceClient();

    const ipLimit = await hitRateLimit(`login:ip:${ip}`, IP_WINDOW_SECONDS, IP_MAX_ATTEMPTS, now);
    if (!ipLimit.allowed) {
      throw new ApiError(429, 'rate_limited', `محاولات كثيرة من هذا الجهاز. حاول بعد ${minutesText(ipLimit.retryAfterSeconds)}.`);
    }

    const { data: attempt } = await svc
      .from('login_attempts')
      .select('locked_until')
      .eq('username', username)
      .maybeSingle();
    if (attempt?.locked_until && new Date(attempt.locked_until) > now) {
      throw new ApiError(423, 'locked', lockedMessage(new Date(attempt.locked_until), now));
    }

    const { data: profile, error: profileErr } = await svc
      .from('users')
      .select('id, full_name, role, is_active')
      .eq('username', username)
      .maybeSingle();
    if (profileErr) {
      // مفتاح الخادم خاطئ أو الجداول غير منشأة — ليست مشكلة كلمة مرور
      console.error('[jodex] login: users lookup failed', profileErr.message);
      throw new ApiError(
        503,
        'server_config',
        'تعذّر على الخادم قراءة قاعدة البيانات. تحقق من SUPABASE_SERVICE_ROLE_KEY ومن تشغيل ملفات الجداول، ثم أعد النشر. ' +
          `(${(profileErr.code ? `${profileErr.code}: ` : '') + profileErr.message.slice(0, 120)})`,
      );
    }

    const supabase = await createUserClient();
    let success = false;
    if (profile?.is_active) {
      const { data: authUser, error: authErr } = await svc.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (authErr || !email) {
        console.error('[jodex] login: auth user lookup failed', authErr?.message ?? 'no email');
        throw new ApiError(
          503,
          'auth_account_broken',
          'الحساب موجود لكن بياناته في Supabase Auth ناقصة. شغّل supabase/repair-login.sql ثم أعد المحاولة.',
        );
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
      success = !error && Boolean(data.session);
      if (error && error.code !== 'invalid_credentials') {
        // خطأ من خدمة الدخول نفسها (حساب تالف، مزوّد Email معطّل، مفتاح عام خاطئ…)
        console.error('[jodex] login: Supabase Auth error', error.code, error.message);
        throw new ApiError(
          503,
          'auth_service_error',
          `رفضت خدمة الدخول في Supabase الطلب (${error.code ?? error.status ?? 'unknown'}). ` +
            'تأكد أن مزوّد Email مفعّل وأن NEXT_PUBLIC_SUPABASE_ANON_KEY صحيح، أو شغّل supabase/repair-login.sql.',
        );
      }
    } else {
      // توحيد زمن الاستجابة تقريبًا حتى لا يُستدل على وجود الحساب
      await sleep(120 + Math.floor(Math.random() * 120));
    }

    if (!success || !profile) {
      const { data: fail } = await svc.rpc('register_login_failure', {
        p_username: username,
        p_now: now.toISOString(),
        p_max_attempts: MAX_FAILED_ATTEMPTS,
        p_lock_minutes: LOCK_MINUTES,
        p_reset_minutes: RESET_MINUTES,
      });
      await audit(profile?.id ?? null, 'auth.login_failed', 'users', profile?.id ?? null, { username, ip });
      const row = Array.isArray(fail) ? fail[0] : fail;
      if (row?.locked_until && new Date(row.locked_until) > now) {
        throw new ApiError(423, 'locked', lockedMessage(new Date(row.locked_until), now));
      }
      throw new ApiError(401, 'invalid_credentials', LOGIN_INVALID_MESSAGE);
    }

    await svc.rpc('clear_login_failures', { p_username: username });
    await audit(profile.id, 'auth.login', 'users', profile.id, { ip });
    const role = profile.role as Role;
    return json({
      role,
      fullName: profile.full_name,
      redirectTo: safeNext(body.next, role),
      welcome: `مرحبًا ${firstName(profile.full_name)}، دخلت بصلاحية ${ROLE_LABEL[role]}`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET() {
  return NextResponse.json({ error: { code: 'method_not_allowed', message: 'طريقة غير مسموحة' } }, { status: 405 });
}
