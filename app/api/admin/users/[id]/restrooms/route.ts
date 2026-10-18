import { restroomIdsSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { setUserRestrooms } from '@/lib/server/admin/directory';

export const PUT = authed<{ id: string }>(['admin'], async ({ req, user, params }) =>
  setUserRestrooms(user, params.id, (await parseJson(req, restroomIdsSchema)).restroomIds),
);
