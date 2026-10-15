import { authed } from '@/lib/server/http';
import { parseCommon, parseUuid } from '@/lib/server/admin/common';
import { parseEnum } from '@/lib/server/admin/params';
import { staffReport } from '@/lib/server/admin/staff';

export const GET = authed(['admin'], async ({ req, now }) => {
  const sp = req.nextUrl.searchParams;
  return staffReport(
    {
      ...parseCommon(sp, now),
      monitorId: parseUuid(sp, 'monitor'),
      approval: parseEnum(sp, 'approval', ['approved', 'not_approved'] as const),
    },
    now,
  );
});
