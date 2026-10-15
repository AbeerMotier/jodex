/**
 * اختبارات التكامل الشاملة (Playwright): تبني التطبيق وتشغّله بوضع الإنتاج على منفذ مستقل
 * مع «ساعة اختبار» مفعّلة بسر عشوائي لكل تشغيل، وتعمل على Supabase المحلي فقط.
 *   npm run test:e2e
 */
import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
process.env.E2E_BASE_URL ??= `http://localhost:${PORT}`;
// سر ساعة الاختبار: يُولَّد لكل تشغيل ويُمرَّر للخادم وللاختبارات فقط
process.env.JODEX_TEST_CLOCK_SECRET ??= randomBytes(24).toString('hex');

const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'ar-SA', timezoneId: 'Asia/Riyadh' } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD === 'true' ? `npx next start -p ${PORT}` : `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      JODEX_ALLOW_TEST_CLOCK: 'true',
      JODEX_TEST_CLOCK_SECRET: process.env.JODEX_TEST_CLOCK_SECRET,
      // ملفات تعريف الارتباط Secure لا تُرسل عبر http المحلي أثناء الاختبار فقط
      JODEX_ALLOW_INSECURE_HTTP: 'true',
      APP_BASE_URL: baseURL,
      PUBLIC_APP_URL: baseURL,
      DEMO_MODE: 'false',
    },
  },
});
