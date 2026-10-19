'use client';
import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { IconEdit, IconPlus } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApi } from '@/lib/client/use-api';
import { buildingSchema, restroomSchema } from '@/lib/domain/validation';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, DialogActions, Field, INPUT } from './manage-ui';
import { PageHeader } from './page-header';

interface Building {
  id: string;
  name: string;
  restroomCount: number;
}
interface Room {
  id: string;
  code: string;
  name: string;
  floor: string;
  buildingId: string;
  monitorId: string | null;
  monitorName: string | null;
  supervisors: number;
  hasQr: boolean;
  isActive: boolean;
}
interface Monitor {
  id: string;
  name: string;
  username: string;
  isActive: boolean;
}
interface PlacesData {
  buildings: Building[];
  restrooms: Room[];
  monitors: Monitor[];
}

const errorText = (e: unknown) => (e instanceof ApiClientError ? e.message : 'تعذّر الحفظ. حاول مرة أخرى.');

export function PlacesView() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<PlacesData>('/api/admin/restrooms');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [q, setQ] = useState('');
  const [editingRoom, setEditingRoom] = useState<Room | 'new' | null>(null);
  const [editingBuilding, setEditingBuilding] = useState<Building | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const activeMonitors = (data?.monitors ?? []).filter((m) => m.isActive);

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.buildings
      .filter((b) => !buildingFilter || b.id === buildingFilter)
      .map((b) => ({
        building: b,
        rooms: data.restrooms.filter(
          (r) => r.buildingId === b.id && (!term || r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term) || r.floor.toLowerCase().includes(term)),
        ),
      }));
  }, [data, buildingFilter, q]);

  async function assign(ids: string[], monitorId: string | null, key: string) {
    if (!ids.length) return;
    setBusy(key);
    try {
      const res = await api<{ count: number }>('/api/admin/restrooms/assign', { method: 'POST', body: { restroomIds: ids, monitorId } });
      toast.show(monitorId ? `أُسندت ${res.count} دورة مياه` : `أُلغي إسناد ${res.count} دورة مياه`, 'success');
      reload();
    } catch (e) {
      toast.show(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const unassigned = (data?.restrooms ?? []).filter((r) => r.isActive && !r.monitorId).length;

  return (
    <>
      <PageHeader
        title="المباني ودورات المياه"
        sub="الترميز والمبنى والدور، والمراقب المسؤول عن كل دورة مياه"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setEditingBuilding('new')} data-testid="building-add">
              <IconPlus size={16} /> إضافة مبنى
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => setEditingRoom('new')} disabled={!data?.buildings.length} data-testid="restroom-add">
              <IconPlus size={16} /> إضافة دورة مياه
            </button>
          </div>
        }
      />

      <div className="flex animate-fade-up flex-wrap items-center gap-2">
        <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)} className={INPUT} aria-label="المبنى">
          <option value="">كل المباني</option>
          {(data?.buildings ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالترميز أو الاسم أو الدور" className={`${INPUT} min-w-[220px]`} />
        {unassigned > 0 && (
          <Chip tone="warning" size="md" dot>
            {unassigned} دورة مياه نشطة بلا مراقب مسؤول
          </Chip>
        )}
      </div>

      {error && !data && (
        <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px]">
          {error.message}{' '}
          <button type="button" onClick={reload} className="font-semibold underline">
            إعادة المحاولة
          </button>
        </div>
      )}
      {loading && !data && <Skeleton className="h-[360px] rounded-[18px]" />}
      {data && data.buildings.length === 0 && (
        <div className="rounded-[18px] border border-line bg-white p-8 text-center text-[13.5px] text-muted">لا توجد مبانٍ بعد. ابدأ بإضافة مبنى.</div>
      )}

      {groups.map(({ building, rooms }) => (
        <BuildingSection
          key={building.id}
          building={building}
          rooms={rooms}
          monitors={activeMonitors}
          busy={busy}
          onRename={() => setEditingBuilding(building)}
          onEditRoom={(r) => setEditingRoom(r)}
          onAssign={assign}
        />
      ))}

      {data && (
        <RestroomDialog
          target={editingRoom}
          buildings={data.buildings}
          monitors={activeMonitors}
          defaultBuildingId={buildingFilter || data.buildings[0]?.id || ''}
          onClose={() => setEditingRoom(null)}
          onSaved={(created) => {
            setEditingRoom(null);
            reload();
            toast.show(created ? 'أُضيفت دورة المياه مع رمز QR' : 'تم حفظ التعديلات', 'success');
          }}
        />
      )}
      <BuildingDialog
        target={editingBuilding}
        onClose={() => setEditingBuilding(null)}
        onSaved={() => {
          setEditingBuilding(null);
          reload();
          toast.show('تم حفظ المبنى', 'success');
        }}
      />
    </>
  );
}

