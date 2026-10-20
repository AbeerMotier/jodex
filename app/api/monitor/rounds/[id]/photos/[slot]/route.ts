import { isPhotoSlot } from '@/lib/domain/catalog';
import { ApiError, authed } from '@/lib/server/http';
import { deleteRoundPhoto, uploadRoundPhoto } from '@/lib/server/monitor';
import { readUpload } from '@/lib/server/photos';

export const POST = authed<{ id: string; slot: string }>(['contractor_monitor'], async ({ req, user, params, now }) => {
  if (!isPhotoSlot(params.slot)) throw new ApiError(404, 'invalid_slot', 'خانة الصورة غير معروفة.');
  const { file, source } = await readUpload(req);
  return uploadRoundPhoto(user, params.id, params.slot, file, now, source);
});

export const DELETE = authed<{ id: string; slot: string }>(['contractor_monitor'], async ({ user, params, now }) => {
  if (!isPhotoSlot(params.slot)) throw new ApiError(404, 'invalid_slot', 'خانة الصورة غير معروفة.');
  return deleteRoundPhoto(user, params.id, params.slot, now);
});
