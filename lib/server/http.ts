import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { fieldErrors } from '@/lib/domain/validation';
import type { Role } from '@/lib/domain/catalog';
import { getSessionUser, type SessionUser } from './auth';
import { serverNow } from './clock';
import { env } from './env';

export const CSRF_COOKIE = 'jodex_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const MSG = {
  unauthenticated: 'انتهت الجلسة. سجّل الدخول مجددًا.',
  forbidden: 'لا تملك صلاحية الوصول لهذه الصفحة',
  csrf: 'انتهت صلاحية النموذج. حدّث الصفحة وأعد المحاولة.',
  server: 'حدث خطأ غير متوقع في الخادم. حاول مرة أخرى.',
  badJson: 'بيانات الطلب غير صالحة.',
} as const;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) hosts.add(host);
  for (const url of [env.appBaseUrl, env.publicAppUrl]) {
    try {
      hosts.add(new URL(url).host);
    } catch {
      /* تجاهل */
    }
  }
  return hosts;
}

/** حماية CSRF: تطابق مصدر الطلب + رمز double-submit (كوكي + ترويسة) */
export function verifyCsrf(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && origin !== 'null') {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ApiError(403, 'csrf', MSG.csrf);
    }
    if (!allowedHosts(req).has(originHost)) throw new ApiError(403, 'csrf', MSG.csrf);
  }
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  const header = req.headers.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) throw new ApiError(403, 'csrf', MSG.csrf);
}

/**
 * عنوان العميل لأغراض تحديد المعدل. يُؤخذ من X-Forwarded-For بعدد الوكلاء الموثوقين
 * (TRUSTED_PROXY_HOPS، الافتراضي 1): أول قيمة يمكن للعميل تزويرها، لذا تُقرأ القيمة
 * التي أضافها آخر وكيل موثوق. اضبطه على 0 إن لم يكن أمام التطبيق وكيل عكسي.
 */
export function clientIp(req: NextRequest): string {
  const hops = env.trustedProxyHops;
  const xff = req.headers.get('x-forwarded-for');
  if (xff && hops > 0) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip.slice(0, 64);
  }
  return req.headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown';
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'bad_json', MSG.badJson);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = fieldErrors(result.error);
    throw new ApiError(422, 'validation', result.error.issues[0]?.message ?? MSG.badJson, fields);
  }
  return result.data;
}

export function json(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, fields: error.fields, ...error.extra } },
      { status: error.status },
    );
  }
  console.error('[jodex] unhandled error', error);
  return json({ error: { code: 'server_error', message: MSG.server } }, { status: 500 });
}

export interface RouteContextArgs<P> {
  req: NextRequest;
  user: SessionUser;
  params: P;
  now: Date;
}

export interface PublicRouteContextArgs<P> {
  req: NextRequest;
  params: P;
  now: Date;
}

type NextRouteContext<P> = { params: Promise<P> };

/** غلاف موحّد لنقاط النهاية المحمية: الجلسة + الدور + CSRF + معالجة الأخطاء */
export function authed<P = Record<string, string>>(
  roles: Role[],
  handler: (ctx: RouteContextArgs<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, context: NextRouteContext<P>) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) verifyCsrf(req);
      const user = await getSessionUser();
      if (!user) throw new ApiError(401, 'unauthenticated', MSG.unauthenticated);
      if (!roles.includes(user.role)) throw new ApiError(403, 'forbidden', MSG.forbidden);
      const params = (await context.params) ?? ({} as P);
      const now = await serverNow();
      const result = await handler({ req, user, params, now });
      return result instanceof Response ? result : json(result);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** نقاط نهاية عامة (بدون حساب) مع CSRF للطلبات المعدِّلة */
export function publicRoute<P = Record<string, string>>(
  handler: (ctx: PublicRouteContextArgs<P>) => Promise<unknown>,
  options: { csrf?: boolean } = {},
) {
  return async (req: NextRequest, context: NextRouteContext<P>) => {
    try {
      if (options.csrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) verifyCsrf(req);
      const params = (await context.params) ?? ({} as P);
      const now = await serverNow();
      const result = await handler({ req, params, now });
      return result instanceof Response ? result : json(result);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** خطأ PostgREST/Postgres → رسالة الاستثناء المرفوع من دوال قاعدة البيانات */
export function dbErrorCode(error: { message?: string; code?: string } | null | undefined): string | null {
  if (!error) return null;
  return error.message ?? error.code ?? 'db_error';
}
