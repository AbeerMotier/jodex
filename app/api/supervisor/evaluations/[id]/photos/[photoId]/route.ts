import { authed } from '@/lib/server/http';
import { deleteEvaluationPhoto } from '@/lib/server/supervisor';

export const DELETE = authed<{ id: string; photoId: string }>(['supervisor'], async ({ user, params }) =>
  deleteEvaluationPhoto(user, params.id, params.photoId),
);
