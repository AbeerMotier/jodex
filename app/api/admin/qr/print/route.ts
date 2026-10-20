import { listQrCards } from '@/lib/server/admin/qr';
import { parseUuid } from '@/lib/server/admin/common';
import { audit } from '@/lib/server/audit';
import { ApiError, authed } from '@/lib/server/http';
import { htmlToPdf } from '@/lib/server/reports/pdf';
import { qrCardsDocument } from '@/lib/server/reports/qr-card';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** طباعة كل رموز QR (أو رموز مبنى واحد) في ملف PDF واحد — بطاقة لكل صفحة A5 */
export const GET = authed(['admin'], async ({ req, user }) => {
  const building = parseUuid(req.nextUrl.searchParams, 'building');
  const { cards } = await listQrCards(building);
  if (!cards.length) throw new ApiError(404, 'not_found', 'لا توجد رموز QR للطباعة.');
  const html = await qrCardsDocument(cards.map((c) => ({ svg: c.svg, code: c.restroom.code })));
  const pdf = await htmlToPdf(html, { format: 'A5', margin: '0' });
  await audit(user.id, 'qr.print_all', 'qr_codes', null, { building: building ?? null, count: cards.length });
  const filename = 'jodex-qr-all.pdf';
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
});
