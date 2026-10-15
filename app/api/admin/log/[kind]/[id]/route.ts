import { authed } from '@/lib/server/http';
import { logDetails } from '@/lib/server/admin/log';

export const GET = authed<{ kind: string; id: string }>(['admin'], async ({ params, now }) => logDetails(params.kind, params.id, now));
