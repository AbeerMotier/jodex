import { authed } from '@/lib/server/http';
import { parseCommon, parseSource } from '@/lib/server/admin/common';
import { buildDashboard } from '@/lib/server/admin/dashboard';

export const GET = authed(['admin'], async ({ req, user, now }) => {
  const sp = req.nextUrl.searchParams;
  return buildDashboard(user, parseCommon(sp, now), parseSource(sp), now);
});
