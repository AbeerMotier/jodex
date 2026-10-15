import 'server-only';
import { riyadhDate } from '@/lib/domain/time';
import { createServiceClient } from './supabase';

/**
 * يضمن وجود جولات اليوم ويُغلق الجولات الفائتة قبل أي قراءة
 * (احتياط بجانب المهام المجدولة pg_cron).
 */
export async function syncRounds(now: Date) {
  const svc = createServiceClient();
  const today = riyadhDate(now);
  // الترتيب مهم: الإنشاء أولًا ثم الإغلاق، حتى تُغلق جولات اليوم المنشأة متأخرًا بعد آخر موعد
  const ensure = await svc.rpc('ensure_daily_rounds', { p_date: today });
  if (ensure.error) console.error('[jodex] ensure_daily_rounds failed', ensure.error.message);
  const close = await svc.rpc('close_overdue_rounds', { p_now: now.toISOString() });
  if (close.error) console.error('[jodex] close_overdue_rounds failed', close.error.message);
}
