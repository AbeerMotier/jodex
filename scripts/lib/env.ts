/** تحميل متغيرات البيئة للسكربتات الإدارية (.env.local ثم .env) */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServiceRoleClient } from '../../lib/supabase/service';

export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        /* تجاهل */
      }
    }
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`✗ متغير البيئة ${name} غير مضبوط. راجع ملف .env.example`);
    process.exit(1);
  }
  return v;
}

export function serviceClient() {
  loadEnv();
  return createServiceRoleClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

export function authEmailDomain() {
  return process.env.AUTH_EMAIL_DOMAIN?.trim() || 'jodex.local';
}
