import { userCreateSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { createUser, listUsers } from '@/lib/server/admin/directory';

export const GET = authed(['admin'], async () => listUsers());

export const POST = authed(['admin'], async ({ req, user }) => createUser(user, await parseJson(req, userCreateSchema)));
