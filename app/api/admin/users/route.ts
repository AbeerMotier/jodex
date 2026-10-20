import { userCreateSchema } from '@/lib/domain/validation';
import { fullAdminRoute, parseJson } from '@/lib/server/http';
import { createUser, listUsers } from '@/lib/server/admin/directory';

export const GET = fullAdminRoute(async () => listUsers());

export const POST = fullAdminRoute(async ({ req, user }) => createUser(user, await parseJson(req, userCreateSchema)));
