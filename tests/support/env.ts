/**
 * تحميل متغيرات البيئة للاختبارات وحماية من تشغيلها على قاعدة غير محلية.
 * اختبارات التكامل تكتب بيانات حقيقية (حسابات وجولات بتواريخ مستقبلية بعيدة وساعة اختبار)،
 * لذلك تُشغَّل فقط على Supabase المحلي القابل لإعادة الضبط (npm run db:reset).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadTestEnv() {
  if (loaded) return;
  loaded = true;
  for (const file of ['.env.test.local', '.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p); // لا يستبدل المتغيرات المضبوطة مسبقًا
      } catch {
        /* تجاهل */
      }
    }
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_SECRET']) {
    if (!process.env[name]) throw new Error(`متغير البيئة ${name} غير مضبوط (راجع .env.example)`);
  }
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
  const local = ['127.0.0.1', 'localhost', '::1', 'host.docker.internal'].includes(host);
  if (!local && process.env.JODEX_TESTS_ALLOW_REMOTE !== 'true') {
    throw new Error(
      `ترفض الاختبارات العمل على Supabase غير محلي (${host}). شغّلها على البيئة المحلية فقط، ` +
        'أو اضبط JODEX_TESTS_ALLOW_REMOTE=true لبيئة اختبار منفصلة قابلة للإتلاف (لا تستخدمه للإنتاج).',
    );
  }
}
