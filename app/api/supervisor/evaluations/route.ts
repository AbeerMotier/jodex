import { evaluationSubmitSchema } from '@/lib/domain/validation';
import { authed, parseJson } from '@/lib/server/http';
import { submitEvaluation } from '@/lib/server/supervisor';

/** إرسال تقييم الموقع (الصور تُرفع مسبقًا عبر /api/supervisor/evaluations/{id}/photos) */
export const POST = authed(['supervisor'], async ({ req, user, now }) => {
  const body = await parseJson(req, evaluationSubmitSchema);
  return submitEvaluation(user, body, now);
});
