import { authed } from '@/lib/server/http';
import { contractorRoundsForSupervisor } from '@/lib/server/supervisor';

export const GET = authed<{ id: string }>(['supervisor'], async ({ req, user, params, now }) => {
  const evaluationId = req.nextUrl.searchParams.get('evaluationId');
  return contractorRoundsForSupervisor(user, params.id, evaluationId, now);
});
