import { buildingSchema } from '@/lib/domain/validation';
import { ApiError, fullAdminRoute, parseJson } from '@/lib/server/http';
import { deleteBuilding, renameBuilding } from '@/lib/server/admin/places';

export const PATCH = fullAdminRoute<{ id: string }>(async ({ req, user, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ApiError(404, 'not_found', 'المبنى غير موجود.');
  return renameBuilding(user, params.id, (await parseJson(req, buildingSchema)).name);
});

export const DELETE = fullAdminRoute<{ id: string }>(async ({ user, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ApiError(404, 'not_found', 'المبنى غير موجود.');
  return deleteBuilding(user, params.id);
});
