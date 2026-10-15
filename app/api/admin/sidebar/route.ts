import { authed } from '@/lib/server/http';
import { parseCommon } from '@/lib/server/admin/common';
import { sidebarCounts } from '@/lib/server/admin/sidebar';

export const GET = authed(['admin'], async ({ req, now }) => sidebarCounts(parseCommon(req.nextUrl.searchParams, now)));
