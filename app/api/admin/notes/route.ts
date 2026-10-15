import { authed } from '@/lib/server/http';
import { parseCommon, parseUuid } from '@/lib/server/admin/common';
import { listNotes, NOTES_PAGE_SIZE } from '@/lib/server/admin/notes';
import { parseEnum, parseOffset } from '@/lib/server/admin/params';

export const GET = authed(['admin'], async ({ req, now }) => {
  const sp = req.nextUrl.searchParams;
  const offset = parseOffset(sp);
  const result = await listNotes({
    ...parseCommon(sp, now),
    supervisorId: parseUuid(sp, 'supervisor'),
    severity: parseEnum(sp, 'severity', ['high', 'mid', 'low'] as const),
    offset,
    limit: NOTES_PAGE_SIZE,
  });
  const next = offset + result.rows.length;
  return { ...result, nextCursor: next < result.total ? String(next) : null };
});
