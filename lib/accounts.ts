/** أدوات الحسابات المشتركة بين الخادم وسكربتات الإدارة (بلا اعتماد على Next) */
import { randomBytes, randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '-_.!@#';

/** كلمة مرور عشوائية قوية (16 حرفًا افتراضيًا) — لا كلمات مرور ثابتة إطلاقًا */
export function generatePassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGITS[randomInt(DIGITS.length)],
    SYMBOLS[randomInt(SYMBOLS.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** بريد داخلي عشوائي غير قابل للتخمين يربط الحساب في Supabase Auth (الدخول باسم المستخدم فقط) */
export function internalEmail(domain: string): string {
  return `u-${randomBytes(10).toString('hex')}@${domain}`;
}

/** رمز رابط QR العام: 24 بايت = 192 بت عشوائية (≥ 128 بت)، بترميز آمن للروابط */
export function newQrToken(): string {
  return randomBytes(24).toString('base64url');
}
