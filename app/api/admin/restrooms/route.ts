import { restroomSchema } from '@/lib/domain/validation';
import { fullAdminRoute, parseJson } from '@/lib/server/http';
import { createRestroom, listPlaces } from '@/lib/server/admin/places';

export const GET = fullAdminRoute(async () => listPlaces());

export const POST = fullAdminRoute(async ({ req, user }) => createRestroom(user, await parseJson(req, restroomSchema)));
