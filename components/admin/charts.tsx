'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/overlay';
import { fmtPct } from '@/lib/domain/format';

export const SERIES_STYLE = {
  // حسب ملف الهوية: المقاول #2F4F44 والمشرف #8EC3A6 (ورضا المستفيدين من نفس اللوحة)
  contractor: { label: 'مراقب المقاول', color: '#2F4F44' },
  supervisor: { label: 'المشرف الميداني', color: '#8EC3A6' },
  beneficiary: { label: 'رضا المستفيدين', color: '#E3C068' },
} as const;
export type SeriesKey = keyof typeof SERIES_STYLE;

export interface ComparisonPoint {
  restroomId: string;
  code?: string;
  name: string;
  /** مراقب المقاول المسؤول عن دورة المياه */
  monitor?: string | null;
  /** المشرفون الميدانيون الذين قيّموا الموقع في الفترة */
  supervisors?: string[];
  floor: string;
  building: string;
  contractor: number | null;
  supervisor: number | null;
  satisfaction: number | null;
}

/** الجزء المميِّز القصير من الترميز (الدور والرقم) تحت اسم دورة المياه */
const shortCode = (code?: string) => (code ? code.split('-').slice(-2).join('-') : '');

/** مقارنة الأداء العام: عمودان لكل دورة مياه بلون الفئة، و«—» عند عدم وجود بيانات. الضغط على المؤشر يعرض تفاصيله */
export function ComparisonChart({ points, series }: { points: ComparisonPoint[]; series: SeriesKey[] }) {
  const valueOf = (p: ComparisonPoint, s: SeriesKey) => (s === 'beneficiary' ? p.satisfaction : p[s]);
  const [open, setOpen] = useState<ComparisonPoint | null>(null);
  return (
    <div className="overflow-x-auto" data-testid="comparison-chart">
      <div className="mt-[18px] grid gap-2.5" style={{ minWidth: Math.max(520, points.length * 90), gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0,1fr))` }}>
        {points.map((p, gi) => (
          <button
            key={p.restroomId}
            type="button"
            onClick={() => setOpen(p)}
            className="flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-[12px] border-0 bg-transparent p-0 pb-1 transition-colors hover:bg-[#F6F9F7]"
            aria-label={`تفاصيل ${p.name} ${p.code ?? ''}`}
            data-testid="comparison-point"
          >
            <div
              className="flex h-[200px] w-full items-end justify-center gap-1.5 border-b border-line"
              style={{ background: 'repeating-linear-gradient(to top,transparent 0 49px,#F0F5F2 49px 50px)' }}
            >
              {series.map((s, bi) => {
                const v = valueOf(p, s);
                return (
                  <div key={s} className="flex h-full max-w-[26px] flex-1 flex-col items-center justify-end gap-1" data-series={s}>
                    <span className="tabular text-[10.5px] font-bold text-ink">{v === null ? '—' : fmtPct(v)}</span>
                    <div
                      className="w-full origin-bottom animate-grow-up rounded-t-[7px] rounded-b-[2px] transition-[height] duration-500"
                      style={{ height: v === null ? '2%' : `${(v * 0.82).toFixed(1)}%`, background: v === null ? '#D3DED8' : SERIES_STYLE[s].color, animationDelay: `${gi * 70 + bi * 40}ms` }}
                      title={`${SERIES_STYLE[s].label}: ${v === null ? '—' : fmtPct(v)}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="text-center text-[12.5px] font-bold">{p.name}</div>
            <div dir="ltr" className="tabular text-center text-[11px] leading-[1.4] text-muted">
              {shortCode(p.code)}
            </div>
          </button>
        ))}
        {points.length === 0 && <div className="py-10 text-center text-[13px] text-muted">لا توجد دورات مياه مطابقة للفلاتر.</div>}
      </div>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? ''} width={420}>
        {open && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pb-3 text-[13.5px]" data-testid="comparison-detail">
            <dt className="text-muted">ترميز دورة المياه</dt>
            <dd className="m-0 font-semibold" dir="ltr" style={{ textAlign: 'right' }}>
              {open.code ?? '—'}
            </dd>
            <dt className="text-muted">المبنى</dt>
            <dd className="m-0 font-semibold">{open.building}</dd>
            <dt className="text-muted">الدور</dt>
            <dd className="m-0 font-semibold">{open.floor}</dd>
            <dt className="text-muted">مراقب المقاول</dt>
            <dd className="m-0 font-semibold">{open.monitor ?? '—'}</dd>
            <dt className="text-muted">المشرف الميداني</dt>
            <dd className="m-0 font-semibold">{open.supervisors?.length ? open.supervisors.join('، ') : 'لا يوجد تقييم في الفترة'}</dd>
            {series.map((s) => (
              <div key={s} className="contents">
                <dt className="text-muted">{SERIES_STYLE[s].label}</dt>
                <dd className="tabular m-0 font-bold" style={{ color: SERIES_STYLE[s].color }}>
                  {fmtPct(valueOf(open, s))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}

export function Legend({ series }: { series: SeriesKey[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-muted" data-testid="chart-legend">
      {series.map((s) => (
        <span key={s} className="flex items-center gap-[5px]" data-series={s}>
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES_STYLE[s].color }} />
          {SERIES_STYLE[s].label}
        </span>
      ))}
    </div>
  );
}
