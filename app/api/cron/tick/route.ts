import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/server/env';
import { errorResponse, json } from '@/lib/server/http';
import { serverNow } from '@/lib/server/clock';
import { createServiceClient } from '@/lib/server/supabase';
import { riyadhDate } from '@/lib/domain/time';

/**
 * بديل اختياري لمهام pg_cron (مثلًا من مجدول المنصة): ينشئ جولات اليوم ويُغلق الجولات الفائتة.
 * محمي بـ Authorization: Bearer CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = env.cronSecret;
    const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const ok = Boolean(secret) && provided.length === secret!.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret!));
    if (!ok) return json({ error: { code: 'forbidden', message: 'غير مصرح' } }, { status: 401 });
    const now = await serverNow();
    const svc = createServiceClient();
    const created = await svc.rpc('ensure_daily_rounds', { p_date: riyadhDate(now) });
    const closed = await svc.rpc('close_overdue_rounds', { p_now: now.toISOString() });
    await svc.rpc('maintenance_cleanup', { p_now: now.toISOString() });
    if (created.error || closed.error) throw new Error(created.error?.message ?? closed.error?.message);
    return json({ ok: true, created: created.data, closed: closed.data, at: now.toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
