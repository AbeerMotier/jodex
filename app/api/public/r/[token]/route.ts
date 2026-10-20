import { ApiError, publicRoute } from '@/lib/server/http';
import { resolveRestroomRef } from '@/lib/server/public';

export const GET = publicRoute<{ token: string }>(async ({ params, now }) => {
  const info = await resolveRestroomRef(params.token);
  if (!info) throw new ApiError(404, 'invalid_token', 'الرمز غير صالح');
  return {
    restroom: { code: info.code, name: info.name, floor: info.floor, building: info.building },
    serverNow: now.toISOString(),
  };
});
