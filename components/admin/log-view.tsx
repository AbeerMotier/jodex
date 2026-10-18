'use client';
import { useState } from 'react';
import { Chip, RoleChip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { usePaged } from '@/lib/client/use-paged';
import { PERIOD_LABEL } from '@/lib/domain/catalog';
import { dayLabel, fmtPct, timeHM } from '@/lib/domain/format';
import type { Period } from '@/lib/domain/time';
import { DetailDrawer } from './detail-drawer';
import type { EntryView } from './entry';
import { useFilterOptions, useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { ActiveFilters, PageHeader } from './page-header';
import { FilterGroup, Segmented, SelectField, Toolbar } from './toolbar';

const STATUS_OPTIONS = [
  { value: 'full', label: 'ملتزم تمامًا' },
  { value: 'behind', label: 'متأخر عن الخطة' },
  { value: 'non', label: 'غير ملتزم بالخطة' },
  { value: 'missed', label: 'فائتة' },
  { value: 'pending', label: 'لم تُرسل بعد' },
  { value: 'urgent', label: 'تقييم مشرف يحتاج معالجة فورية' },
];
const KIND_OPTIONS = [
  { value: 'round', label: 'جولات مراقبي المقاول' },
  { value: 'supervisor', label: 'تقييمات المشرفين الميدانيين' },
];
const PERIODS: Period[] = ['today', 'week', 'month'];
const GRID = 'grid grid-cols-[104px_62px_minmax(160px,1.3fr)_104px_86px_minmax(118px,1fr)_92px_56px_136px] gap-2.5';
const KEYS = ['kind', 'building', 'floor', 'restroom', 'status', 'employee'];

export function LogView() {
  const f = useUrlFilters();
  const options = useFilterOptions();
  const apiQuery = f.query(KEYS);
  const { rows, total, hasMore, loading, loadingMore, error, more, reload } = usePaged<EntryView>(`/api/admin/log?${apiQuery}`);
  const [detail, setDetail] = useState<{ kind: 'round' | 'supervisor'; id: string } | null>(null);

  const employees = [
    ...(options?.monitors ?? []).map((m) => ({ value: m.id, label: `${m.name} · ${m.kind === 'substitute' ? 'مراقب نائب' : 'مراقب المقاول'}` })),
    ...(options?.supervisors ?? []).map((s) => ({ value: s.id, label: `${s.name} · المشرف الميداني` })),
  ];
  const activeLabels = [
    f.get('kind') && KIND_OPTIONS.find((k) => k.value === f.get('kind'))?.label,
    f.get('building') && options?.buildings.find((b) => b.id === f.get('building'))?.name,
    f.get('floor'),
    f.get('restroom') && (() => {
      const r = options?.restrooms.find((x) => x.id === f.get('restroom'));
      return r ? `${r.name} · ${r.floor}` : '';
    })(),
    f.get('status') && STATUS_OPTIONS.find((s) => s.value === f.get('status'))?.label,
    f.get('employee') && employees.find((e) => e.value === f.get('employee'))?.label.split(' · ')[0],
  ].filter(Boolean) as string[];

  const filters = (
    <>
      <FilterGroup label="الفترة الزمنية">
        <Segmented testId="period-filter" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={f.period} onChange={(v) => f.set({ period: v })} />
      </FilterGroup>
      <SelectField label="نوع السجل" testId="filter-kind" value={f.get('kind')} onChange={(v) => f.set({ kind: v, status: v === 'supervisor' && f.get('status') !== 'urgent' ? null : f.get('status') })} options={KIND_OPTIONS} placeholder="كل السجلات" />
      <LocationFilters building={f.get('building')} floor={f.get('floor')} restroom={f.get('restroom')} onChange={(p) => f.set(p)} />
      <SelectField label="حالة الجولة" testId="filter-status" value={f.get('status')} onChange={(v) => f.set({ status: v })} options={STATUS_OPTIONS} placeholder="كل الحالات" />
      <SelectField label="الموظف" testId="filter-employee" value={f.get('employee')} onChange={(v) => f.set({ employee: v })} options={employees} placeholder="كل الموظفين" />
    </>
  );

  return (
    <>
      <PageHeader
        title="سجل الجولات"
        sub={`${PERIOD_LABEL[f.period]} · جولات مراقبي المقاول وتقييمات المشرفين الميدانيين`}
        actions={<Toolbar filters={filters} activeCount={activeLabels.length} exportUrl={(format) => `/api/admin/export?report=log&format=${format}&${apiQuery}`} exportName="jodex-rounds-log" />}
      />
      <ActiveFilters items={activeLabels} onClear={() => f.set({ kind: null, building: null, floor: null, restroom: null, status: null, employee: null })} />

      <section className="min-w-0 animate-fade-up rounded-[20px] border border-line bg-white py-2" data-testid="log-table">
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div className={`${GRID} px-5 py-3 text-[12px] font-semibold text-muted`} role="row">
              <span>التاريخ والوقت</span>
              <span>نوع الجولة</span>
              <span>الموظف</span>
              <span>المبنى</span>
              <span>الدور</span>
              <span>دورة المياه</span>
              <span>نوع التقييم</span>
              <span>النتيجة</span>
              <span>الحالة</span>
            </div>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border-t border-divider px-5 py-3">
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            {!loading && error && (
              <div className="border-t border-divider px-5 py-8 text-center text-[13.5px] text-err-ink" role="alert">
                {error.message}{' '}
                <button type="button" onClick={reload} className="font-bold underline">
                  إعادة المحاولة
                </button>
              </div>
            )}
            {!loading && !error && rows.length === 0 && <div className="border-t border-divider px-5 py-10 text-center text-[13.5px] text-muted">لا توجد سجلات مطابقة في هذه الفترة.</div>}
            {!loading &&
              rows.map((r) => (
                <button
                  key={`${r.kind}-${r.id}`}
                  type="button"
                  onClick={() => setDetail({ kind: r.kind, id: r.id })}
                  data-testid="log-row"
                  data-kind={r.kind}
                  className={`${GRID} w-full cursor-pointer items-center border-t border-divider bg-transparent px-5 py-[11px] text-right text-[13.5px] transition-colors hover:bg-[#F6F9F7]`}
                >
                  <span>
                    <span className="block">{dayLabel(r.date)}</span>
                    <span className="tabular text-[12px] text-muted">{r.time ? timeHM(r.time) : '—'}</span>
                  </span>
                  <span>{r.typeLabel}</span>
                  <span className="flex flex-col items-start gap-[3px]">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{r.employee.name}</span>
                      <RoleChip role={r.employee.role} />
                    </span>
                    {r.onBehalfOf && <span className="text-[12px] text-ink-2">بالنيابة عن {r.onBehalfOf}</span>}
                  </span>
                  <span>{r.restroom.building}</span>
                  <span>{r.restroom.floor}</span>
                  <span>{r.restroom.name}</span>
                  <span className="text-muted">{r.evalType}</span>
                  <span className="tabular font-semibold">{fmtPct(r.result)}</span>
                  <span className="flex flex-wrap gap-1">
                    <Chip tone={r.status.tone}>{r.status.label}</Chip>
                    {r.urgent && <Chip tone="error">معالجة فورية</Chip>}
                  </span>
                </button>
              ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-divider px-5 pt-3 pb-1.5 text-[13px] text-muted">
          <span data-testid="log-count">
            يعرض {rows.length} من {total} سجلًا · اضغط على أي سجل لعرض تفاصيله
          </span>
          {hasMore && (
            <button type="button" onClick={more} disabled={loadingMore} data-testid="load-more" className="touch-target rounded-[9px] border border-line bg-white px-3.5 py-[7px] text-[13px] hover:border-[#8FB8A2]">
              {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد'}
            </button>
          )}
        </div>
      </section>
      <DetailDrawer target={detail} onClose={() => setDetail(null)} />
    </>
  );
}
