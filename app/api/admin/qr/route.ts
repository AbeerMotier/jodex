import { authed } from '@/lib/server/http';
import { parseUuid } from '@/lib/server/admin/common';
import { listQrCards } from '@/lib/server/admin/qr';

export const GET = authed(['admin'], async ({ req }) => listQrCards(parseUuid(req.nextUrl.searchParams, 'building')));
