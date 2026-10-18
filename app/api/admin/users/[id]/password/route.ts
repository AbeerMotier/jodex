import { authed } from '@/lib/server/http';
import { resetUserPassword } from '@/lib/server/admin/directory';

export const POST = authed<{ id: string }>(['admin'], async ({ user, params }) => resetUserPassword(user, params.id));
