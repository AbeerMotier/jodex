import 'server-only';
import { periodRange } from '@/lib/domain/time';
import type { SettingsSaveInput } from '@/lib/domain/validation';
import type { SessionUser } from '../auth';
import { loadItems, loadSettings } from '../catalog';
import { ApiError } from '../http';
import { createServiceClient } from '../supabase';

export async function getSettings() {
  const svc = createServiceClient();
  const [items, settings, inUse, { data: history }] = await Promise.all([
    loadItems(),
    loadSettings(),
    svc.rpc('checklist_items_in_use'),
    svc.from('settings_history').select('id, changed_at, changed_by, recalculation').order('changed_at', { ascending: false }).limit(5),
  ]);
  if (inUse.error) throw new Error(inUse.error.message);
  const used = new Set((inUse.data ?? []) as string[]);
  return {
    partialCreditPct: settings.partial_credit_pct,
    deepCleanWeekday: settings.deep_clean_weekday,
    updatedAt: settings.updated_at,
    items: items.map((i) => ({
      id: i.id,
      key: i.key,
      group: i.group,
      title: i.title,
      description: i.description,
      category: i.category,
      weight: i.weight,
      defaultWeight: i.default_weight,
      isDefault: i.is_default,
      isActive: i.is_active,
      sortOrder: i.sort_order,
      inUse: used.has(i.id),
    })),
    history: history ?? [],
  };
}

const SAVE_ERRORS: Record<string, [number, string]> = {
  weights_sum_invalid: [422, 'يجب أن يكون مجموع أوزان البنود الفعالة في كل مجموعة 100%.'],
  item_in_use: [409, 'لا يمكن حذف بند له إجابات أو تقييمات محفوظة؛ يمكنك تعطيله بدلًا من ذلك.'],
  item_not_found: [404, 'أحد البنود غير موجود. حدّث الصفحة.'],
  item_group_immutable: [422, 'لا يمكن تغيير مجموعة بند بعد إنشائه.'],
  invalid_partial_credit: [422, 'نسبة احتساب «جزئي» بين 0 و100.'],
  invalid_weekday: [422, 'اختر يومًا صحيحًا للتنظيف العميق.'],
  forbidden: [403, 'لا تملك صلاحية الوصول لهذه الصفحة'],
};

export async function saveSettings(user: SessionUser, input: SettingsSaveInput, today: string) {
  const payload = {
    partial_credit_pct: input.partialCreditPct,
    deep_clean_weekday: input.deepCleanWeekday,
    items: input.items.map((i) => ({
      id: i.id ?? null,
      group: i.group,
      title: i.title,
      description: i.description ?? null,
      category: i.category ?? null,
      weight: i.group === 'deep' ? null : i.weight ?? null,
      is_active: i.isActive,
      delete: Boolean(i.delete),
    })),
  };
  const recalc = input.recalc !== 'none' ? periodRange(input.recalc, today) : null;
  const { data, error } = await createServiceClient().rpc('save_settings_tx', {
    p_actor: user.id,
    p_payload: payload,
    p_recalc_from: recalc?.from ?? null,
    p_recalc_to: recalc?.to ?? null,
  });
  if (error) {
    const mapped = SAVE_ERRORS[error.message];
    if (mapped) throw new ApiError(mapped[0], error.message, mapped[1]);
    throw new Error(error.message);
  }
  return {
    recalculation: data?.recalculation ?? null,
    message: recalc ? 'حُفظت الإعدادات وأُعيد حساب النتائج' : 'حُفظت الإعدادات وستُطبَّق على الجولات والتقييمات الجديدة',
  };
}
