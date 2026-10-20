'use client';
import { useState } from 'react';
import { Chip, RoleChip } from '@/components/ui/chip';
import { Lightbox } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { usePaged } from '@/lib/client/use-paged';
import { PERIOD_LABEL, SEVERITY_LABEL } from '@/lib/domain/catalog';
import { instantDayLabel, timeHM } from '@/lib/domain/format';
import type { NoteSeverity } from '@/lib/domain/scoring';
import type { Period } from '@/lib/domain/time';
import { useFilterOptions, useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { ActiveFilters, PageHeader } from './page-header';
import { FilterGroup, Segmented, SelectField, Toolbar } from './toolbar';

interface Row {
  id: string;
  text: string;
  severity: NoteSeverity;
  createdAt: string;
  supervisor: string;
  restroom: { code: string; name: string; floor: string; building: string };
  photos: string[];
}

const PERIODS: Period[] = ['today', 'week', 'month'];
const SEVERITY_TONE = { high: 'error', mid: 'warning', low: 'success' } as const;

/** ملاحظات المشرفين الميدانيين — للاطلاع فقط (سير عمل الإجراءات التصحيحية غير معرّف بعد) */
export function NotesView() {
  const f = useUrlFilters();
  const options = useFilterOptions();
  const apiQuery = f.query(['building', 'floor', 'restroom', 'supervisor', 'severity']);
  const { rows, total, hasMore, loading, loadingMore, error, more, reload } = usePaged<Row>(`/api/admin/notes?${apiQuery}`);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const active = [
    f.get('building') && options?.buildings.find((b) => b.id === f.get('building'))?.name,
    f.get('floor'),
    f.get('restroom') && options?.restrooms.find((r) => r.id === f.get('restroom'))?.name,
    f.get('supervisor') && options?.supervisors.find((s) => s.id === f.get('supervisor'))?.name,
    f.get('severity') && SEVERITY_LABEL[f.get('severity') as NoteSeverity],
  ].filter(Boolean) as string[];

  const filters = (
    <>
      <FilterGroup label="الفترة الزمنية">
        <Segmented testId="period-filter" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={f.period} onChange={(v) => f.set({ period: v })} />
      </FilterGroup>
      <LocationFilters building={f.get('building')} floor={f.get('floor')} restroom={f.get('restroom')} onChange={(p) => f.set(p)} />
      <SelectField
        label="المشرف الميداني"
        testId="filter-supervisor"
        value={f.get('supervisor')}
        onChange={(v) => f.set({ supervisor: v })}
        options={(options?.supervisors ?? []).map((s) => ({ value: s.id, label: s.name }))}
        placeholder="كل المشرفين"
      />
      <SelectField
        label="الأهمية"
        testId="filter-severity"
        value={f.get('severity')}
        onChange={(v) => f.set({ severity: v })}
        options={(['high', 'mid', 'low'] as NoteSeverity[]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))}
        placeholder="كل المستويات"
      />
    </>
  );

  return (
    <>
      <PageHeader
        title="الملاحظات والإجراءات"
        sub={`${PERIOD_LABEL[f.period]} · ملاحظات المشرفين الميدانيين للاطلاع`}
        actions={<Toolbar filters={filters} activeCount={active.length} exportUrl={(format) => `/api/admin/export?report=notes&format=${format}&${apiQuery}`} exportName="jodex-notes" />}
      />
      <ActiveFilters items={active} onClear={() => f.set({ building: null, floor: null, restroom: null, supervisor: null, severity: null })} />
      <div className="flex flex-col gap-3" data-testid="notes-list">
        {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[98px] rounded-[18px]" />)}
        {!loading && error && (
          <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px] text-err-ink" role="alert">
            {error.message}{' '}
            <button type="button" onClick={reload} className="font-bold underline">
              إعادة المحاولة
            </button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px] text-muted">لا توجد ملاحظات من المشرفين الميدانيين في هذه الفترة.</div>
        )}
        {!loading &&
          rows.map((n) => (
            <article key={n.id} className="flex animate-fade-up flex-wrap items-center gap-x-5 gap-y-3.5 rounded-[18px] border border-line bg-white px-[18px] py-4" data-testid="note-card">
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold">{n.text}</span>
                  <Chip tone={SEVERITY_TONE[n.severity]} size="sm">
                    {SEVERITY_LABEL[n.severity]}
                  </Chip>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                  <span>
                    <span className="text-ink-2">دورة المياه:</span> {n.restroom.name} · {n.restroom.floor} · {n.restroom.building}
                  </span>
                  <span>
                    <span className="text-ink-2">ترميز دورة المياه:</span>{' '}
                    <span dir="ltr" className="tabular font-semibold text-ink" data-testid="note-code">
                      {n.restroom.code}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                  <RoleChip role="supervisor" />
                  <b className="text-ink">{n.supervisor}</b> · {instantDayLabel(n.createdAt)} · <span className="tabular">{timeHM(n.createdAt)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {n.photos.length > 0 ? (
                  n.photos.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightbox(url)}
                      aria-label={`صورة ${i + 1}`}
                      className="h-[66px] w-[88px] cursor-zoom-in overflow-hidden rounded-[11px] border border-line bg-page bg-cover bg-center p-0 transition-transform hover:scale-[1.04]"
                      style={{ backgroundImage: `url("${url}")` }}
                    />
                  ))
                ) : (
                  <span className="text-[12px] text-muted">بدون صور مرفقة</span>
                )}
              </div>
            </article>
          ))}
        {!loading && rows.length > 0 && (
          <div className="flex items-center justify-between px-1 text-[13px] text-muted">
            <span>
              يعرض {rows.length} من {total} ملاحظة
            </span>
            {hasMore && (
              <button type="button" onClick={more} disabled={loadingMore} className="touch-target rounded-[9px] border border-line bg-white px-3.5 py-[7px] text-[13px] hover:border-[#8FB8A2]">
                {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد'}
              </button>
            )}
          </div>
        )}
      </div>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} alt="صورة الملاحظة" />
    </>
  );
}
