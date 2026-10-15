import { authed } from '@/lib/server/http';
import { loadMonitorToday } from '@/lib/server/monitor';

export const GET = authed(['contractor_monitor'], async ({ user, now }) => loadMonitorToday(user, now));
