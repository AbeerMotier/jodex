import { buildingSchema } from '@/lib/domain/validation';
import { ApiError, authed, parseJson } from '@/lib/server/http';
import { renameBuilding } from '@/lib/server/admin/places';

export const PATCH = authed<{ id: string }>(['admin'], async ({ req, user, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ApiError(404, 'not_found', 'المبنى غير موجود.');
  return renameBuilding(user, params.id, (await parseJson(req, buildingSchema)).name);
});
