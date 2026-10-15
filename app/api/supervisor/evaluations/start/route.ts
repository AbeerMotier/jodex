import { evaluationStartSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { startEvaluation } from '@/lib/server/supervisor';

export const POST = authed(['supervisor'], async ({ req, user, now }) => {
  const body = await parseJson(req, evaluationStartSchema);
  return startEvaluation(user, body.restroomId, now);
});
