import { restroomIdsSchema } from '@/lib/domain/validation';
import { fullAdminRoute, parseJson } from '@/lib/server/http';
import { setUserRestrooms } from '@/lib/server/admin/directory';

export const PUT = fullAdminRoute<{ id: string }>(async ({ req, user, params }) =>
  setUserRestrooms(user, params.id, (await parseJson(req, restroomIdsSchema)).restroomIds),
);
