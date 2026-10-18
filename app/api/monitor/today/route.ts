import { authed } from '@/lib/server/http';
import { loadMonitorToday } from '@/lib/server/monitor';

export const GET = authed(['contractor_monitor'], async ({ req, user, now }) =>
  loadMonitorToday(user, now, req.nextUrl.searchParams.get('restroom')),
);
