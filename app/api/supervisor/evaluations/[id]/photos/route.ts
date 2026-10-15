import { authed } from '@/lib/server/http';
import { readUploadedFile } from '@/lib/server/photos';
import { uploadEvaluationPhoto } from '@/lib/server/supervisor';

export const POST = authed<{ id: string }>(['supervisor'], async ({ req, user, params, now }) => {
  const file = await readUploadedFile(req);
  return uploadEvaluationPhoto(user, params.id, file, now);
});
