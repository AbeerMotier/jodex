import { loadTestEnv } from '../support/env';
import { createQaWorld, serviceClient } from '../support/world';

/** ينشئ عالم الاختبار المعزول ويحفظ لقطة الإعدادات لاستعادتها في النهاية */
export default async function globalSetup() {
  loadTestEnv();
  const svc = serviceClient();
  const { data: settings } = await svc.from('settings').select('partial_credit_pct, deep_clean_weekday').single();
  const { data: items } = await svc.from('checklist_items').select('id, title, description, weight, is_active, sort_order, "group"');
  process.env.JODEX_QA_SETTINGS = JSON.stringify({ settings, items });
  const world = await createQaWorld('E2E');
  process.env.JODEX_QA_WORLD = JSON.stringify(world);
}
