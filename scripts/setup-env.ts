/**
 * إعداد ملف .env.local تلقائيًا:
 *
 *   npm run setup:env     ← Supabase المحلي (بعد `npx supabase start`): العنوان والمفاتيح من `supabase status`
 *   npm run setup:cloud   ← مشروع Supabase سحابي: يسألك عن Project URL والمفتاحين ويكتبها
 *
 * في الحالتين يولّد APP_SECRET و CRON_SECRET عشوائيين إن لم يكونا موجودين، ولا يطبع أي سر.
 * الوضع المحلي لا يستبدل أي قيمة موجودة (آمن للتكرار)، والوضع السحابي يستبدل قيم Supabase فقط.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const examplePath = path.join(root, '.env.example');
const cloud = process.argv.includes('--cloud');

function fail(message: string, detail?: string): never {
  console.error(`✗ ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function localStatus(): Record<string, string> {
  const bin = process.env.SUPABASE_BIN || 'supabase';
  const res = spawnSync(bin, ['status', '-o', 'json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = res.stdout ?? '';
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (res.status !== 0 || start < 0 || end < start) {
    fail(
      'تعذّر قراءة حالة Supabase المحلي. تأكد أن Docker Desktop يعمل، ثم نفّذ: npx supabase start',
      (res.stderr ?? '').trim().split('\n').slice(-5).join('\n') || undefined,
    );
  }
  return JSON.parse(out.slice(start, end + 1)) as Record<string, string>;
}

/** قارئ أسطر بطابور: لا تضيع الإجابات إن لُصقت عدة أسطر دفعة واحدة */
function lineReader() {
  const tty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty });
  const queue: string[] = [];
  let waiter: ((line: string) => void) | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) waiter('');
  });
  return {
    async ask(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const line = queue.length ? queue.shift()! : closed ? '' : await new Promise<string>((resolve) => (waiter = resolve));
      if (!tty) process.stdout.write('\n');
      return line.trim();
    },
    close: () => rl.close(),
  };
}

async function askCloud(): Promise<Record<string, string>> {
  console.log('من لوحة Supabase: Project Settings ← API Keys (والرابط من Project Settings ← Data API أو زر Connect)\n');
  const rl = lineReader();
  try {
    const url = (await rl.ask('1) Project URL (مثل https://abcd1234.supabase.co): ')).replace(/\/+$/, '');
    const anon = await rl.ask('2) Publishable key (أو anon key): ');
    const secret = await rl.ask('3) Secret key (أو service_role key): ');
    if (!/^https:\/\/[^\s/]+$/.test(url)) fail('الرابط يجب أن يبدأ بـ https:// وبدون مسار، مثل https://abcd1234.supabase.co');
    if (anon.length < 20 || /\s/.test(anon)) fail('المفتاح العام (Publishable/anon) غير صالح.');
    if (secret.length < 20 || /\s/.test(secret)) fail('المفتاح السري (Secret/service_role) غير صالح.');
    if (anon === secret) fail('المفتاحان متطابقان: الأول هو العام (Publishable/anon) والثاني هو السري (Secret/service_role).');
    if (secret.startsWith('sb_publishable_')) fail('المفتاح الثالث يجب أن يكون السري (sb_secret_… أو service_role)، لا العام.');
    return { url, anon, secret };
  } finally {
    rl.close();
  }
}

async function main() {
  const creating = !existsSync(envPath);
  const source = readFileSync(creating ? examplePath : envPath, 'utf8');

  /** القيم المطلوبة؛ force = تُكتب حتى لو كانت موجودة */
  const wanted: Record<string, { value: string; force: boolean }> = {};
  const set = (key: string, value: string | undefined, force: boolean) => {
    if (value === undefined || value === '') fail(`لم تتوفر قيمة ${key}`);
    wanted[key] = { value, force };
  };

  if (cloud) {
    const { url, anon, secret } = await askCloud();
    set('NEXT_PUBLIC_SUPABASE_URL', url, true);
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', anon, true);
    set('SUPABASE_SERVICE_ROLE_KEY', secret, true);
  } else {
    const status = localStatus();
    set('NEXT_PUBLIC_SUPABASE_URL', status.API_URL, false);
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', status.ANON_KEY || status.PUBLISHABLE_KEY, false);
    set('SUPABASE_SERVICE_ROLE_KEY', status.SERVICE_ROLE_KEY || status.SECRET_KEY, false);
    set('SUPABASE_DB_URL', status.DB_URL, false);
    // العرض التجريبي المحلي: قائمة أسماء الحسابات في صفحة الدخول (بدون كلمات مرور)
    if (creating) set('DEMO_MODE', 'true', true);
  }
  set('APP_SECRET', randomBytes(48).toString('base64url'), false);
  set('CRON_SECRET', randomBytes(32).toString('hex'), false);

  const filled: string[] = [];
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/).map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) return line;
    const [, key, current] = m;
    seen.add(key);
    // رابط قاعدة البيانات المحلية لا معنى له مع المشروع السحابي
    if (cloud && key === 'SUPABASE_DB_URL') return `${key}=`;
    const want = wanted[key];
    if (!want || (!want.force && current.trim() !== '')) return line;
    filled.push(key);
    return `${key}=${want.value}`;
  });
  for (const [key, want] of Object.entries(wanted)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${want.value}`);
      filled.push(key);
    }
  }

  writeFileSync(envPath, lines.join('\n').replace(/\n*$/, '\n'));
  console.log(`\n✓ ${creating ? 'أُنشئ' : 'حُدّث'} الملف .env.local${cloud ? ' (مربوط بمشروع Supabase السحابي)' : ''}`);
  console.log(filled.length ? `  القيم المضبوطة: ${filled.join('، ')}` : '  كل القيم موجودة مسبقًا — لم يتغير شيء.');
  console.log('الخطوة التالية: npm run db:seed');
}

main().catch((e) => fail('غير متوقع', e instanceof Error ? e.message : String(e)));
