import { authed } from '@/lib/server/http';
import { supervisorSites } from '@/lib/server/supervisor';

export const GET = authed(['supervisor'], async ({ user, now }) => supervisorSites(user, now));
