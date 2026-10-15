/**
 * إعداد ملف .env.local تلقائيًا للتشغيل المحلي (بعد `npx supabase start`):
 * - عنوان Supabase والمفاتيح من `supabase status`
 * - APP_SECRET و CRON_SECRET عشوائيان
 * لا يستبدل أي قيمة موجودة مسبقًا في .env.local (آمن للتكرار)، ولا يطبع أي سر.
 *
 *   npm run setup:env
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const examplePath = path.join(root, '.env.example');

function supabaseStatus(): Record<string, string> {
  const bin = process.env.SUPABASE_BIN || 'supabase';
  const res = spawnSync(bin, ['status', '-o', 'json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = res.stdout ?? '';
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (res.status !== 0 || start < 0 || end < start) {
    console.error('✗ تعذّر قراءة حالة Supabase المحلي. تأكد أن Docker Desktop يعمل، ثم نفّذ: npx supabase start');
    const err = (res.stderr ?? '').trim();
    if (err) console.error(err.split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
  return JSON.parse(out.slice(start, end + 1)) as Record<string, string>;
}

const status = supabaseStatus();
const creating = !existsSync(envPath);
const source = readFileSync(creating ? examplePath : envPath, 'utf8');

const wanted: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY || status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY || status.SECRET_KEY,
  SUPABASE_DB_URL: status.DB_URL,
  APP_SECRET: randomBytes(48).toString('base64url'),
  CRON_SECRET: randomBytes(32).toString('hex'),
};
// العرض التجريبي المحلي: قائمة أسماء الحسابات في صفحة الدخول (بدون كلمات مرور)
if (creating) wanted.DEMO_MODE = 'true';

const missing = Object.entries(wanted).filter(([, v]) => !v);
if (missing.length) {
  console.error(`✗ لم يُعِد supabase status القيم: ${missing.map(([k]) => k).join('، ')}`);
  process.exit(1);
}

const filled: string[] = [];
const seen = new Set<string>();
const lines = source.split(/\r?\n/).map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) return line;
  const [, key, current] = m;
  seen.add(key);
  const value = wanted[key];
  if (value === undefined) return line;
  const keepExisting = current.trim() !== '' && !(creating && key === 'DEMO_MODE');
  if (keepExisting) return line;
  filled.push(key);
  return `${key}=${value}`;
});
for (const [key, value] of Object.entries(wanted)) {
  if (!seen.has(key)) {
    lines.push(`${key}=${value}`);
    filled.push(key);
  }
}

writeFileSync(envPath, lines.join('\n').replace(/\n*$/, '\n'));
console.log(`✓ ${creating ? 'أُنشئ' : 'حُدّث'} الملف .env.local`);
console.log(filled.length ? `  القيم المضبوطة: ${filled.join('، ')}` : '  كل القيم موجودة مسبقًا — لم يتغير شيء.');
console.log('الخطوة التالية: npm run db:seed');
