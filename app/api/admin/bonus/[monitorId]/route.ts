import { z } from 'zod';
import { riyadhDate } from '@/lib/domain/time';
import { authed, parseJson } from '@/lib/server/http';
import { setBonusApproval } from '@/lib/server/admin/staff';

const bodySchema = z.object({ period: z.enum(['today', 'week', 'month'], 'اختر الفترة.') });

export const POST = authed<{ monitorId: string }>(['admin'], async ({ req, user, params, now }) => {
  const { period } = await parseJson(req, bodySchema);
  return setBonusApproval(user, params.monitorId, period, true, now, riyadhDate(now));
});

export const DELETE = authed<{ monitorId: string }>(['admin'], async ({ req, user, params, now }) => {
  const { period } = await parseJson(req, bodySchema);
  return setBonusApproval(user, params.monitorId, period, false, now, riyadhDate(now));
});
