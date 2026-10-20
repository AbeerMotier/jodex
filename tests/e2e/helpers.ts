import { randomUUID } from 'node:crypto';
import { expect, request, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { cameraJpeg, jpegWithGps } from '../support/images';
import type { QaUser, QaWorld } from '../support/world';

export { at, addDays, nextDate, weekdayOfDate } from '../support/time';

export const BASE = () => process.env.E2E_BASE_URL!;
export const world = (): QaWorld => JSON.parse(process.env.JODEX_QA_WORLD!);

let ipSeq = Math.floor(Math.random() * 200);
/** عنوان IP مستقل لكل جلسة اختبار (حدود المعدل لكل IP لا تتداخل بين الاختبارات) */
export const freshIp = () => {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};

export function clockHeaders(at: string | null): Record<string, string> {
  if (!at) return {};
  return { 'x-jodex-test-now': at, 'x-jodex-test-secret': process.env.JODEX_TEST_CLOCK_SECRET! };
}

/** جلسة واجهة برمجية حقيقية (كوكيز الجلسة + CSRF) مع ساعة اختبار قابلة للتغيير */
export class Api {
  at: string | null = null;
  private constructor(
    readonly ctx: APIRequestContext,
    readonly csrf: string,
  ) {}

  static async anonymous(options: { ip?: string; at?: string } = {}) {
    const ctx = await request.newContext({ baseURL: BASE(), extraHTTPHeaders: { 'x-forwarded-for': options.ip ?? freshIp() } });
    const res = await ctx.get('/api/auth/csrf');
    expect(res.ok()).toBeTruthy();
    const { token } = (await res.json()) as { token: string };
    const api = new Api(ctx, token);
    api.at = options.at ?? null;
    return api;
  }

  static async as(user: QaUser, at?: string) {
    const api = await Api.anonymous({ at });
    const res = await api.post('/api/auth/login', { username: user.username, password: user.password });
    expect(res.status(), await res.text()).toBe(200);
    return api;
  }

  headers(extra: Record<string, string> = {}) {
    return { 'x-csrf-token': this.csrf, ...clockHeaders(this.at), ...extra };
  }
  get(path: string) {
    return this.ctx.get(path, { headers: this.headers() });
  }
  post(path: string, data?: unknown) {
    return this.ctx.post(path, { headers: this.headers(), data: data ?? {} });
  }
  put(path: string, data?: unknown) {
    return this.ctx.put(path, { headers: this.headers(), data: data ?? {} });
  }
  delete(path: string, data?: unknown) {
    return this.ctx.delete(path, { headers: this.headers(), data: data ?? {} });
  }
  upload(path: string, buffer: Buffer, name = 'photo.jpg', mimeType = 'image/jpeg', fields: Record<string, string> = {}) {
    return this.ctx.post(path, { headers: this.headers(), multipart: { file: { name, mimeType, buffer }, ...fields } });
  }
  async json<T = unknown>(res: Promise<APIResponse> | APIResponse, status = 200): Promise<T> {
    const r = await res;
    const body = await r.text();
    expect(r.status(), body.slice(0, 500)).toBe(status);
    return JSON.parse(body) as T;
  }
  dispose() {
    return this.ctx.dispose();
  }
}

export interface TodayRound {
  id: string;
  shift: 'am' | 'pm';
  status: 'pending' | 'submitted' | 'missed';
  display: string;
  displayLabel: string;
  complianceLevel: string | null;
  complianceScore: number | null;
  photos: { slot: string }[];
}
export interface TodayData {
  today: string;
  rounds: TodayRound[];
  items: { contractor: { id: string; title: string }[]; deep: { id: string; title: string }[] };
  deep: { required: boolean; weekday: number };
  badge: { state: string; label: string };
  onBehalfOf: string | null;
  restroom: { name: string; code: string };
  user: { name: string; isSubstitute: boolean };
}

export const REQUIRED_SLOTS = ['tools', 'entry', 'sinks', 'general', 'labor'] as const;

export async function monitorToday(api: Api): Promise<TodayData> {
  return api.json<TodayData>(api.get('/api/monitor/today'));
}

export function roundOf(data: TodayData, shift: 'am' | 'pm'): TodayRound {
  const r = data.rounds.find((x) => x.shift === shift);
  if (!r) throw new Error(`no ${shift} round`);
  return r;
}

export async function uploadRequiredPhotos(api: Api, roundId: string, slots: readonly string[] = REQUIRED_SLOTS) {
  let i = 0;
  for (const slot of slots) {
    // كل صور الجولة التقاط مباشر من الكاميرا في الصفحة (source=camera)؛ صورة بموقع GPS بلا تاريخ التقاط قديم مقبولة وتُزال بياناتها
    const res = await api.upload(
      `/api/monitor/rounds/${roundId}/photos/${slot}`,
      slot === 'labor' ? await cameraJpeg(i++) : await jpegWithGps(i++),
      'photo.jpg',
      'image/jpeg',
      { source: 'camera' },
    );
    expect(res.status(), await res.text()).toBe(200);
  }
}

export type AnswerValue = 'done' | 'partial' | 'not_done';

export function answersFor(data: TodayData, value: AnswerValue | ((itemId: string, index: number) => AnswerValue), options: { deep?: boolean } = {}) {
  const pick = (id: string, i: number) => (typeof value === 'function' ? value(id, i) : value);
  const out: Record<string, AnswerValue> = {};
  data.items.contractor.forEach((it, i) => (out[it.id] = pick(it.id, i)));
  if (options.deep !== false) data.items.deep.forEach((it) => (out[it.id] = 'done'));
  return out;
}

export function submitRound(api: Api, roundId: string, answers: Record<string, AnswerValue>, note = '', idempotencyKey = randomUUID()) {
  return api.post(`/api/monitor/rounds/${roundId}/submit`, { answers, note, idempotencyKey });
}

/** جولة كاملة: رفع الصور الإلزامية في uploadAt ثم الإرسال في submitAt */
export async function completeRound(
  api: Api,
  shift: 'am' | 'pm',
  times: { uploadAt: string; submitAt: string },
  answers: AnswerValue | ((itemId: string, index: number) => AnswerValue) = 'done',
) {
  api.at = times.uploadAt;
  const data = await monitorToday(api);
  const round = roundOf(data, shift);
  expect(round.status).toBe('pending');
  await uploadRequiredPhotos(api, round.id);
  api.at = times.submitAt;
  const res = await submitRound(api, round.id, answersFor(data, answers));
  return { res, round, data };
}

/** تقييم مشرف كامل عبر الواجهة البرمجية */
export async function evaluateSite(
  api: Api,
  restroomId: string,
  ratingOf: (itemId: string, index: number) => number,
  options: { note?: string; matchesRound?: 'yes' | 'no'; needsUrgent?: 'yes' | 'no'; view?: boolean } = {},
) {
  const sites = await api.json<{ items: { id: string; title: string }[] }>(api.get('/api/supervisor/sites'));
  const start = await api.json<{ evaluationId: string }>(api.post('/api/supervisor/evaluations/start', { restroomId }));
  if (options.view !== false) await api.json(api.get(`/api/supervisor/sites/${restroomId}/contractor-rounds?evaluationId=${start.evaluationId}`));
  const ratings = Object.fromEntries(sites.items.map((it, i) => [it.id, ratingOf(it.id, i)]));
  const res = await api.post('/api/supervisor/evaluations', {
    evaluationId: start.evaluationId,
    ratings,
    matchesRound: options.matchesRound ?? 'yes',
    needsUrgent: options.needsUrgent ?? 'no',
    note: options.note ?? '',
    idempotencyKey: randomUUID(),
  });
  return { res, evaluationId: start.evaluationId, items: sites.items };
}

export async function giveFeedback(token: string, at: string, body: { rating: 'excellent' | 'good' | 'bad'; reasons?: string[]; otherText?: string }) {
  const api = await Api.anonymous({ at });
  const res = await api.post(`/api/public/r/${token}/feedback`, { reasons: [], otherText: '', ...body });
  const out = { status: res.status(), body: await res.json() };
  await api.dispose();
  return out;
}

/** متصفح بجلسة دخول حقيقية عبر نموذج الدخول وبساعة اختبار ثابتة */
export async function browserAs(browser: Browser, user: QaUser | null, at: string | null, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    extraHTTPHeaders: { ...clockHeaders(at), 'x-forwarded-for': freshIp() },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (user) {
    await page.goto('/login');
    await page.fill('input[name=username]', user.username);
    await page.fill('input[name=password]', user.password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }), page.click('button[type=submit]')]);
  }
  return { context, page, errors };
}

export async function closeAll(...contexts: (BrowserContext | Api | undefined)[]) {
  for (const c of contexts) {
    if (!c) continue;
    if (c instanceof Api) await c.dispose();
    else await c.close();
  }
}

export async function computedColors(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return { color: cs.color, background: cs.backgroundColor, text: (el.textContent ?? '').trim() };
    }),
  );
}

export const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
