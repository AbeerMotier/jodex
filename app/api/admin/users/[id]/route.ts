import { userUpdateSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { updateUser } from '@/lib/server/admin/directory';

export const PATCH = authed<{ id: string }>(['admin'], async ({ req, user, params }) =>
  updateUser(user, params.id, await parseJson(req, userUpdateSchema)),
);
