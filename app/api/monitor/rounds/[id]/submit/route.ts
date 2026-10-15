import { roundSubmitSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { submitRound } from '@/lib/server/monitor';

export const POST = authed<{ id: string }>(['contractor_monitor'], async ({ req, user, params, now }) => {
  const body = await parseJson(req, roundSubmitSchema);
  return submitRound(user, params.id, body, now);
});
