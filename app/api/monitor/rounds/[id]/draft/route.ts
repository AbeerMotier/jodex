import { roundDraftSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { saveDraft } from '@/lib/server/monitor';

export const PUT = authed<{ id: string }>(['contractor_monitor'], async ({ req, user, params, now }) => {
  const body = await parseJson(req, roundDraftSchema);
  return saveDraft(user, params.id, body, now);
});
