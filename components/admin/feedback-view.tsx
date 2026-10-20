'use client';
import { Face } from '@/components/ui/face';
import { Skeleton } from '@/components/ui/skeleton';
import { usePaged } from '@/lib/client/use-paged';
import { FEEDBACK_RATING_LABEL, PERIOD_LABEL, type FeedbackRating } from '@/lib/domain/catalog';
import { instantDayLabel, timeHM } from '@/lib/domain/format';
import type { Period } from '@/lib/domain/time';
import { useFilterOptions, useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { ActiveFilters, PageHeader } from './page-header';
import { FilterGroup, Segmented, SelectField, Toolbar } from './toolbar';

interface Row {
  id: string;
  restroom: { code: string; name: string; floor: string; building: string };
  submittedAt: string;
  rating: FeedbackRating;
  reasons: string[];
}

const PERIODS: Period[] = ['today', 'week', 'month'];
const RATINGS: FeedbackRating[] = ['excellent', 'good', 'bad'];
const GRID = 'grid grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_150px_120px_minmax(160px,1.3fr)] gap-3';

export function FeedbackView() {
  const f = useUrlFilters();
  const options = useFilterOptions();
  const apiQuery = f.query(['building', 'floor', 'restroom', 'rating']);
  const { rows, total, hasMore, loading, loadingMore, error, more, reload } = usePaged<Row>(`/api/admin/feedback?${apiQuery}`);

  const active = [
    f.get('building') && options?.buildings.find((b) => b.id === f.get('building'))?.name,
    f.get('floor'),
    f.get('restroom') && options?.restrooms.find((r) => r.id === f.get('restroom'))?.code,
    f.get('rating') && FEEDBACK_RATING_LABEL[f.get('rating') as FeedbackRating],
  ].filter(Boolean) as string[];

  const filters = (
    <>
      <FilterGroup label="الفترة الزمنية">
        <Segmented testId="period-filter" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={f.period} onChange={(v) => f.set({ period: v })} />
      </FilterGroup>
      <LocationFilters building={f.get('building')} floor={f.get('floor')} restroom={f.get('restroom')} onChange={(p) => f.set(p)} />
      <SelectField label="رضا المستفيد" testId="filter-rating" value={f.get('rating')} onChange={(v) => f.set({ rating: v })} options={RATINGS.map((r) => ({ value: r, label: FEEDBACK_RATING_LABEL[r] }))} placeholder="كل التقييمات" />
    </>
  );

  return (
    <>
      <PageHeader
        title="تقييمات المستفيدين"
        sub={PERIOD_LABEL[f.period]}
        actions={<Toolbar filters={filters} activeCount={active.length} exportUrl={(format) => `/api/admin/export?report=feedback&format=${format}&${apiQuery}`} exportName="jodex-beneficiary-feedback" />}
      />
      <ActiveFilters items={active} onClear={() => f.set({ building: null, floor: null, restroom: null, rating: null })} />
      <section className="min-w-0 animate-fade-up rounded-[20px] border border-line bg-white py-2" data-testid="feedback-table">
        <div className="overflow-x-auto">
          <div className="min-w-[830px]">
            <div className={`${GRID} px-5 py-3 text-[12px] font-semibold text-muted`}>
              <span>دورة المياه</span>
              <span>ترميز دورة المياه</span>
              <span>تاريخ ووقت الإرسال</span>
              <span>التقييم</span>
              <span>سبب عدم الرضا</span>
            </div>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border-t border-divider px-5 py-3">
                  <Skeleton className="h-8 w-full" />
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
            {!loading && !error && rows.length === 0 && <div className="border-t border-divider px-5 py-10 text-center text-[13.5px] text-muted">لا توجد تقييمات من المستفيدين في هذه الفترة.</div>}
            {!loading &&
              rows.map((b) => (
                <div key={b.id} className={`${GRID} items-center border-t border-divider px-5 py-2.5 text-[13.5px]`} data-testid="feedback-row">
                  <span>
                    <span className="block font-semibold">{b.restroom.name}</span>
                    <span className="text-[12px] text-muted">
                      {b.restroom.floor} · {b.restroom.building}
                    </span>
                  </span>
                  <span dir="ltr" className="tabular text-right text-[12px]" data-testid="feedback-code">
                    {b.restroom.code}
                  </span>
                  <span>
                    <span className="block">{instantDayLabel(b.submittedAt)}</span>
                    <span className="tabular text-[12px] text-muted">{timeHM(b.submittedAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Face rating={b.rating} size={24} className="flex-none" />
                    <span className="font-semibold">{FEEDBACK_RATING_LABEL[b.rating]}</span>
                  </span>
                  <span className="text-[13px]" style={{ color: b.reasons.length ? '#B5512F' : '#687D74' }}>
                    {b.reasons.length ? b.reasons.join('، ') : '—'}
                  </span>
                </div>
              ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-divider px-5 pt-3 pb-1.5 text-[13px] text-muted">
          <span>
            يعرض {rows.length} من {total} تقييمًا
          </span>
          {hasMore && (
            <button type="button" onClick={more} disabled={loadingMore} className="touch-target rounded-[9px] border border-line bg-white px-3.5 py-[7px] text-[13px] hover:border-[#8FB8A2]">
              {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد'}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
