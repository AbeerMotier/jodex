import { restroomSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { createRestroom, listPlaces } from '@/lib/server/admin/places';

export const GET = authed(['admin'], async () => listPlaces());

export const POST = authed(['admin'], async ({ req, user }) => createRestroom(user, await parseJson(req, restroomSchema)));
