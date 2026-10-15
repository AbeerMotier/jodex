'use client';
import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { IconEdit, IconPlus, IconTrash } from '@/components/ui/icons';
import { MixedText } from '@/components/ui/mixed-text';
import { Modal } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApi } from '@/lib/client/use-api';
import { EVALUATION_TYPE_LABEL, ITEM_GROUP_EVALUATION, ITEM_GROUP_SCORED, WEEKDAY_LABEL, type ItemGroup } from '@/lib/domain/catalog';
import { fmtNum } from '@/lib/domain/format';
import { GROUP_SUM_MESSAGE, settingsItemSchema, type RecalcOption } from '@/lib/domain/validation';
import { summarizeWeights } from '@/lib/domain/weights';
import { PageHeader } from './page-header';

interface ServerItem {
  id: string;
  key: string;
  group: ItemGroup;
  title: string;
  description: string | null;
  weight: number | null;
  defaultWeight: number | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  inUse: boolean;
}
interface SettingsData {
  partialCreditPct: number;
  deepCleanWeekday: number;
  items: ServerItem[];
}

interface DraftItem {
  uid: string;
  id: string | null;
  group: ItemGroup;
  title: string;
  description: string;
  weight: number | null;
  isActive: boolean;
  isDefault: boolean;
  defaultWeight: number | null;
  inUse: boolean;
  deleted?: boolean;
}

const RECALC: { value: RecalcOption; label: string }[] = [
  { value: 'none', label: 'الجولات والتقييمات الجديدة فقط (افتراضي)' },
  { value: 'today', label: 'إعادة احتساب نتائج اليوم' },
  { value: 'week', label: 'إعادة احتساب آخر 7 أيام' },
  { value: 'month', label: 'إعادة احتساب آخر 30 يومًا' },
];

const SECTIONS: { group: ItemGroup; title: string; hint?: string }[] = [
  { group: 'supervisor', title: 'معايير تقييم المشرف' },
  { group: 'contractor', title: 'بنود جولة المقاول' },
  { group: 'deep', title: 'بنود التنظيف العميق', hint: 'قائمة تحقق مستقلة لا تدخل في الدرجة — بلا أوزان.' },
];

function toDraft(items: ServerItem[]): DraftItem[] {
  return items.map((i) => ({
    uid: i.id,
    id: i.id,
    group: i.group,
    title: i.title,
    description: i.description ?? '',
    weight: i.weight,
    isActive: i.isActive,
    isDefault: i.isDefault,
    defaultWeight: i.defaultWeight,
    inUse: i.inUse,
  }));
}

