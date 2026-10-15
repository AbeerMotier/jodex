import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { env } from '../env';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core');
      const browser = await chromium.launch({
        headless: true,
        executablePath: env.chromiumPath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      });
      browser.on('disconnected', () => {
        browserPromise = null;
      });
      return browser;
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

let fontCss: string | null = null;

/** خط IBM Plex Sans Arabic مضمّنًا في صفحة التقرير (لا اعتماد على الشبكة) */
export async function embeddedFontCss(): Promise<string> {
  if (fontCss) return fontCss;
  const dir = path.join(process.cwd(), 'public', 'fonts');
  const faces: string[] = [];
  for (const weight of [400, 600, 700]) {
    for (const subset of ['arabic', 'latin'] as const) {
      const file = `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`;
      const data = await readFile(path.join(dir, file));
      const range =
        subset === 'arabic'
          ? 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC'
          : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
      faces.push(
        `@font-face{font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');unicode-range:${range};}`,
      );
    }
  }
  fontCss = faces.join('\n');
  return fontCss;
}

/** تحويل صفحة تقرير HTML إلى PDF عبر Playwright (Chromium) */
export async function htmlToPdf(
  html: string,
  options: { format?: 'A4' | 'A5' | 'A6'; landscape?: boolean; margin?: string } = {},
): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({ locale: 'ar-SA' });
  try {
    // لا طلبات شبكة إطلاقًا: كل المحتوى (الخطوط والرموز) مضمّن في الصفحة
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: options.margin !== undefined
        ? { top: options.margin, bottom: options.margin, left: options.margin, right: options.margin }
        : { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}
