import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { CSRF_COOKIE, json } from '@/lib/server/http';

/** يعيد رمز CSRF (ويضبط الكوكي إن لم يوجد) — للعملاء الذين لم يفتحوا صفحة بعد */
export function GET(req: NextRequest) {
  const existing = req.cookies.get(CSRF_COOKIE)?.value;
  const token = existing ?? randomBytes(32).toString('base64url');
  const res = json({ token });
  if (!existing) {
    res.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production' && process.env.JODEX_ALLOW_INSECURE_HTTP !== 'true',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
  }
  return res;
}
