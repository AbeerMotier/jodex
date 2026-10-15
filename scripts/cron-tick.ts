/**
 * تشغيل يدوي/خارجي لمهام الجدولة (بديل pg_cron عند الحاجة):
 *   1) إنشاء جولات اليوم (صباحية ومسائية) لكل دورة مياه نشطة لها مراقب أساسي
 *   2) إغلاق الجولات التي تجاوزت آخر موعد كـ«فائتة» بدرجة التزام 0
 *   3) تنظيف سجلات تحديد المعدل القديمة
 * المرجع الزمني: وقت الخادم الحالي بتوقيت Asia/Riyadh.
 *
 *   npm run cron:tick
 */
import { riyadhDate } from '../lib/domain/time';
import { serviceClient } from './lib/env';

async function main() {
  const svc = serviceClient();
  const now = new Date();
  const today = riyadhDate(now);
  const created = await svc.rpc('ensure_daily_rounds', { p_date: today });
  if (created.error) throw new Error(`ensure_daily_rounds: ${created.error.message}`);
  const closed = await svc.rpc('close_overdue_rounds', { p_now: now.toISOString() });
  if (closed.error) throw new Error(`close_overdue_rounds: ${closed.error.message}`);
  const cleaned = await svc.rpc('maintenance_cleanup', { p_now: now.toISOString() });
  if (cleaned.error) throw new Error(`maintenance_cleanup: ${cleaned.error.message}`);
  console.log(`✓ ${today}: أُنشئت ${created.data ?? 0} جولة، وأُغلقت ${closed.data ?? 0} جولة فائتة.`);
}

main().catch((e) => {
  console.error('✗ فشل تشغيل المهام المجدولة:', e instanceof Error ? e.message : e);
  process.exit(1);
});
