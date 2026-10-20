import { qrCardById } from '@/lib/server/admin/qr';
import { audit } from '@/lib/server/audit';
import { ApiError, authed } from '@/lib/server/http';
import { htmlToPdf } from '@/lib/server/reports/pdf';
import { qrCardDocument } from '@/lib/server/reports/qr-card';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** ملف PDF جاهز للطباعة بنفس تصميم بطاقة QR */
export const GET = authed<{ id: string }>(['admin'], async ({ user, params }) => {
  const card = await qrCardById(params.id);
  if (!card) throw new ApiError(404, 'not_found', 'رمز QR غير موجود.');
  const html = await qrCardDocument({ svg: card.svg, code: card.restroom.code, scanUrl: card.scanUrl });
  const pdf = await htmlToPdf(html, { format: 'A5', margin: '0' });
  await audit(user.id, 'qr.print', 'qr_codes', card.id, { restroom_code: card.restroom.code });
  const filename = `jodex-qr-${card.restroom.code}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
});
