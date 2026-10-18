'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/overlay';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';

export const INPUT = 'min-h-11 rounded-[11px] border border-line bg-white px-3 text-[14px] outline-ink disabled:bg-page';
export const BTN_PRIMARY = 'touch-target inline-flex items-center justify-center gap-2 rounded-[11px] bg-ink px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60';
export const BTN_SECONDARY = 'touch-target inline-flex items-center justify-center gap-2 rounded-[11px] border border-line bg-white px-4 py-2.5 text-[13.5px] font-semibold text-ink disabled:opacity-60';
export const BTN_SMALL = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-[#F6F9F7] disabled:opacity-50';

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-muted">{label}</span>
      {children}
      {error && <span className="text-[12px] text-err-ink">{error}</span>}
      {hint && !error && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function DialogActions({ busy, submitLabel, onSubmit, onClose, testId }: { busy: boolean; submitLabel: string; onSubmit: () => void; onClose: () => void; testId?: string }) {
  return (
    <div className="flex gap-2 pt-1 pb-3">
      <button type="button" onClick={onSubmit} disabled={busy} className={BTN_PRIMARY} data-testid={testId}>
        {busy && <Spinner />}
        {submitLabel}
      </button>
      <button type="button" onClick={onClose} className={BTN_SECONDARY}>
        إلغاء
      </button>
    </div>
  );
}

/** عرض كلمة مرور جديدة مرة واحدة مع نسخها */
export function PasswordDialog({ value, onClose }: { value: { title: string; username: string; password: string } | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal open={Boolean(value)} onClose={onClose} title={value?.title ?? ''} width={440}>
      {value && (
        <div className="flex flex-col gap-3 pb-3" data-testid="password-dialog">
          <div className="rounded-[12px] bg-[#FBF4E1] px-3 py-2.5 text-[13px] leading-[1.7] text-[#7A5B14]">
            انسخ كلمة المرور وسلّمها للموظف الآن. <b>لن تظهر مرة أخرى</b>، ويمكنك إنشاء كلمة جديدة في أي وقت.
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-[14px]">
            <span className="text-muted">اسم المستخدم</span>
            <b dir="ltr" className="tabular text-left" data-testid="new-username">
              {value.username}
            </b>
            <span className="text-muted">كلمة المرور</span>
            <b dir="ltr" className="tabular rounded-[8px] bg-[#F6F9F7] px-2 py-1 text-left text-[15px]" data-testid="new-password">
              {value.password}
            </b>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() =>
                navigator.clipboard
                  ?.writeText(`اسم المستخدم: ${value.username}\nكلمة المرور: ${value.password}`)
                  .then(() => toast.show('نُسخت بيانات الدخول', 'success'))
                  .catch(() => toast.show('تعذّر النسخ، انسخها يدويًا', 'error'))
              }
            >
              نسخ
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onClose}>
              تم
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export interface PickRoom {
  id: string;
  code: string;
  name: string;
  floor: string;
  buildingId: string;
  isActive: boolean;
  /** ملاحظة بجانب الدورة (مثل المسؤول الحالي) */
  note?: string | null;
}

/** اختيار دورات مياه متعددة مجمّعة حسب المبنى، مع «تحديد الكل» لكل مبنى وبحث */
export function RestroomChecklist({
  rooms,
  buildings,
  selected,
  onChange,
}: {
  rooms: PickRoom[];
  buildings: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return buildings
      .map((b) => ({
        building: b,
        rooms: rooms.filter(
          (r) =>
            r.buildingId === b.id &&
            (!term || r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term) || r.floor.toLowerCase().includes(term)),
        ),
      }))
      .filter((g) => g.rooms.length > 0);
  }, [rooms, buildings, q]);

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="restroom-checklist">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالترميز أو الاسم أو الدور" className={INPUT} />
      <div className="text-[12.5px] text-muted">
        المحدد: <b className="tabular text-ink">{selected.size}</b>
      </div>
      <div className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto pe-1">
        {groups.length === 0 && <div className="py-6 text-center text-[13px] text-muted">لا توجد دورات مياه مطابقة.</div>}
        {groups.map(({ building, rooms: list }) => {
          const all = list.every((r) => selected.has(r.id));
          return (
            <div key={building.id} className="rounded-[12px] border border-line">
              <label className="flex cursor-pointer items-center justify-between gap-2 border-b border-divider bg-[#F6F9F7] px-3 py-2 text-[13.5px] font-bold">
                <span>
                  {building.name} <span className="tabular font-normal text-muted">({list.length})</span>
                </span>
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
                  تحديد الكل
                  <input type="checkbox" checked={all} onChange={(e) => toggle(list.map((r) => r.id), e.target.checked)} className="h-4 w-4 accent-[#55957A]" />
                </span>
              </label>
              {list.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-3 py-2 text-[13px] last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={(e) => toggle([r.id], e.target.checked)}
                    className="h-4 w-4 flex-none accent-[#55957A]"
                    data-testid={`pick-${r.code}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-ink">
                      {r.name} · {r.floor}
                      {!r.isActive && <span className="ms-1.5 text-[11.5px] font-normal text-err-ink">(غير نشطة)</span>}
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                      <span dir="ltr" className="tabular">
                        {r.code}
                      </span>
                      {r.note && <span>{r.note}</span>}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
