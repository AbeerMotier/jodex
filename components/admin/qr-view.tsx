'use client';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { ApiClientError, download } from '@/lib/client/api';
import { useApi } from '@/lib/client/use-api';
import { useUrlFilters } from './filters-context';
import { LocationFilters } from './location-filters';
import { PageHeader } from './page-header';
import { QrCardFace } from './qr-card';
import { Toolbar } from './toolbar';

interface QrData {
  cards: { id: string; restroom: { code: string; name: string; floor: string; building: string }; url: string; displayUrl: string; svg: string }[];
}

export function QrView() {
  const f = useUrlFilters();
  const toast = useToast();
  const building = f.get('building');
  const { data, loading, error, reload } = useApi<QrData>(`/api/admin/qr${building ? `?building=${building}` : ''}`);
  const [printing, setPrinting] = useState<string | null>(null);

  async function print(id: string, code: string) {
    setPrinting(id);
    try {
      await download(`/api/admin/qr/${id}/print`, `jodex-qr-${code}.pdf`);
      toast.show('تم تجهيز ملف الطباعة');
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر تجهيز ملف الطباعة.', 'error');
    } finally {
      setPrinting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="رموز QR"
        sub="لكل دورة مياه رمز خاص بها. امسح الرمز لتقييم نظافة دورة المياه مباشرة، دون تسجيل دخول."
        actions={
          <Toolbar
            filters={<LocationFilters building={building} floor="" restroom="" showFloor={false} showRestroom={false} onChange={(p) => f.set({ building: p.building })} />}
            activeCount={building ? 1 : 0}
          />
        }
      />
      {error && (
        <div className="rounded-[18px] border border-line bg-white p-6 text-center text-[13.5px] text-err-ink" role="alert">
          {error.message}{' '}
          <button type="button" onClick={reload} className="font-bold underline">
            إعادة المحاولة
          </button>
        </div>
      )}
      <div className="grid animate-fade-up grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4" data-testid="qr-grid">
        {loading && !data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[400px] rounded-[22px]" />)}
        {data?.cards.length === 0 && <div className="text-[13.5px] text-muted">لا توجد رموز QR مطابقة.</div>}
        {data?.cards.map((q) => (
          <div key={q.id} className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-line bg-white pb-4 text-center shadow-[0_10px_26px_-18px_rgba(47,79,68,.4)]" data-testid="qr-card">
            <QrCardFace svg={q.svg} name={q.restroom.name} location={`${q.restroom.floor} · ${q.restroom.building}`} displayUrl={q.displayUrl} />
            <div className="mt-2 grid w-full grid-cols-2 gap-1.5 px-4">
              <a href={q.url} target="_blank" rel="noopener noreferrer" className="touch-target flex items-center justify-center rounded-[9px] bg-ink px-1.5 py-[9px] text-[12.5px] font-semibold text-white no-underline hover:text-white" data-testid="qr-open">
                فتح صفحة التقييم
              </a>
              <button type="button" onClick={() => print(q.id, q.restroom.code)} disabled={printing === q.id} className="touch-target flex items-center justify-center gap-1.5 rounded-[9px] border border-line bg-white px-1.5 py-[9px] text-[12.5px]" data-testid="qr-print">
                {printing === q.id && <Spinner size={14} />}
                طباعة
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
