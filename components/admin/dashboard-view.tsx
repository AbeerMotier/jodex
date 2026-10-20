'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Bar } from '@/components/ui/bar';
import { Chip, RoleChip } from '@/components/ui/chip';
import { Face } from '@/components/ui/face';
import { Ring } from '@/components/ui/ring';
import { MixedText } from '@/components/ui/mixed-text';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/client/use-api';
import { FEEDBACK_RATING_LABEL, FEEDBACK_VALUE_RATING, PERIOD_LABEL, SOURCE_LABEL, type Source } from '@/lib/domain/catalog';
import { dayLabel, fmtPct, initial, instantDayLabel, scoreColor, timeHM } from '@/lib/domain/format';
import type { Period } from '@/lib/domain/time';
import { ComparisonChart, Legend, type ComparisonPoint, type SeriesKey } from './charts';
import { DetailDrawer } from './detail-drawer';
import type { EntryView } from './entry';
import { useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { ActiveFilters } from './page-header';
import { FilterGroup, Segmented, Toolbar } from './toolbar';

interface DashboardData {
  periodLabel: string;
  greeting: string;
  adminName: string;
  source: Source;
  total: { label: string; value: number; sub: string };
  rounds: { required: number; completed: number; late: number; missed: number; completedPct: number | null; latePct: number | null; missedPct: number | null } | null;
  quality: {
    contractor: { value: number | null; sub: string } | null;
    supervisor: { value: number | null; sub: string } | null;
    beneficiary: {
      value: number | null;
      sub: string;
      counts?: { excellent: number; good: number; bad: number; total: number };
      weights?: { excellent: number; good: number; bad: number };
      maxWeight?: number;
      formula?: string;
    } | null;
    compliance: { am: number | null; pm: number | null; overall: number | null } | null;
  };
  comparison: { series: SeriesKey[]; points: ComparisonPoint[] };
  recent:
    | { title: string; kind: 'entries'; items: EntryView[] }
    | { title: string; kind: 'feedback'; items: { id: string; rating: number; submittedAt: string; restroom: { name: string; floor: string; building: string } }[] };
  performance:
    | { monitorId: string; name: string; cp: number | null; a: number | null; q: number | null; restroom: { name: string; floor: string; building: string } }[]
    | null;
}

const SOURCES: Source[] = ['all', 'contractor', 'supervisor', 'beneficiary'];
const PERIODS: Period[] = ['today', 'week', 'month'];

export function DashboardView() {
  const f = useUrlFilters();
  const source = (SOURCES.includes(f.get('source') as Source) ? f.get('source') : 'all') as Source;
  const building = f.get('building');
  const apiQuery = f.query(['source', 'building']);
  const { data, loading, error, reload } = useApi<DashboardData>(`/api/admin/dashboard?${apiQuery}`);
  const [detail, setDetail] = useState<{ kind: 'round' | 'supervisor'; id: string } | null>(null);

  const active = [PERIOD_LABEL[f.period], SOURCE_LABEL[source]];
  const filters = (
    <>
      <FilterGroup label="الفترة الزمنية">
        <Segmented testId="period-filter" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={f.period} onChange={(v) => f.set({ period: v })} />
      </FilterGroup>
      <FilterGroup label="نوع التقييم">
        <Segmented testId="source-filter" columns={2} options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} value={source} onChange={(v) => f.set({ source: v === 'all' ? null : v })} />
      </FilterGroup>
      <LocationFilters building={building} floor="" restroom="" showFloor={false} showRestroom={false} onChange={(p) => f.set({ building: p.building })} />
    </>
  );

  return (
    <>
      <section className="relative z-40 flex animate-fade-up flex-wrap items-center justify-between gap-3 px-0.5 py-1">
        <div className="relative z-[3] flex min-w-0 flex-auto items-center gap-3">
          <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-ink text-[16px] font-bold text-white" aria-hidden>
            {initial(data?.adminName ?? 'م')}
          </span>
          <div className="min-w-0">
            <div className="text-[12px] text-ink-2">{data?.greeting ?? ' '}</div>
            <h1 className="m-0 text-[16px] leading-[1.3] font-bold whitespace-nowrap">م. {data?.adminName ?? ''}</h1>
          </div>
        </div>
        <Toolbar
          bordered={false}
          filters={filters}
          activeCount={(source !== 'all' ? 1 : 0) + (building ? 1 : 0)}
          exportUrl={(format) => `/api/admin/export?report=dashboard&format=${format}&${apiQuery}`}
          exportName="jodex-dashboard"
        />
      </section>
      <ActiveFilters items={building || source !== 'all' ? active : []} onClear={() => f.set({ source: null, building: null })} />

      {error && !data && (
        <div className="rounded-[18px] border border-line bg-white p-6 text-center" role="alert">
          <div className="font-bold text-err-ink">{error.message}</div>
          <button type="button" onClick={reload} className="touch-target mt-3 rounded-[11px] bg-ink px-5 py-2 text-[14px] font-semibold text-white">
            إعادة المحاولة
          </button>
        </div>
      )}

      {(loading && !data) || !data ? (
        !error && <DashboardSkeleton />
      ) : (
        <div className={`flex flex-col gap-[18px] transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3" data-testid="kpis">
            <div className="relative flex min-w-0 animate-fade-up flex-col gap-1.5 overflow-hidden rounded-[18px] border border-mint-2 bg-mint-4 px-[18px] py-4 text-ink" data-testid="kpi-total">
              <span className="pointer-events-none absolute -top-[50px] -left-10 h-[120px] w-[120px] rounded-full border-[1.2px] border-mint-2" aria-hidden />
              <span className="relative text-[12.5px] text-ink-2">{data.total.label}</span>
              <span className="tabular relative text-[32px] leading-[1.1] font-bold">{data.total.value}</span>
              <span className="relative text-[11.5px] text-ink-2">{data.total.sub}</span>
            </div>
            {data.rounds &&
              [
                { key: 'required', label: 'الجولات المطلوبة', value: data.rounds.required, pct: data.rounds.required ? 100 : null, c: '#2F4F44', bar: '#8FB8A2' },
                { key: 'completed', label: 'المكتملة', value: data.rounds.completed, pct: data.rounds.completedPct, c: '#3F7A62', bar: '#55957A' },
                { key: 'late', label: 'المتأخرة', value: data.rounds.late, pct: data.rounds.latePct, c: '#94711C', bar: '#E3C068' },
                { key: 'missed', label: 'الفائتة', value: data.rounds.missed, pct: data.rounds.missedPct, c: '#B5512F', bar: '#E37452' },
              ].map((k, i) => (
                <div
                  key={k.key}
                  data-testid={`kpi-${k.key}`}
                  className="flex min-w-0 animate-fade-up flex-col gap-1.5 rounded-[18px] border border-line bg-white px-[18px] py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(47,79,68,.3)]"
                  style={{ animationDelay: `${i * 60 + 60}ms` }}
                >
                  <span className="flex items-center gap-[7px] text-[12.5px] text-muted">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: k.bar }} />
                    {k.label}
                  </span>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="tabular text-[32px] leading-[1.1] font-bold" style={{ color: k.c }} data-value>
                      {k.value}
                    </span>
                    <span className="tabular text-[12px] font-semibold" style={{ color: k.c }}>
                      {fmtPct(k.pct)}
                    </span>
                  </span>
                  <Bar value={k.pct ?? 0} color={k.bar} />
                </div>
              ))}
          </div>

          <section className="rounded-[20px] border border-line bg-white p-5" data-testid="quality-section">
            <h2 className="m-0 text-[16px] font-bold">جودة التقييم والالتزام</h2>
            <div className="mt-1 text-[12.5px] text-muted">النتائج الموزونة من 100 · {data.periodLabel}</div>
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {data.quality.contractor && <QualityTile testId="tile-contractor" bg="#E6F2EA" label="متوسط نتيجة جولات مراقبي المقاول" value={data.quality.contractor.value} sub={data.quality.contractor.sub} />}
              {data.quality.supervisor && <QualityTile testId="tile-supervisor" bg="#FBF4E1" label="متوسط التقييم العام للمشرفين الميدانيين" value={data.quality.supervisor.value} sub={data.quality.supervisor.sub} />}
              {data.quality.beneficiary && <QualityTile testId="tile-beneficiary" bg="#E6F2EA" label="مؤشر رضا المستفيدين" value={data.quality.beneficiary.value} sub={data.quality.beneficiary.sub} />}
              {data.quality.compliance && (
                <QualityTile
                  testId="tile-compliance"
                  bg="#EEF3F0"
                  label="نسبة التزام الجولات"
                  value={data.quality.compliance.overall}
                  sub={`صباحية ${fmtPct(data.quality.compliance.am)} · مسائية ${fmtPct(data.quality.compliance.pm)}`}
                />
              )}
            </div>
          </section>

          <section className="rounded-[20px] border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <h2 className="m-0 text-[16px] font-bold">مقارنة الأداء العام</h2>
              <Legend series={data.comparison.series} />
            </div>
            <ComparisonChart points={data.comparison.points} series={data.comparison.series} />
          </section>

          <div className="flex flex-wrap items-stretch gap-[18px]" data-testid="recent-row">
            <section className="flex min-w-0 flex-[1_1_420px] flex-col rounded-[20px] border border-line bg-white p-5" data-testid="recent-section">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 text-[16px] font-bold">{data.recent.title}</h2>
                <Link href={`${data.recent.kind === 'feedback' ? '/admin/feedback' : '/admin/rounds'}?period=${f.period}`} className="text-[13px] font-semibold whitespace-nowrap text-ink no-underline">
                  {data.recent.kind === 'feedback' ? 'تقييمات المستفيدين ←' : 'سجل الجولات ←'}
                </Link>
              </div>
              <div className="mt-3 flex flex-col" data-testid="recent-list">
                {data.recent.items.length === 0 && <div className="py-6 text-center text-[13px] text-muted">لا توجد سجلات في هذه الفترة.</div>}
                {data.recent.kind === 'entries'
                  ? data.recent.items.map((r) => (
                      <button
                        key={`${r.kind}-${r.id}`}
                        type="button"
                        onClick={() => setDetail({ kind: r.kind, id: r.id })}
                        data-testid="recent-item"
                        className="grid w-full cursor-pointer grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border-t border-divider bg-transparent px-2 py-[13px] text-right text-[13px] transition-colors hover:bg-[#F6F9F7]"
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold">{r.employee.name}</span>
                            <RoleChip role={r.employee.role} />
                          </span>
                          <span className="text-[11.5px] text-muted">
                            {dayLabel(r.date)} · {r.time ? timeHM(r.time) : '—'} · {r.typeLabel}
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-col gap-[3px]">
                          <span>{r.restroom.name}</span>
                          <span className="text-[11.5px] text-muted">
                            {r.restroom.floor} · {r.restroom.building}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-[5px]">
                          <span className="tabular text-[14px] font-bold">{fmtPct(r.result)}</span>
                          <Chip tone={r.status.tone} size="sm">
                            {r.status.label}
                          </Chip>
                        </span>
                      </button>
                    ))
                  : data.recent.items.map((fb) => {
                      const rating = FEEDBACK_VALUE_RATING[fb.rating] ?? 'good';
                      return (
                        <div key={fb.id} data-testid="recent-item" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-t border-divider px-2 py-[13px] text-[13px]">
                          <span className="flex items-center gap-2">
                            <Face rating={rating} size={24} />
                            <span className="font-semibold">{FEEDBACK_RATING_LABEL[rating]}</span>
                          </span>
                          <span className="flex min-w-0 flex-col gap-[3px]">
                            <span>{fb.restroom.name}</span>
                            <span className="text-[11.5px] text-muted">
                              {fb.restroom.floor} · {fb.restroom.building}
                            </span>
                          </span>
                          <span className="text-[11.5px] whitespace-nowrap text-muted">
                            {instantDayLabel(fb.submittedAt)} · {timeHM(fb.submittedAt)}
                          </span>
                        </div>
                      );
                    })}
              </div>
            </section>
            {data.performance && (
              <section className="flex min-w-0 flex-[1_1_420px] flex-col rounded-[20px] border border-line bg-white p-5" data-testid="performance-section">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="m-0 text-[16px] font-bold">مؤشرات أداء المقاولين</h2>
                  <Link href={`/admin/staff?period=${f.period}`} className="text-[13px] font-semibold whitespace-nowrap text-ink no-underline">
                    أداء الموظفين ←
                  </Link>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,.75fr)_54px_54px] gap-2.5 px-3 pt-3 pb-1.5 text-[11.5px] font-semibold text-muted">
                  <span>المراقب</span>
                  <span>مستوى الجودة</span>
                  <span className="text-center">الالتزام</span>
                  <span className="text-center">الجولات</span>
                </div>
                <div className="flex flex-col gap-2">
                  {data.performance.length === 0 && <div className="py-6 text-center text-[13px] text-muted">لا توجد بيانات أداء في هذه الفترة.</div>}
                  {data.performance.map((p, i) => (
                    <div
                      key={p.monitorId}
                      className="grid animate-fade-up grid-cols-[minmax(0,1fr)_minmax(80px,.75fr)_54px_54px] items-center gap-2.5 rounded-[14px] border border-divider bg-[#F8FAF9] px-3 py-[9px]"
                      style={{ animationDelay: `${i * 60}ms` }}
                      data-testid="performance-row"
                    >
                      <div className="flex min-w-0 items-center gap-[9px]">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-mint-3 text-[13px] font-bold text-ink">{initial(p.name)}</span>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-bold">{p.name}</div>
                          <div className="truncate text-[11px] text-muted">
                            {p.restroom.name} · {p.restroom.floor} · {p.restroom.building}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1">
                          <Bar value={p.q} color={scoreColor(p.q)} track="#E3EAE6" />
                        </div>
                        <span className="tabular min-w-8 text-left text-[12px] font-bold">{fmtPct(p.q)}</span>
                      </div>
                      <span className="tabular text-center text-[13px] font-bold">{fmtPct(p.cp)}</span>
                      <span className="tabular text-center text-[13px] font-bold">{fmtPct(p.a)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      <DetailDrawer target={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function QualityTile({ bg, label, value, sub, testId }: { bg: string; label: string; value: number | null; sub: string; testId: string }) {
  return (
    <div className="flex animate-fade-up items-center gap-3.5 rounded-[18px] p-4" style={{ background: bg }} data-testid={testId}>
      <Ring value={value} size={80} />
      <div className="min-w-0">
        <div className="text-[14px] leading-[1.4] font-bold">{label}</div>
        <div className="mt-1 text-[12px] text-muted">
          <MixedText text={sub} />
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-[18px]" />
        ))}
      </div>
      <Skeleton className="h-[170px] rounded-[20px]" />
      <Skeleton className="h-[320px] rounded-[20px]" />
      <div className="flex flex-wrap gap-[18px]">
        <Skeleton className="h-[300px] min-w-[300px] flex-1 rounded-[20px]" />
        <Skeleton className="h-[300px] min-w-[300px] flex-1 rounded-[20px]" />
      </div>
    </div>
  );
}
