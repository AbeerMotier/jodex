import { buildingSchema } from '@/lib/domain/validation';
import { fullAdminRoute, parseJson } from '@/lib/server/http';
import { createBuilding } from '@/lib/server/admin/places';

export const POST = fullAdminRoute(async ({ req, user }) => createBuilding(user, (await parseJson(req, buildingSchema)).name));
