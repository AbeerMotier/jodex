import { buildingSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { createBuilding } from '@/lib/server/admin/places';

export const POST = authed(['admin'], async ({ req, user }) => createBuilding(user, (await parseJson(req, buildingSchema)).name));
