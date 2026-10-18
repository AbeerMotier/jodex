import { bulkMonitorSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { assignMonitor } from '@/lib/server/admin/places';

export const POST = authed(['admin'], async ({ req, user }) => {
  const body = await parseJson(req, bulkMonitorSchema);
  return assignMonitor(user, body.restroomIds, body.monitorId);
});