export function SettingsView() {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useApi<SettingsData>('/api/admin/settings');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [partial, setPartial] = useState<number>(50);
  const [weekday, setWeekday] = useState<number>(1);
  const [recalc, setRecalc] = useState<RecalcOption>('none');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DraftItem | 'new' | null>(null);
  const [dirty, setDirty] = useState(false);

  // نسخة قابلة للتعديل من الإعدادات المحفوظة، تُعاد تهيئتها عند وصول بيانات جديدة من الخادم
  const [syncedFrom, setSyncedFrom] = useState<SettingsData | null>(null);
  if (data && data !== syncedFrom) {
    setSyncedFrom(data);
    setItems(toDraft(data.items));
    setPartial(data.partialCreditPct);
    setWeekday(data.deepCleanWeekday);
    setDirty(false);
  }

  const live = items.filter((i) => !i.deleted);
  const summary = useMemo(() => summarizeWeights(live.map((i) => ({ group: i.group, weight: i.weight, isActive: i.isActive }))), [live]);
  const partialValid = Number.isFinite(partial) && partial >= 0 && partial <= 100;
  const valid = summary.contractor.valid && summary.supervisor.valid && partialValid;

  function patch(uid: string, p: Partial<DraftItem>) {
    setItems((list) => list.map((i) => (i.uid === uid ? { ...i, ...p } : i)));
    setDirty(true);
  }

  function remove(item: DraftItem) {
    if (item.inUse) {
      toast.show('لا يمكن حذف بند له إجابات أو تقييمات محفوظة؛ يمكنك تعطيله بدلًا من ذلك.', 'error');
      return;
    }
    if (!item.id) setItems((list) => list.filter((i) => i.uid !== item.uid));
    else patch(item.uid, { deleted: true });
    setDirty(true);
  }

  function restoreDefaults() {
    setItems((list) =>
      list.map((i) =>
        i.isDefault ? { ...i, deleted: false, isActive: true, weight: i.group === 'deep' ? null : i.defaultWeight } : { ...i, isActive: false },
      ),
    );
    setPartial(50);
    setDirty(true);
    toast.show('استُعيدت القيم الافتراضية — اضغط «حفظ الإعدادات» لاعتمادها');
  }

  async function save() {
    if (!valid) {
      toast.show(!partialValid ? 'نسبة احتساب «جزئي» بين 0 و100.' : 'مجموع الأوزان يجب أن يساوي 100%', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ message: string; settings: SettingsData }>('/api/admin/settings', {
        method: 'PUT',
        body: {
          partialCreditPct: partial,
          deepCleanWeekday: weekday,
          recalc,
          items: items
            .filter((i) => i.id || !i.deleted)
            .map((i) => ({
              id: i.id,
              group: i.group,
              title: i.title,
              description: i.description || null,
              weight: i.group === 'deep' ? null : i.weight,
              isActive: i.isActive,
              delete: Boolean(i.deleted),
            })),
        },
      });
      toast.show(res.message);
      setData(res.settings);
      setRecalc('none');
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر حفظ الإعدادات.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <>
        <PageHeader title="الإعدادات والأوزان" />
        <Skeleton className="h-[60px] rounded-[14px]" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-[18px]">
          <Skeleton className="h-[420px] rounded-[20px]" />
          <Skeleton className="h-[420px] rounded-[20px]" />
        </div>
      </>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px] text-err-ink" role="alert">
        {error.message}{' '}
        <button type="button" onClick={reload} className="font-bold underline">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="الإعدادات والأوزان"
        actions={
          <button type="button" onClick={() => setEditing('new')} data-testid="add-item" className="touch-target inline-flex items-center gap-1.5 rounded-[11px] bg-ink px-4 py-2.5 text-[14px] font-semibold text-white">
            <IconPlus size={16} /> إضافة بند
          </button>
        }
      />
      <div className="animate-fade-up rounded-[14px] bg-mint-3 px-4 py-3 text-[13.5px] leading-[1.7]">
        <MixedText text="الأوزان تظهر للأدمن فقط. يجب أن يكون مجموع أوزان البنود الفعالة في كل مجموعة محتسبة 100%. مساهمة المعيار = (درجة المعيار ÷ 5) × وزن المعيار — مثال: وزن 18% وتقييم 5 = 18 نقطة، وتقييم 4 = 14.4 نقطة." />
      </div>

      <div className="grid animate-fade-up grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-[18px]">
        {SECTIONS.map((sec) => {
          const scored = ITEM_GROUP_SCORED[sec.group];
          const sum = scored ? summary[sec.group as 'contractor' | 'supervisor'] : null;
          const list = live.filter((i) => i.group === sec.group);
          return (
            <section key={sec.group} className="rounded-[20px] border border-line bg-white p-5" data-testid={`group-${sec.group}`}>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 text-[16px] font-bold">{sec.title}</h2>
                {sum && (
                  <span className="flex items-center gap-1.5">
                    <Chip tone={sum.valid ? 'success' : 'error'} data-testid={`sum-${sec.group}`}>
                      المجموع <bdi dir="ltr">{fmtNum(sum.sum)}%</bdi>
                    </Chip>
                    <span className="text-[12px] text-muted" data-testid={`remaining-${sec.group}`}>
                      المتبقي <bdi dir="ltr">{fmtNum(sum.remaining)}%</bdi>
                    </span>
                  </span>
                )}
              </div>
              {sec.hint && <div className="mb-1 text-[12.5px] text-muted">{sec.hint}</div>}
              {list.length === 0 && <div className="border-t border-divider py-4 text-[13px] text-muted">لا توجد بنود في هذه المجموعة.</div>}
              {list.map((i) => (
                <div key={i.uid} className="flex items-center justify-between gap-3 border-t border-divider py-[9px] text-[13.5px]" data-testid="settings-item">
                  <span className="min-w-0 flex-1">
                    <span className={i.isActive ? '' : 'text-muted line-through decoration-1'}>{i.title}</span>
                    {!i.isActive && (
                      <Chip tone="neutral" size="sm" className="ms-1.5">
                        معطّل
                      </Chip>
                    )}
                    {!i.id && (
                      <Chip tone="warning" size="sm" className="ms-1.5">
                        جديد
                      </Chip>
                    )}
                  </span>
                  <span className="flex flex-none items-center gap-1">
                    {scored && (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          inputMode="decimal"
                          aria-label={`وزن ${i.title}`}
                          value={i.weight ?? ''}
                          disabled={!i.isActive}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value)));
                            patch(i.uid, { weight: v });
                          }}
                          className="tabular h-10 w-16 rounded-[9px] border border-line px-1 text-center text-[14px] outline-ink disabled:bg-page"
                        />
                        %
                      </span>
                    )}
                    <label className="flex h-10 cursor-pointer items-center gap-1 px-1 text-[12px] text-muted" title={i.isActive ? 'تعطيل البند' : 'تفعيل البند'}>
                      <input type="checkbox" checked={i.isActive} onChange={(e) => patch(i.uid, { isActive: e.target.checked })} className="h-4 w-4 accent-[#55957A]" aria-label={`فعّال: ${i.title}`} />
                      فعّال
                    </label>
                    <button type="button" onClick={() => setEditing(i)} aria-label={`تعديل ${i.title}`} className="flex h-10 w-9 items-center justify-center rounded-[9px] text-ink hover:bg-mint-5">
                      <IconEdit size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label={`حذف ${i.title}`}
                      title={i.inUse ? 'له إجابات محفوظة — يمكن تعطيله فقط' : 'حذف البند'}
                      className="flex h-10 w-9 items-center justify-center rounded-[9px] hover:bg-err-bg"
                      style={{ color: i.inUse ? '#A9BBB2' : '#B5512F' }}
                    >
                      <IconTrash size={17} />
                    </button>
                  </span>
                </div>
              ))}
              {sum && !sum.valid && <div className="mt-2 text-[12.5px] text-err-ink">{GROUP_SUM_MESSAGE[sec.group as 'contractor' | 'supervisor']}</div>}
              {sec.group === 'contractor' && (
                <label className="mt-1.5 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13.5px]">
                  <span>
                    احتساب «جزئي» من وزن البند
                    <span className="block text-[12px] text-muted">
                      «تم» = <bdi dir="ltr">100%</bdi> · «لم يتم» = <bdi dir="ltr">0%</bdi>
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={Number.isFinite(partial) ? partial : ''}
                      data-testid="partial-input"
                      onChange={(e) => {
                        setPartial(e.target.value === '' ? NaN : Number(e.target.value));
                        setDirty(true);
                      }}
                      className="tabular h-10 w-16 rounded-[9px] border px-1 text-center text-[14px] outline-ink"
                      style={{ borderColor: partialValid ? '#E3EAE6' : '#E37452' }}
                    />
                    %
                  </span>
                </label>
              )}
            </section>
          );
        })}
      </div>

      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="m-0 mb-1 text-[16px] font-bold">يوم التنظيف العميق</h2>
        <div className="mb-3 text-[13px] text-muted">يكون قسم التنظيف العميق إلزاميًا على مراقب المقاول في هذا اليوم فقط، واختياريًا في بقية الأيام.</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="يوم التنظيف العميق" data-testid="deep-day">
          {WEEKDAY_LABEL.map((d, i) => {
            const on = weekday === i;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setWeekday(i);
                  setDirty(true);
                }}
                className="min-h-10 rounded-[9px] border px-3.5 py-2 text-[13.5px] transition-colors"
                style={{ borderColor: on ? '#2F4F44' : '#E3EAE6', background: on ? '#2F4F44' : '#FFFFFF', color: on ? '#FFFFFF' : '#2F4F44', fontWeight: on ? 600 : 400 }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="m-0 mb-1 text-[16px] font-bold">تطبيق الأوزان على النتائج</h2>
        <div className="mb-3 text-[13px] text-muted">
          تُحفظ نسخة الأوزان مع كل جولة وتقييم. الافتراضي: تُطبَّق الأوزان الجديدة على ما يُرسل بعد الحفظ، ويمكن إعادة احتساب نتائج فترة محددة.
        </div>
        <select value={recalc} onChange={(e) => setRecalc(e.target.value as RecalcOption)} data-testid="recalc-select" className="min-h-11 w-full max-w-[420px] rounded-[11px] border border-line bg-white px-3 text-[13.5px] outline-ink">
          {RECALC.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </section>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="save-settings"
          aria-disabled={!valid}
          className="touch-target flex items-center gap-2 rounded-[11px] px-[22px] py-3 text-[14.5px] font-semibold text-white transition-[transform,background-color] duration-150 hover:-translate-y-px"
          style={{ background: valid ? '#2F4F44' : '#A9BBB2' }}
        >
          {saving && <Spinner />}
          حفظ الإعدادات
        </button>
        <button type="button" onClick={restoreDefaults} data-testid="restore-defaults" className="touch-target rounded-[11px] border border-line bg-white px-[18px] py-3 text-[14px]">
          استعادة الافتراضي
        </button>
        {!valid && <span className="text-[13px] text-err-ink">يجب أن يكون مجموع كل مجموعة 100% للحفظ.</span>}
        {valid && dirty && <span className="text-[13px] text-muted">لديك تغييرات غير محفوظة.</span>}
      </div>

      <ItemDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(it) => {
          if (editing === 'new') setItems((list) => [...list, it]);
          else setItems((list) => list.map((x) => (x.uid === it.uid ? it : x)));
          setDirty(true);
          setEditing(null);
        }}
      />
    </>
  );
}

