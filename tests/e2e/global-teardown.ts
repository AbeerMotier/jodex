import { retireQaWorld, serviceClient, type QaWorld } from '../support/world';

interface Snapshot {
  settings: { partial_credit_pct: number; deep_clean_weekday: number };
  items: { id: string; title: string; description: string | null; weight: number | null; is_active: boolean; sort_order: number; group: string }[];
}

/** يستعيد الإعدادات والأوزان كما كانت قبل الاختبارات ثم يعطّل عالم الاختبار */
export default async function globalTeardown() {
  const raw = process.env.JODEX_QA_WORLD;
  if (!raw) return;
  const world = JSON.parse(raw) as QaWorld;
  const snapshot = process.env.JODEX_QA_SETTINGS ? (JSON.parse(process.env.JODEX_QA_SETTINGS) as Snapshot) : null;
  try {
    if (snapshot) {
      const svc = serviceClient();
      const { data: current } = await svc.from('checklist_items').select('id');
      const known = new Set(snapshot.items.map((i) => i.id));
      const payload = {
        partial_credit_pct: Number(snapshot.settings.partial_credit_pct),
        deep_clean_weekday: snapshot.settings.deep_clean_weekday,
        items: [
          ...snapshot.items.map((i) => ({ id: i.id, title: i.title, description: i.description, weight: i.weight, is_active: i.is_active, sort_order: i.sort_order })),
          // بنود أضافتها الاختبارات: تُعطَّل (أو تُحذف إن لم تُستخدم)
          ...(current ?? []).filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, delete: true })),
        ],
      };
      let res = await svc.rpc('save_settings_tx', { p_actor: world.users.admin.id, p_payload: payload });
      if (res.error?.message === 'item_in_use') {
        const { data: extra } = await svc.from('checklist_items').select('id, title, weight').in('id', (current ?? []).filter((c) => !known.has(c.id)).map((c) => c.id));
        payload.items = [
          ...payload.items.filter((i) => !('delete' in i)),
          ...(extra ?? []).map((e) => ({ id: e.id, title: e.title, description: null, weight: e.weight, is_active: false, sort_order: 999 })),
        ];
        res = await svc.rpc('save_settings_tx', { p_actor: world.users.admin.id, p_payload: payload });
      }
      if (res.error) console.error('[e2e teardown] تعذّرت استعادة الإعدادات:', res.error.message);
    }
  } finally {
    await retireQaWorld(world);
  }
}
