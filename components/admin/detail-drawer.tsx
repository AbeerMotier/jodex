'use client';
import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui/chip';
import { MixedText } from '@/components/ui/mixed-text';
import { Drawer, Lightbox } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiClientError } from '@/lib/client/api';
import type { Tone } from '@/lib/domain/catalog';
import { dayLabel, fmtNum, fmtPct, timeHM } from '@/lib/domain/format';

interface Detail {
  kind: 'round' | 'supervisor';
  kicker: string;
  title: string;
  score: number | null;
  status: { label: string; tone: Tone };
  meta: { k: string; v: string | number | null; type: 'date' | 'time' | 'text' | 'pct' }[];
  answerHead: string;
  rows: { title: string; answerLabel: string; tone: Tone; weight: number; points: number }[];
  formula: string;
  deepRows: { title: string; answerLabel: string; tone: Tone }[];
  photos: { label: string; url: string | null }[];
  note: string;
}

const TONE_TEXT: Record<Tone, string> = { success: '#3F7A62', warning: '#94711C', error: '#B5512F', neutral: '#2F4F44' };

function metaValue(m: Detail['meta'][number]) {
  if (m.v === null || m.v === undefined || m.v === '') return '—';
  if (m.type === 'date') return dayLabel(String(m.v));
  if (m.type === 'time') return timeHM(String(m.v));
  if (m.type === 'pct') return fmtPct(Number(m.v), 1);
  return String(m.v);
}

/** نافذة التفاصيل لسجل جولة مراقب أو تقييم مشرف */
export function DetailDrawer({ target, onClose }: { target: { kind: 'round' | 'supervisor'; id: string } | null; onClose: () => void }) {
  const targetKey = target ? `${target.kind}/${target.id}` : null;
  const [result, setResult] = useState<{ key: string; data: Detail | null; error: string | null } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!targetKey) return;
    let cancelled = false;
    api<Detail>(`/api/admin/log/${targetKey}`)
      .then((d) => !cancelled && setResult({ key: targetKey, data: d, error: null }))
      .catch(
        (e) => !cancelled && setResult({ key: targetKey, data: null, error: e instanceof ApiClientError ? e.message : 'تعذّر تحميل التفاصيل.' }),
      );
    return () => {
      cancelled = true;
    };
  }, [targetKey]);
  // النتيجة تُعرض فقط إن كانت للسجل المفتوح حاليًا
  const data = result && result.key === targetKey ? result.data : null;
  const error = result && result.key === targetKey ? result.error : null;

  return (
    <>
      <Drawer open={Boolean(target)} onClose={onClose} kicker={data?.kicker ?? ' '} title={data?.title ?? 'التفاصيل'}>
        {!data && !error && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-[86px] rounded-[14px]" />
            <Skeleton className="h-[140px]" />
            <Skeleton className="h-[220px]" />
          </div>
        )}
        {error && <div className="rounded-[12px] bg-err-bg px-3.5 py-3 text-[13.5px] text-err-ink">{error}</div>}
        {data && (
          <div className="flex flex-col gap-[18px]" data-testid="detail-drawer">
            <div className="flex items-center justify-between gap-3 rounded-[14px] bg-mint-3 px-4 py-3.5">
              <div>
                <div className="text-[12.5px] text-ink-2">النتيجة النهائية</div>
                <div className="tabular text-[28px] font-bold">{data.score === null ? '—' : `${fmtNum(data.score)}%`}</div>
              </div>
              <Chip tone={data.status.tone} size="md">
                {data.status.label}
              </Chip>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {data.meta.map((m) => (
                <div key={m.k}>
                  <div className="text-[12px] text-muted">{m.k}</div>
                  <div className="mt-0.5 text-[14px] font-semibold">{metaValue(m)}</div>
                </div>
              ))}
            </div>
            {data.rows.length > 0 && (
              <div>
                <div className="mb-1.5 text-[15px] font-bold">البنود والمساهمة</div>
                <div className="grid grid-cols-[minmax(0,1fr)_92px_52px_56px] gap-2 py-1.5 text-[12px] font-semibold text-muted">
                  <span>البند</span>
                  <span>{data.answerHead}</span>
                  <span>الوزن</span>
                  <span>المساهمة</span>
                </div>
                {data.rows.map((r) => (
                  <div key={r.title} className="grid grid-cols-[minmax(0,1fr)_92px_52px_56px] items-center gap-2 border-t border-divider py-2 text-[13px]">
                    <span>{r.title}</span>
                    <span className="font-semibold" style={{ color: TONE_TEXT[r.tone] }}>
                      {r.answerLabel}
                    </span>
                    <span className="tabular">{fmtNum(r.weight)}%</span>
                    <span className="tabular font-semibold">{fmtNum(r.points)}</span>
                  </div>
                ))}
                <div className="mt-2 text-[12px] text-muted">
                  <MixedText text={data.formula} />
                </div>
              </div>
            )}
            {data.deepRows.length > 0 && (
              <div>
                <div className="mb-1.5 text-[15px] font-bold">التنظيف العميق</div>
                {data.deepRows.map((r) => (
                  <div key={r.title} className="flex justify-between gap-2 border-t border-divider py-2 text-[13px]">
                    <span>{r.title}</span>
                    <span className="font-semibold" style={{ color: TONE_TEXT[r.tone] }}>
                      {r.answerLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.photos.length > 0 && (
              <div>
                <div className="mb-2 text-[15px] font-bold">الصور</div>
                <div className="grid grid-cols-3 gap-2">
                  {data.photos.map((p, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      {p.url ? (
                        <button
                          type="button"
                          onClick={() => setLightbox(p.url)}
                          aria-label={`عرض ${p.label}`}
                          className="aspect-[4/3] w-full cursor-zoom-in rounded-[9px] bg-cover bg-center"
                          style={{ backgroundImage: `url("${p.url}")` }}
                        />
                      ) : (
                        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[9px] bg-page text-[11px] text-muted">لا توجد صورة</div>
                      )}
                      <span className="text-[11.5px] text-muted">{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[15px] font-bold">الملاحظات</div>
              <div className="rounded-[11px] bg-[#F6F9F7] px-3 py-2.5 text-[13.5px] leading-[1.7] text-ink-2">{data.note}</div>
            </div>
          </div>
        )}
      </Drawer>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} alt="صورة" />
    </>
  );
}
