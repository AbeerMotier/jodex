import 'server-only';
import { embeddedFontCss } from './pdf';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NUMERIC = /(\d+(?:[.,]\d+)?\s?%|%\s?\d+(?:[.,]\d+)?)/g;
const ARABIC = /[\u0600-\u06FF]/;

/**
 * نص عربي قد يحتوي نسبًا مئوية: تُعزل الأرقام مع % باتجاه LTR (مثل MixedText في الواجهة)
 * حتى تظهر «72.5%» لا «%72.5»؛ والنص الرقمي البحت يُعرض كاملًا LTR.
 */
export function mixed(text: string): string {
  if (!ARABIC.test(text) && /\d/.test(text)) return `<bdi dir="ltr">${esc(text)}</bdi>`;
  return text
    .split(NUMERIC)
    .map((part, i) => (i % 2 === 1 ? `<bdi dir="ltr">${esc(part)}</bdi>` : esc(part)))
    .join('');
}

export type Cell = string | { html: string };
const cell = (c: Cell) => (typeof c === 'string' ? mixed(c) : c.html);

export function table(headers: string[], rows: Cell[][], options: { widths?: string[]; empty?: string } = {}): string {
  const widths = options.widths;
  if (rows.length === 0) return `<div class="empty">${esc(options.empty ?? 'لا توجد بيانات في هذه الفترة.')}</div>`;
  return `<table><colgroup>${(widths ?? []).map((w) => `<col style="width:${w}">`).join('')}</colgroup><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const TONE: Record<string, [string, string]> = {
  success: ['#E6F2EA', '#3F7A62'],
  warning: ['#FBF4E1', '#94711C'],
  error: ['#FCEDE7', '#B5512F'],
  neutral: ['#EAF3EC', '#44665A'],
  monitor: ['#E4EEEA', '#2F4F44'],
  supervisor: ['#E0EEE6', '#2F4F44'],
};

export function chip(text: string, tone: string): { html: string } {
  const [bg, c] = TONE[tone] ?? TONE.neutral;
  return { html: `<span class="chip" style="background:${bg};color:${c}">${esc(text)}</span>` };
}

export function num(text: string): { html: string } {
  return { html: `<bdi dir="ltr" class="num">${esc(text)}</bdi>` };
}

const LOGO = `<div class="logo" aria-label="جُودِكس"><div class="latin" dir="ltr"><span>J</span><span class="lens"><i class="ring"></i><i class="core"></i><i class="handle"></i></span><span>dex</span></div><div class="ar">جُودِكس</div></div>`;

export async function reportDocument(opts: { title: string; subtitle?: string; meta: [string, string][]; body: string }): Promise<string> {
  const fonts = await embeddedFontCss();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
${fonts}
*{box-sizing:border-box}
body{margin:0;font-family:'IBM Plex Sans Arabic',sans-serif;color:#2F4F44;font-size:11.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;justify-content:space-between;align-items:center;background:#55957A;color:#fff;border-radius:18px;padding:14px 18px;margin-bottom:14px;position:relative;overflow:hidden}
.head:before{content:'';position:absolute;width:180px;height:180px;border-radius:50%;border:1.2px solid rgba(255,255,255,.3);left:-70px;top:-90px}
.head h1{margin:0;font-size:19px;font-weight:700}
.head .sub{font-size:11.5px;margin-top:3px}
.logo{display:flex;flex-direction:column;align-items:center;color:#fff}
.logo .latin{display:flex;align-items:center;font-size:24px;font-weight:700;line-height:1;letter-spacing:-1px}
.logo .lens{position:relative;width:18px;height:18px;margin:0 1px;display:inline-block}
.logo .ring{position:absolute;inset:0;border:3.5px solid #fff;border-radius:50%}
.logo .core{position:absolute;inset:5.5px;background:#C5E2CC;border-radius:50%}
.logo .handle{position:absolute;width:3.5px;height:8px;background:#fff;border-radius:2px;right:-1px;bottom:-4px;transform:rotate(-42deg)}
.logo .ar{font-size:11px;font-weight:700}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 2px 14px;font-size:11px;color:#44665A}
.meta b{color:#2F4F44}
h2{font-size:14px;margin:18px 0 8px}
table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #E3EAE6;border-radius:12px;overflow:hidden;page-break-inside:auto}
thead{display:table-header-group}
tr{page-break-inside:avoid}
th{background:#EAF3EC;color:#44665A;font-weight:600;font-size:10.5px;text-align:right;padding:7px 8px}
td{padding:7px 8px;border-top:1px solid #EDF2EF;vertical-align:top}
.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;white-space:nowrap}
.num{font-variant-numeric:tabular-nums}
.muted{color:#687D74;font-size:10px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.card{border:1px solid #E3EAE6;border-radius:12px;padding:10px 12px}
.card .k{font-size:10.5px;color:#687D74}
.card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.empty{border:1px dashed #E3EAE6;border-radius:12px;padding:16px;text-align:center;color:#687D74}
.foot{margin-top:18px;font-size:9.5px;color:#687D74;text-align:center}
</style></head><body>
<div class="head"><div><h1>${esc(opts.title)}</h1>${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}</div>${LOGO}</div>
<div class="meta">${opts.meta.map(([k, v]) => `<span>${esc(k)}: <b>${mixed(v)}</b></span>`).join('')}</div>
${opts.body}
<div class="foot">جُودِكس — نظام تقييم ومتابعة نظافة دورات المياه · تقرير مولَّد آليًا من بيانات النظام</div>
</body></html>`;
}
