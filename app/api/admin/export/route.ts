import { authed } from '@/lib/server/http';
import { exportReport } from '@/lib/server/admin/export';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = authed(['admin'], async ({ req, user, now }) => {
  const file = await exportReport(user, req.nextUrl.searchParams, now);
  return new Response(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Cache-Control': 'no-store',
    },
  });
});
