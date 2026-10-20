import { fieldErrors, passwordSetSchema } from '@/lib/domain/validation';
import { ApiError, fullAdminRoute } from '@/lib/server/http';
import { resetUserPassword } from '@/lib/server/admin/directory';

/** جسم الطلب اختياري: { password } لكلمة يحددها الأدمن، وبدونه تُنشأ كلمة عشوائية قوية */
export const POST = fullAdminRoute<{ id: string }>(async ({ req, user, params }) => {
  const raw = (await req.text()).trim();
  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError(400, 'bad_json', 'طلب غير صالح.');
  }
  const parsed = passwordSetSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(422, 'validation', parsed.error.issues[0]?.message ?? 'كلمة مرور غير صالحة.', fieldErrors(parsed.error));
  return resetUserPassword(user, params.id, parsed.data.password);
});