function ItemDialog({ item, onClose, onSave }: { item: DraftItem | 'new' | null; onClose: () => void; onSave: (i: DraftItem) => void }) {
  const isNew = item === 'new';
  const [evalType, setEvalType] = useState<'contractor_round' | 'supervisor_evaluation'>('contractor_round');
  const [group, setGroup] = useState<ItemGroup>('contractor');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState<string>('0');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // تهيئة الحقول عند فتح النافذة لبند جديد أو بند آخر
  const [openedFor, setOpenedFor] = useState<DraftItem | 'new' | null>(null);
  if (item && item !== openedFor) {
    setOpenedFor(item);
    if (item === 'new') {
      setEvalType('contractor_round');
      setGroup('contractor');
      setTitle('');
      setDescription('');
      setWeight('0');
      setActive(true);
    } else {
      setEvalType(ITEM_GROUP_EVALUATION[item.group]);
      setGroup(item.group);
      setTitle(item.title);
      setDescription(item.description);
      setWeight(item.weight === null ? '' : String(item.weight));
      setActive(item.isActive);
    }
    setErrors({});
  } else if (!item && openedFor) {
    setOpenedFor(null);
  }

  const scored = ITEM_GROUP_SCORED[group];

  function submit() {
    const parsed = settingsItemSchema.safeParse({
      id: isNew ? null : (item as DraftItem).id,
      group,
      title,
      description: description || null,
      weight: scored ? (weight === '' ? null : Number(weight)) : null,
      isActive: active,
    });
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0] ?? '_')] ??= i.message;
    if (scored && (weight === '' || !Number.isFinite(Number(weight)))) errs.weight ??= 'أدخل وزن البند.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const base: DraftItem = isNew
      ? { uid: `new-${crypto.randomUUID()}`, id: null, group, title: '', description: '', weight: null, isActive: true, isDefault: false, defaultWeight: null, inUse: false }
      : (item as DraftItem);
    onSave({ ...base, group, title: title.trim(), description: description.trim(), weight: scored ? Number(weight) : null, isActive: active });
  }

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={isNew ? 'إضافة بند' : 'تعديل بند'} width={480}>
      <div className="flex flex-col gap-3.5 pb-3" data-testid="item-dialog">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-muted">اسم البند</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="item-title" className="min-h-11 rounded-[11px] border border-line px-3 text-[14px] outline-ink" />
          {errors.title && <span className="text-[12px] text-err-ink">{errors.title}</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-muted">الوصف (اختياري)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="min-h-11 rounded-[11px] border border-line px-3 text-[14px] outline-ink" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-muted">نوع التقييم</span>
          <select
            value={evalType}
            disabled={!isNew}
            data-testid="item-eval-type"
            onChange={(e) => {
              const v = e.target.value as typeof evalType;
              setEvalType(v);
              setGroup(v === 'supervisor_evaluation' ? 'supervisor' : 'contractor');
            }}
            className="min-h-11 rounded-[11px] border border-line bg-white px-3 text-[14px] outline-ink disabled:bg-page"
          >
            <option value="contractor_round">{EVALUATION_TYPE_LABEL.contractor_round}</option>
            <option value="supervisor_evaluation">{EVALUATION_TYPE_LABEL.supervisor_evaluation}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-muted">المجموعة</span>
          <select value={group} disabled={!isNew} data-testid="item-group" onChange={(e) => setGroup(e.target.value as ItemGroup)} className="min-h-11 rounded-[11px] border border-line bg-white px-3 text-[14px] outline-ink disabled:bg-page">
            {evalType === 'contractor_round' ? (
              <>
                <option value="contractor">بنود الجولة (محتسبة في الدرجة)</option>
                <option value="deep">التنظيف العميق (قائمة تحقق)</option>
              </>
            ) : (
              <option value="supervisor">بنود تقييم المشرف (محتسبة في الدرجة)</option>
            )}
          </select>
          {!isNew && <span className="text-[12px] text-muted">لا يمكن تغيير مجموعة بند محفوظ حفاظًا على سلامة النتائج التاريخية.</span>}
        </label>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-bold text-muted">نوع البند:</span>
          <Chip tone={scored ? 'success' : 'neutral'}>{scored ? 'محتسب في الدرجة' : 'قائمة تحقق مستقلة (لا تدخل في الدرجة)'}</Chip>
        </div>
        {scored && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-muted">الوزن (%)</span>
            <input type="number" min={0} max={100} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} data-testid="item-weight" className="tabular min-h-11 w-32 rounded-[11px] border border-line px-3 text-[14px] outline-ink" />
            {errors.weight && <span className="text-[12px] text-err-ink">{errors.weight}</span>}
            <span className="text-[12px] text-muted">تأكد أن مجموع أوزان البنود الفعالة في المجموعة يبقى 100% قبل الحفظ.</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[#55957A]" />
          بند فعّال (يظهر في صفحة التقييم)
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={submit} data-testid="item-save" className="touch-target rounded-[11px] bg-ink px-5 py-2.5 text-[14px] font-semibold text-white">
            {isNew ? 'إضافة' : 'تحديث'}
          </button>
          <button type="button" onClick={onClose} className="touch-target rounded-[11px] border border-line bg-white px-5 py-2.5 text-[14px]">
            إلغاء
          </button>
        </div>
      </div>
    </Modal>
  );
}
