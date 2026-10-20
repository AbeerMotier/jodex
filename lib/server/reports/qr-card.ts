import 'server-only';
import { esc } from './html';
import { embeddedFontCss } from './pdf';

export interface PrintCard {
  svg: string;
  code: string;
}

/** بطاقة QR واحدة للطباعة (A5 عمودي) */
export function qrCardDocument(card: PrintCard): Promise<string> {
  return qrCardsDocument([card], `${card.code} — رمز QR`);
}

/**
 * بطاقات QR للطباعة (A5 عمودي، بطاقة لكل صفحة) بنفس تصميم بطاقة صفحة «رموز QR»:
 * رأس أخضر بالشعار، رمز QR حقيقي بإطار زوايا، ثم «دورة مياه» وتحتها الترميز فقط.
 */
export async function qrCardsDocument(cards: PrintCard[], title = 'رموز QR — دورات المياه'): Promise<string> {
  const fonts = await embeddedFontCss();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fonts}
@page{size:A5 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0}
body{font-family:'IBM Plex Sans Arabic',sans-serif;color:#2F4F44;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{height:210mm;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.card{width:118mm;border:1px solid #E3EAE6;border-radius:26px;overflow:hidden;background:#fff;display:flex;flex-direction:column;align-items:center;text-align:center}
.head{position:relative;width:100%;background:#55957A;display:flex;justify-content:center;padding:26px 0 96px;overflow:hidden}
.head i{position:absolute;border-radius:50%;pointer-events:none}
.head .r1{width:250px;height:250px;left:-110px;top:-95px;border:1.4px solid rgba(255,255,255,.35)}
.head .r2{width:220px;height:170px;right:-95px;top:14px;border:1.4px solid rgba(255,255,255,.3)}
.head .r3{width:150px;height:150px;left:42%;top:-118px;border:1.4px solid rgba(255,255,255,.25)}
.logo{position:relative;display:flex;flex-direction:column;align-items:center;color:#fff;gap:2px}
.logo .latin{display:flex;align-items:center;font-size:46px;font-weight:700;line-height:1;letter-spacing:-1.5px}
.logo .lens{position:relative;width:34px;height:34px;margin:0 2px 0 1px;display:inline-block}
.logo .ring{position:absolute;inset:0;border:7px solid #fff;border-radius:50%}
.logo .core{position:absolute;inset:10px;background:#C5E2CC;border-radius:50%}
.logo .handle{position:absolute;width:7px;height:15px;background:#fff;border-radius:3.5px;right:-2px;bottom:-9px;transform:rotate(-42deg)}
.logo .ar{font-size:22px;font-weight:700;line-height:1.4}
.qr{position:relative;margin-top:-72px;background:#fff;border-radius:26px;padding:18px;box-shadow:0 14px 30px -14px rgba(47,79,68,.4)}
.qr .c{position:absolute;width:26px;height:26px;border:0 solid #55957A}
.qr .tr{top:7px;right:7px;border-top-width:4px;border-right-width:4px;border-top-right-radius:12px}
.qr .tl{top:7px;left:7px;border-top-width:4px;border-left-width:4px;border-top-left-radius:12px}
.qr .br{bottom:7px;right:7px;border-bottom-width:4px;border-right-width:4px;border-bottom-right-radius:12px}
.qr .bl{bottom:7px;left:7px;border-bottom-width:4px;border-left-width:4px;border-bottom-left-radius:12px}
.qr .code{width:66mm;height:66mm;padding:6px}
.qr .code svg{display:block;width:100%;height:100%}
.body{display:flex;flex-direction:column;align-items:center;gap:12px;padding:22px 22px 26px}
.name{font-size:24px;font-weight:700}
.rcode{direction:ltr;font-size:21px;font-weight:700;letter-spacing:.5px;margin-top:4px;font-variant-numeric:tabular-nums}
</style></head><body>
${cards
  .map(
    (card) => `<div class="page"><div class="card">
  <div class="head"><i class="r1"></i><i class="r2"></i><i class="r3"></i>
    <div class="logo" aria-label="جُودِكس"><div class="latin" dir="ltr"><span>J</span><span class="lens"><i class="ring"></i><i class="core"></i><i class="handle"></i></span><span>dex</span></div><div class="ar">جُودِكس</div></div>
  </div>
  <div class="qr"><span class="c tr"></span><span class="c tl"></span><span class="c br"></span><span class="c bl"></span><div class="code">${card.svg}</div></div>
  <div class="body">
    <div><div class="name">دورة مياه</div><div class="rcode">${esc(card.code)}</div></div>
  </div>
</div></div>`,
  )
  .join('\n')}
</body></html>`;
}
