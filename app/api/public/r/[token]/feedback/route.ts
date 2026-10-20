import { FEEDBACK_RATING_VALUE, FEEDBACK_WINDOW_MINUTES } from '@/lib/domain/catalog';
import { feedbackSchema } from '@/lib/domain/validation';
import { getSessionUser } from '@/lib/server/auth';
import { ApiError, clientIp, json, parseJson, publicRoute } from '@/lib/server/http';
import { feedbackIdentity, feedbackRetryAfter, resolveRestroomRef, tooSoonMessage } from '@/lib/server/public';
import { hitRateLimit, minutesText } from '@/lib/server/rate-limit';
import { createServiceClient } from '@/lib/server/supabase';

/** [قرار مطلوب] حد إضافي لكل عنوان IP لمنع الإساءة الآلية (الشبكات المشتركة في المباني مسموحة بهامش واسع) */
const IP_WINDOW_SECONDS = 10 * 60;
const IP_MAX = 60;

const DB_ERRORS: Record<string, [number, string]> = {
  invalid_token: [404, 'الرمز غير صالح'],
  reasons_required: [422, 'اختر سببًا واحدًا على الأقل لعدم رضاك.'],
  other_text_required: [422, 'اكتب سبب عدم رضاك في حقل «أخرى».'],
  reasons_not_allowed: [422, 'أسباب عدم الرضا تُختار مع تقييم «سيئ» فقط.'],
  invalid_reason: [422, 'سبب غير معروف.'],
  invalid_rating: [422, 'اختر تقييمك لنظافة دورة المياه.'],
};

export const POST = publicRoute<{ token: string }>(async ({ req, params, now }) => {
  const info = await resolveRestroomRef(params.token);
  if (!info) throw new ApiError(404, 'invalid_token', 'الرمز غير صالح');
  const body = await parseJson(req, feedbackSchema);

  const ip = clientIp(req);
  const ipLimit = await hitRateLimit(`feedback:ip:${ip}`, IP_WINDOW_SECONDS, IP_MAX, now);
  if (!ipLimit.allowed) {
    throw new ApiError(429, 'rate_limited', `طلبات كثيرة من هذه الشبكة. حاول بعد ${minutesText(ipLimit.retryAfterSeconds)}.`);
  }

  // تقييم واحد كل 24 ساعة لكل دورة مياه: بحساب المستفيد إن كان مسجلًا، وإلا بجهازه
  const user = await getSessionUser().catch(() => null);
  const identity = feedbackIdentity({
    userId: user?.id ?? null,
    deviceId: req.cookies.get('jodex_device')?.value,
    ip,
    userAgent: req.headers.get('user-agent') ?? '',
  });
  const retry = await feedbackRetryAfter(identity.all, info.restroomId, now);
  if (retry) throw new ApiError(429, 'too_soon', tooSoonMessage(retry), undefined, { retryAfterSeconds: retry });

  const { data, error } = await createServiceClient().rpc('submit_feedback_tx', {
    p_token: info.qrToken,
    p_rating: FEEDBACK_RATING_VALUE[body.rating],
    p_reason_keys: body.rating === 'bad' ? body.reasons : [],
    p_other_text: body.rating === 'bad' && body.reasons.includes('other') ? body.otherText : null,
    p_client_hash: identity.primary,
    p_now: now.toISOString(),
    p_window_minutes: FEEDBACK_WINDOW_MINUTES,
  });
  if (error) {
    const mapped = DB_ERRORS[error.message];
    if (mapped) throw new ApiError(mapped[0], error.message, mapped[1]);
    throw error;
  }
  if (!data?.ok) {
    const seconds = Number(data?.retry_after_seconds ?? FEEDBACK_WINDOW_MINUTES * 60);
    throw new ApiError(429, 'too_soon', tooSoonMessage(seconds), undefined, { retryAfterSeconds: seconds });
  }
  return json({ ok: true, rating: body.rating, submittedAt: now.toISOString() }, { status: 201 });
});
