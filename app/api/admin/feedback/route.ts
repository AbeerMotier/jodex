import { authed } from '@/lib/server/http';
import { parseCommon } from '@/lib/server/admin/common';
import { FEEDBACK_PAGE_SIZE, listFeedback } from '@/lib/server/admin/feedback';
import { parseEnum, parseOffset } from '@/lib/server/admin/params';

export const GET = authed(['admin'], async ({ req, now }) => {
  const sp = req.nextUrl.searchParams;
  const offset = parseOffset(sp);
  const result = await listFeedback({
    ...parseCommon(sp, now),
    rating: parseEnum(sp, 'rating', ['excellent', 'good', 'bad'] as const),
    offset,
    limit: FEEDBACK_PAGE_SIZE,
  });
  const next = offset + result.rows.length;
  return { ...result, nextCursor: next < result.total ? String(next) : null };
});
