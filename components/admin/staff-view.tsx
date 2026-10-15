'use client';
import { useState } from 'react';
import { Bar } from '@/components/ui/bar';
import { Chip } from '@/components/ui/chip';
import { IconChevron, IconStar } from '@/components/ui/icons';
import { Ring } from '@/components/ui/ring';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApi } from '@/lib/client/use-api';
import { PERIOD_LABEL } from '@/lib/domain/catalog';
import { fmtPct, scoreColor } from '@/lib/domain/format';
import type { Classification } from '@/lib/domain/metrics';
import type { Period } from '@/lib/domain/time';
import { useFilterOptions, useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { ActiveFilters, PageHeader } from './page-header';
import { FilterGroup, Segmented, SelectField, Toolbar } from './toolbar';

interface StaffData {
  candidates: { monitorId: string; name: string; rank: number; cp: number | null; q: number | null; approved: boolean; restroom: { name: string; floor: string; building: string } }[];
  rows: {
    rank: number;
    monitorId: string;
    name: string;
    restroom: { name: string; floor: string; building: string };
    completed: number;
    required: number;
    cp: number | null;
    q: number | null;
    classification: Classification | null;
    classificationLabel: string | null;
    approved: boolean;
  }[];
}

const PERIODS: Period[] = ['today', 'week', 'month'];
const CLASS_TONE = { excellent: 'success', regular: 'warning', needs_follow_up: 'error' } as const;
const CONFETTI = [
  { w: 10, h: 10, r: '50%', bg: '#E3C068', top: 18, left: '14%', d: '3.2s', delay: '0s' },
  { w: 9, h: 9, r: '0', bg: '#E37452', top: '34%', right: '12%', d: '3.8s', delay: '.4s', rot: true },
  { w: 7, h: 7, r: '50%', bg: '#55957A', top: '30%', left: '22%', d: '4s', delay: '.8s' },
  { w: 12, h: 4, r: '2px', bg: '#8EC3A6', top: 14, right: '22%', d: '3.5s', delay: '.2s' },
];

export function StaffView() {
  const f = useUrlFilters();
  const options = useFilterOptions();
  const toast = useToast();
  const apiQuery = f.query(['building', 'monitor', 'approval']);
  const { data, loading, error, reload, setData } = useApi<StaffData>(`/api/admin/staff?${apiQuery}`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(c: StaffData['candidates'][number]) {
    setBusy(c.monitorId);
    try {
      const res = await api<{ approved: boolean; message: string }>(`/api/admin/bonus/${c.monitorId}`, {
        method: c.approved ? 'DELETE' : 'POST',
        body: { period: f.period },
      });
      toast.show(res.message);
      setData((d) =>
        d
          ? {
              ...d,
              candidates: d.candidates.map((x) => (x.monitorId === c.monitorId ? { ...x, approved: res.approved } : x)),
              rows: d.rows.map((x) => (x.monitorId === c.monitorId ? { ...x, approved: res.approved } : x)),
            }
          : d,
      );
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر تنفيذ الإجراء.', 'error');
    } finally {
      setBusy(null);
    }
  }

  const active = [
    f.get('building') && options?.buildings.find((b) => b.id === f.get('building'))?.name,
    f.get('monitor') && options?.monitors.find((m) => m.id === f.get('monitor'))?.name,
    f.get('approval') && (f.get('approval') === 'approved' ? 'المكافأة معتمدة' : 'غير معتمدة'),
  ].filter(Boolean) as string[];

  const filters = (
    <>
      <FilterGroup label="الفترة الزمنية">
        <Segmented testId="period-filter" options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} value={f.period} onChange={(v) => f.set({ period: v })} />
      </FilterGroup>
      <LocationFilters building={f.get('building')} floor="" restroom="" showFloor={false} showRestroom={false} onChange={(p) => f.set({ building: p.building })} />
      <SelectField
        label="الموظف"
        testId="filter-monitor"
        value={f.get('monitor')}
        onChange={(v) => f.set({ monitor: v })}
        options={(options?.monitors ?? []).filter((m) => m.kind === 'primary').map((m) => ({ value: m.id, label: m.name }))}
        placeholder="كل المراقبين الأساسيين"
      />
      <SelectField
        label="اعتماد المكافأة"
        testId="filter-approval"
        value={f.get('approval')}
        onChange={(v) => f.set({ approval: v })}
        options={[
          { value: 'approved', label: 'معتمدة' },
          { value: 'not_approved', label: 'غير معتمدة' },
        ]}
        placeholder="الكل"
      />
    </>
  );

  return (
    <>
      <PageHeader
        title="أداء الموظفين المتميزين"
        sub={PERIOD_LABEL[f.period]}
        actions={<Toolbar filters={filters} activeCount={active.length} exportUrl={(format) => `/api/admin/export?report=staff&format=${format}&${apiQuery}`} exportName="jodex-staff-performance" />}
      />
      <ActiveFilters items={active} onClear={() => f.set({ building: null, monitor: null, approval: null })} />

      <section className="flex animate-fade-up flex-col gap-3" data-testid="bonus-section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-[16px] font-bold">المرشحون للمكافأة</h2>
          <span className="text-[12.5px] text-muted">الترشيح آلي حسب الالتزام وجودة التقييم</span>
        </div>
        {loading && !data && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[250px] rounded-[22px]" />
            ))}
          </div>
        )}
        {error && !data && (
          <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px] text-err-ink" role="alert">
            {error.message}{' '}
            <button type="button" onClick={reload} className="font-bold underline">
              إعادة المحاولة
            </button>
          </div>
        )}
        {data && data.candidates.length === 0 && <div className="py-3 text-[13px] text-muted">لا يوجد مرشحون في هذه الفترة.</div>}
        {data && data.candidates.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3.5">
            {data.candidates.map((c, i) => (
              <div
                key={c.monitorId}
                data-testid="bonus-card"
                className="relative flex animate-fade-up flex-col items-center gap-3 overflow-hidden rounded-[22px] border border-[rgba(227,192,104,.55)] bg-[rgba(227,192,104,.16)] px-[18px] pt-5 pb-[18px] text-center backdrop-blur-[6px] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(47,79,68,.08)]"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {CONFETTI.map((p, k) => (
                  <span
                    key={k}
                    aria-hidden
                    className="pointer-events-none absolute"
                    style={{
                      width: p.w,
                      height: p.h,
                      borderRadius: p.r,
                      background: p.bg,
                      top: p.top,
                      left: p.left,
                      right: p.right,
                      transform: p.rot ? 'rotate(45deg)' : undefined,
                      animation: `confetti ${p.d} ease-in-out ${p.delay} infinite`,
                    }}
                  />
                ))}
                <span aria-hidden className="pointer-events-none absolute -top-20 -left-[70px] h-[150px] w-[150px] rounded-full border-[1.5px] border-[rgba(227,192,104,.5)]" />
                <Ring value={c.cp} size={96} stroke={3.2} track="rgba(255,255,255,.9)" color="#E3C068" label={fmtPct(c.cp)} sublabel="الالتزام" textClass="text-[21px]" />
                <div className="relative min-w-0">
                  <div className="flex items-center justify-center gap-2 text-[17px] font-bold">
                    {c.name}
                    <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-warn-line text-white" style={{ animation: 'shine 2.6s ease-in-out infinite' }}>
                      <IconStar size={14} />
                    </span>
                  </div>
                  <div className="mt-[3px] text-[12px] text-ink-2">
                    {c.restroom.name} · {c.restroom.floor} · {c.restroom.building}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted">جودة {fmtPct(c.q)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  disabled={busy === c.monitorId}
                  data-testid="bonus-toggle"
                  className="touch-target relative flex w-full items-center justify-center gap-2 rounded-[12px] border px-[18px] py-[11px] text-[13.5px] font-bold whitespace-nowrap transition-[background-color,transform] duration-150 hover:-translate-y-px"
                  style={
                    c.approved
                      ? { background: '#55957A', color: '#FFFFFF', borderColor: '#55957A' }
                      : { background: 'rgba(255,255,255,.7)', color: '#2F4F44', borderColor: 'rgba(85,149,122,.4)' }
                  }
                >
                  {busy === c.monitorId && <Spinner />}
                  {c.approved ? 'معتمد ✓' : 'اعتماد المكافأة'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex animate-fade-up flex-col gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="staff-toggle"
          className="flex w-full items-center justify-between gap-3 rounded-[16px] border border-line bg-white px-[18px] py-3.5 text-right transition-shadow hover:shadow-[0_6px_16px_rgba(47,79,68,.08)]"
        >
          <span className="text-[16px] font-bold text-ink">أداء الموظفين</span>
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-mint-5">
            <IconChevron size={18} className="transition-transform duration-200" style={{ transform: `rotate(${open ? 180 : 0}deg)` }} />
          </span>
        </button>
        {open && data && (
          <div className="animate-[fadeIn_.25s_ease_both] overflow-x-auto rounded-[18px] border border-line bg-white" data-testid="staff-table">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[44px_minmax(0,1.3fr)_minmax(0,1.4fr)_90px_minmax(150px,1fr)] gap-3 bg-[#F6F9F7] px-[18px] py-3 text-[12.5px] font-semibold text-ink-2">
                <span>#</span>
                <span>الموظف</span>
                <span>الموقع</span>
                <span className="text-center">الجولات</span>
                <span>نسبة الالتزام</span>
              </div>
              {data.rows.length === 0 && <div className="border-t border-divider px-5 py-8 text-center text-[13.5px] text-muted">لا توجد بيانات مطابقة.</div>}
              {data.rows.map((p) => (
                <div key={p.monitorId} className="grid grid-cols-[44px_minmax(0,1.3fr)_minmax(0,1.4fr)_90px_minmax(150px,1fr)] items-center gap-3 border-t border-divider px-[18px] py-3 text-[13.5px]" data-testid="staff-row">
                  <span className="tabular font-bold text-ink-2">{p.rank}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-ink">{p.name}</span>
                    {p.classification && (
                      <Chip tone={CLASS_TONE[p.classification]} size="sm">
                        {p.classificationLabel}
                      </Chip>
                    )}
                    {p.approved && (
                      <Chip tone="success" size="sm">
                        مكافأة معتمدة
                      </Chip>
                    )}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {p.restroom.name} · {p.restroom.floor} · {p.restroom.building}
                  </span>
                  <span className="tabular text-center">
                    {p.completed} / {p.required}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1">
                      <Bar value={p.cp} color={scoreColor(p.cp)} />
                    </span>
                    <b className="tabular min-w-10 text-left">{fmtPct(p.cp)}</b>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
