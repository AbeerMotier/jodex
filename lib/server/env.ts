import 'server-only';

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function required(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`متغير البيئة ${name} غير مضبوط`);
  return v;
}

/** متغيرات البيئة (تُقرأ عند الاستخدام وليس عند البناء) */
export const env = {
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get serviceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  /** نطاق الإدارة؛ على Render يُستخدم الرابط العام للخدمة تلقائيًا إن لم يُضبط */
  get appBaseUrl() {
    return (read('APP_BASE_URL') ?? read('RENDER_EXTERNAL_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  /** النطاق المستخدم في روابط QR العامة (قد يختلف عن نطاق الإدارة) */
  get publicAppUrl() {
    return (read('PUBLIC_APP_URL') ?? read('APP_BASE_URL') ?? read('RENDER_EXTERNAL_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  get appSecret() {
    const s = required('APP_SECRET');
    if (s.length < 32) throw new Error('APP_SECRET يجب ألا يقل عن 32 حرفًا');
    return s;
  },
  get cronSecret() {
    return read('CRON_SECRET');
  },
  get authEmailDomain() {
    return read('AUTH_EMAIL_DOMAIN') ?? 'jodex.local';
  },
  get demoMode() {
    return read('DEMO_MODE') === 'true';
  },
  get testClock() {
    const secret = read('JODEX_TEST_CLOCK_SECRET');
    return read('JODEX_ALLOW_TEST_CLOCK') === 'true' && secret && secret.length >= 16 ? secret : undefined;
  },
  /** عدد الوكلاء العكسيين الموثوقين أمام التطبيق (لقراءة عنوان العميل من X-Forwarded-For) */
  get trustedProxyHops() {
    const n = Number(read('TRUSTED_PROXY_HOPS') ?? 1);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
  },
  /** وضع ذاكرة منخفضة لتوليد PDF (خوادم 512MB): متصفح لكل طلب يُغلق بعده */
  get pdfLowMemory() {
    return read('JODEX_PDF_LOW_MEMORY') === 'true';
  },
  get chromiumPath() {
    return read('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH');
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
};
