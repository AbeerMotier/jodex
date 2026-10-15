import { ApiError, publicRoute } from '@/lib/server/http';
import { resolveQrToken } from '@/lib/server/public';

export const GET = publicRoute<{ token: string }>(async ({ params, now }) => {
  const info = await resolveQrToken(params.token);
  if (!info) throw new ApiError(404, 'invalid_token', 'الرمز غير صالح');
  return {
    restroom: { name: info.name, floor: info.floor, building: info.building },
    serverNow: now.toISOString(),
  };
});
