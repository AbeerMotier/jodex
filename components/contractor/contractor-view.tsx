import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Avatar, GreenHero, InfoTile } from '@/components/ui/hero';
import type { Tone } from '@/lib/domain/catalog';
import { dayLabel } from '@/lib/domain/format';

interface Status {
  label: string;
  tone: Tone;
}
export interface ContractorData {
  today: string;
  restrooms: { id: string; code: string; name: string; floor: string; building: string; monitor: string; am: Status; pm: Status }[];
  windows: { am: string; pm: string };
}

const GRID = 'grid grid-cols-[minmax(190px,1.2fr)_minmax(150px,1fr)_110px_minmax(120px,1fr)_minmax(130px,1fr)_120px_120px] gap-3';

/** صفحة المقاول: جدول دورات المياه المسندة إليه للعرض فقط (بلا اختيار أو روابط أو إجراءات) */
export function ContractorView({ name, data }: { name: string; data: ContractorData }) {
  const buildings = new Set(data.restrooms.map((r) => r.building)).size;
  return (
    <main className="mx-auto flex max-w-[1200px] animate-[fadeIn_.35s_ease_both] flex-col gap-4 px-4 pt-6 pb-20">
      <GreenHero>
        <div className="flex flex-col gap-4 p-[22px]">
          <div className="flex items-center gap-3">
            <Avatar name={name} className="border border-white/35 bg-white/[.16] text-white" />
            <div>
              <div className="text-[12.5px] font-semibold text-white">المقاول · دورات المياه المسندة</div>
              <div className="text-[21px] font-bold" data-testid="contractor-name">
                {name}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <InfoTile label="دورات المياه" value={<span className="tabular">{data.restrooms.length}</span>} />
            <InfoTile label="المباني" value={<span className="tabular">{buildings}</span>} />
            <InfoTile label="التاريخ" value={dayLabel(data.today)} />
            <InfoTile label="الجولة الصباحية" value={<span className="tabular">{data.windows.am}</span>} />
            <InfoTile label="الجولة المسائية" value={<span className="tabular">{data.windows.pm}</span>} />
          </div>
        </div>
      </GreenHero>

      {data.restrooms.length === 0 ? (
        <Card className="p-6 text-center text-[14px] text-muted">لا توجد دورات مياه مسندة إليك حاليًا. راجع الأدمن.</Card>
      ) : (
        <details className="group min-w-0 rounded-[20px] border border-line bg-white py-2" data-testid="contractor-list">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 pt-2.5 pb-1" data-testid="contractor-toggle">
            <h2 className="m-0 text-[17px] font-bold">
              دورات المياه المسندة إليك ({data.restrooms.length}) <span className="text-[13px] font-normal text-muted group-open:hidden">— اضغط للعرض</span>
            </h2>
            <Chip tone="neutral" size="sm">
              للاطلاع فقط
            </Chip>
          </summary>
          <section className="min-w-0" data-testid="contractor-table" aria-label="دورات المياه المسندة (للاطلاع فقط)">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]" role="table">
              <div className={`${GRID} px-5 py-3 text-[12px] font-semibold text-muted`} role="row">
                <span role="columnheader">دورة المياه</span>
                <span role="columnheader">ترميز دورة المياه</span>
                <span role="columnheader">الدور</span>
                <span role="columnheader">المبنى</span>
                <span role="columnheader">المراقب المسؤول</span>
                <span role="columnheader">الجولة الصباحية</span>
                <span role="columnheader">الجولة المسائية</span>
              </div>
              {data.restrooms.map((r) => (
                <div key={r.id} role="row" className={`${GRID} items-center border-t border-divider px-5 py-2.5 text-[13.5px]`} data-testid="contractor-row">
                  <span role="cell" className="font-semibold">
                    {r.name}
                  </span>
                  <span role="cell" dir="ltr" className="tabular text-right text-[12.5px]" data-testid="contractor-code">
                    {r.code}
                  </span>
                  <span role="cell">{r.floor}</span>
                  <span role="cell">{r.building}</span>
                  <span role="cell">{r.monitor}</span>
                  <span role="cell">
                    <Chip tone={r.am.tone} size="sm">
                      {r.am.label}
                    </Chip>
                  </span>
                  <span role="cell">
                    <Chip tone={r.pm.tone} size="sm">
                      {r.pm.label}
                    </Chip>
                  </span>
                </div>
              ))}
            </div>
          </div>
          </section>
        </details>
      )}
    </main>
  );
}
