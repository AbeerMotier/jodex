import { restroomSchema } from '@/lib/domain/validation';
import { ApiError, authed, parseJson } from '@/lib/server/http';
import { deleteRestroom, updateRestroom } from '@/lib/server/admin/places';

export const PATCH = authed<{ id: string }>(['admin'], async ({ req, user, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ApiError(404, 'not_found', 'دورة المياه غير موجودة.');
  return updateRestroom(user, params.id, await parseJson(req, restroomSchema));
});

export const DELETE = authed<{ id: string }>(['admin'], async ({ user, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ApiError(404, 'not_found', 'دورة المياه غير موجودة.');
  return deleteRestroom(user, params.id);
});
