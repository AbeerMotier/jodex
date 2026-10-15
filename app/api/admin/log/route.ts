import { authed } from '@/lib/server/http';
import { parseCommon, parseUuid } from '@/lib/server/admin/common';
import { listLog, LOG_PAGE_SIZE, LOG_STATUS_OPTIONS } from '@/lib/server/admin/log';
import { parseEnum, parseOffset } from '@/lib/server/admin/params';

export const GET = authed(['admin'], async ({ req, now }) => {
  const sp = req.nextUrl.searchParams;
  const offset = parseOffset(sp);
  const result = await listLog(
    {
      ...parseCommon(sp, now),
      kind: parseEnum(sp, 'kind', ['round', 'supervisor'] as const),
      status: parseEnum(sp, 'status', LOG_STATUS_OPTIONS.map((o) => o.value)),
      employeeId: parseUuid(sp, 'employee'),
      offset,
      limit: LOG_PAGE_SIZE,
    },
    now,
  );
  const nextOffset = offset + result.rows.length;
  return { ...result, nextCursor: nextOffset < result.total ? String(nextOffset) : null };
});