function BuildingSection({
  building,
  rooms,
  monitors,
  busy,
  onRename,
  onEditRoom,
  onAssign,
}: {
  building: Building;
  rooms: Room[];
  monitors: Monitor[];
  busy: string | null;
  onRename: () => void;
  onEditRoom: (r: Room) => void;
  onAssign: (ids: string[], monitorId: string | null, key: string) => void;
}) {
  const [bulk, setBulk] = useState('');
  const bulkKey = `bulk-${building.id}`;
  const owners = [...new Set(rooms.filter((r) => r.monitorName).map((r) => r.monitorName))];

  return (
    <section className="animate-fade-up overflow-hidden rounded-[18px] border border-line bg-white" data-testid={`building-${building.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-[#F6F9F7] px-[18px] py-3">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 text-[16px] font-bold text-ink">
            {building.name}
            <button type="button" onClick={onRename} aria-label={`تعديل اسم ${building.name}`} className="text-muted hover:text-ink">
              <IconEdit size={15} />
            </button>
          </span>
          <span className="text-[12.5px] text-muted">
            {building.restroomCount} دورة مياه{owners.length ? ` · المراقب: ${owners.join('، ')}` : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={bulk} onChange={(e) => setBulk(e.target.value)} className={`${INPUT} min-h-9 text-[13px]`} aria-label="إسناد كل دورات المبنى" data-testid={`bulk-monitor-${building.name}`}>
            <option value="">إسناد كل دورات المبنى إلى…</option>
            {monitors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={BTN_SMALL}
            disabled={!bulk || busy === bulkKey || rooms.length === 0}
            onClick={() => {
              const m = monitors.find((x) => x.id === bulk);
              if (m && window.confirm(`إسناد ${rooms.length} دورة مياه في «${building.name}» إلى ${m.name}؟`)) {
                onAssign(rooms.map((r) => r.id), bulk, bulkKey);
                setBulk('');
              }
            }}
            data-testid={`bulk-apply-${building.name}`}
          >
            {busy === bulkKey && <Spinner size={12} />}
            تطبيق
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(170px,1.1fr)_minmax(0,1.2fr)_minmax(200px,1.2fr)_70px_80px_80px] gap-3 px-[18px] py-2.5 text-[12px] font-semibold text-ink-2">
            <span>الترميز</span>
            <span>دورة المياه</span>
            <span>المراقب المسؤول</span>
            <span className="text-center">المشرفون</span>
            <span>الحالة</span>
            <span />
          </div>
          {rooms.length === 0 && <div className="border-t border-divider px-5 py-6 text-center text-[13px] text-muted">لا توجد دورات مياه مطابقة.</div>}
          {rooms.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(170px,1.1fr)_minmax(0,1.2fr)_minmax(200px,1.2fr)_70px_80px_80px] items-center gap-3 border-t border-divider px-[18px] py-2.5 text-[13px]"
              style={r.isActive ? undefined : { opacity: 0.6 }}
              data-testid={`room-row-${r.code}`}
            >
              <span dir="ltr" className="tabular text-right text-[12.5px] font-semibold">
                {r.code}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink">{r.name}</span>
                <span className="text-[12px] text-muted">{r.floor}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <select
                  value={r.monitorId ?? ''}
                  disabled={busy === r.id}
                  onChange={(e) => onAssign([r.id], e.target.value || null, r.id)}
                  className={`${INPUT} min-h-9 w-full text-[13px]`}
                  aria-label={`المراقب المسؤول عن ${r.code}`}
                  data-testid={`room-monitor-${r.code}`}
                  style={r.isActive && !r.monitorId ? { borderColor: '#E3C068', background: '#FFFBF0' } : undefined}
                >
                  <option value="">— بلا مراقب —</option>
                  {r.monitorId && !monitors.some((m) => m.id === r.monitorId) && <option value={r.monitorId}>{r.monitorName ?? 'مراقب معطّل'}</option>}
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {busy === r.id && <Spinner size={12} />}
              </span>
              <span className="tabular text-center">{r.supervisors}</span>
              <span>
                <Chip tone={r.isActive ? 'success' : 'error'} size="sm" dot>
                  {r.isActive ? 'نشطة' : 'معطّلة'}
                </Chip>
              </span>
              <span>
                <button type="button" className={BTN_SMALL} onClick={() => onEditRoom(r)} data-testid={`room-edit-${r.code}`}>
                  <IconEdit size={14} /> تعديل
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RestroomDialog({
  target,
  buildings,
  monitors,
  defaultBuildingId,
  onClose,
  onSaved,
}: {
  target: Room | 'new' | null;
  buildings: Building[];
  monitors: Monitor[];
  defaultBuildingId: string;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const isNew = target === 'new';
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [monitorId, setMonitorId] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [openedFor, setOpenedFor] = useState<Room | 'new' | null>(null);
  if (target && target !== openedFor) {
    setOpenedFor(target);
    setErrors({});
    if (target === 'new') {
      setCode('');
      setName('');
      setFloor('');
      setBuildingId(defaultBuildingId);
      setMonitorId('');
      setActive(true);
    } else {
      setCode(target.code);
      setName(target.name);
      setFloor(target.floor);
      setBuildingId(target.buildingId);
      setMonitorId(target.monitorId ?? '');
      setActive(target.isActive);
    }
  } else if (!target && openedFor) {
    setOpenedFor(null);
  }

  async function submit() {
    const payload = { code, name, floor, buildingId, monitorId: monitorId || null, isActive: active };
    const parsed = restroomSchema.safeParse(payload);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? '_')] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (isNew) await api('/api/admin/restrooms', { method: 'POST', body: parsed.data });
      else await api(`/api/admin/restrooms/${(target as Room).id}`, { method: 'PATCH', body: parsed.data });
      onSaved(isNew);
    } catch (e) {
      if (e instanceof ApiClientError) setErrors({ ...(e.fields ?? {}), _: e.message });
      else setErrors({ _: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={isNew ? 'إضافة دورة مياه' : 'تعديل دورة مياه'} width={480}>
      <div className="flex flex-col gap-3.5" data-testid="restroom-dialog">
        <Field label="الترميز" error={errors.code} hint="مثل 100-HMR-HQ1003-00-0001 (حروف إنجليزية كبيرة وأرقام و -)">
          <input dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} className={`${INPUT} text-left`} data-testid="restroom-code" />
        </Field>
        <Field label="اسم دورة المياه" error={errors.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="دورة مياه رقم 1 رجال" className={INPUT} data-testid="restroom-name" />
        </Field>
        <Field label="الدور" error={errors.floor}>
          <input value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={60} placeholder="الدور الأرضي" className={INPUT} data-testid="restroom-floor" />
        </Field>
        <Field label="المبنى" error={errors.buildingId}>
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} className={INPUT} data-testid="restroom-building">
            <option value="">— اختر المبنى —</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="المراقب المسؤول (مقاول)" error={errors.monitorId} hint="يمكن تركه فارغًا وإسناده لاحقًا. الجولات تُنشأ لدورات المياه التي لها مراقب.">
          <select value={monitorId} onChange={(e) => setMonitorId(e.target.value)} className={INPUT} data-testid="restroom-monitor">
            <option value="">— بلا مراقب —</option>
            {monitors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[#55957A]" />
          دورة مياه نشطة (تظهر في الجولات والتقييمات ورموز QR)
        </label>
        {errors._ && <div className="rounded-[10px] bg-[#FCEDE7] px-3 py-2 text-[13px] text-err-ink">{errors._}</div>}
        <DialogActions busy={busy} submitLabel={isNew ? 'إضافة' : 'حفظ'} onSubmit={submit} onClose={onClose} testId="restroom-save" />
        {target && target !== 'new' && (
          <DeleteButton
            label="حذف دورة المياه"
            confirmText={`حذف دورة المياه ${code} نهائيًا مع رمز QR الخاص بها؟`}
            path={`/api/admin/restrooms/${target.id}`}
            onDeleted={() => onSaved(false)}
            onError={(m) => setErrors({ _: m })}
          />
        )}
      </div>
    </Modal>
  );
}

function BuildingDialog({ target, onClose, onSaved }: { target: Building | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new';
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState<Building | 'new' | null>(null);
  if (target && target !== openedFor) {
    setOpenedFor(target);
    setError('');
    setName(target === 'new' ? '' : target.name);
  } else if (!target && openedFor) {
    setOpenedFor(null);
  }

  async function submit() {
    const parsed = buildingSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'اسم غير صالح.');
      return;
    }
    setBusy(true);
    try {
      if (isNew) await api('/api/admin/buildings', { method: 'POST', body: parsed.data });
      else await api(`/api/admin/buildings/${(target as Building).id}`, { method: 'PATCH', body: parsed.data });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={isNew ? 'إضافة مبنى' : 'تعديل اسم المبنى'} width={420}>
      <div className="flex flex-col gap-3.5" data-testid="building-dialog">
        <Field label="اسم المبنى" error={error}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="المبنى رقم 9" className={INPUT} data-testid="building-name" />
        </Field>
        <DialogActions busy={busy} submitLabel={isNew ? 'إضافة' : 'حفظ'} onSubmit={submit} onClose={onClose} testId="building-save" />
        {target && target !== 'new' && (
          <DeleteButton
            label="حذف المبنى"
            confirmText={`حذف «${name}»؟ يجب أن يكون المبنى بلا دورات مياه.`}
            path={`/api/admin/buildings/${target.id}`}
            onDeleted={onSaved}
            onError={setError}
          />
        )}
      </div>
    </Modal>
  );
}

function DeleteButton({ label, confirmText, path, onDeleted, onError }: { label: string; confirmText: string; path: string; onDeleted: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="-mt-1 border-t border-divider pt-3 pb-3">
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-err-ink underline-offset-2 hover:underline disabled:opacity-60"
        data-testid="delete-button"
        onClick={async () => {
          if (!window.confirm(confirmText)) return;
          setBusy(true);
          try {
            await api(path, { method: 'DELETE' });
            onDeleted();
          } catch (e) {
            onError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner size={12} />}
        {label}
      </button>
      <div className="mt-1 text-[12px] text-muted">الحذف متاح لما لا سجل له؛ ما له جولات أو تقييمات يُعطَّل بدلًا من حذفه.</div>
    </div>
  );
}
