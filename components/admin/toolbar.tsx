'use client';
import { useState, type ReactNode } from 'react';
import { IconDownload, IconFilter } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { ApiClientError, download } from '@/lib/client/api';
import { cn } from '@/components/ui/cn';

type Pop = 'filter' | 'download' | null;

/** زر الفلاتر + زر تنزيل التقرير (PDF / Excel) بنفس تصميم العرض */
export function Toolbar({
  filters,
  activeCount = 0,
  exportUrl,
  exportName,
  filterLabel = 'تصفية',
  bordered = true,
}: {
  filters?: ReactNode;
  activeCount?: number;
  exportUrl?: (format: 'pdf' | 'xlsx') => string;
  exportName?: string;
  filterLabel?: string;
  bordered?: boolean;
}) {
  const [pop, setPop] = useState<Pop>(null);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const toast = useToast();

  async function doExport(format: 'pdf' | 'xlsx') {
    if (!exportUrl) return;
    setPop(null);
    setBusy(format);
    try {
      await download(exportUrl(format), `${exportName ?? 'jodex-report'}.${format}`);
      toast.show(`تم تنزيل التقرير بصيغة ${format === 'pdf' ? 'PDF' : 'Excel'}`);
    } catch (e) {
      toast.show(e instanceof ApiClientError ? e.message : 'تعذّر تجهيز التقرير.', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative z-[45] flex items-center gap-2">
      {pop && <div className="fixed inset-0 z-[44]" onClick={() => setPop(null)} aria-hidden />}
      {filters && (
        <button
          type="button"
          onClick={() => setPop(pop === 'filter' ? null : 'filter')}
          title={filterLabel}
          aria-label={filterLabel}
          aria-expanded={pop === 'filter'}
          data-testid="filter-button"
          className={cn(
            'relative z-[45] flex h-[42px] w-[42px] items-center justify-center rounded-[12px] bg-white text-ink transition-shadow hover:shadow-[0_4px_12px_rgba(47,79,68,.12)]',
            bordered && 'border border-mint-3',
          )}
        >
          <IconFilter size={18} />
          {activeCount > 0 && (
            <span className="tabular absolute -top-1.5 -left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
      )}
      {exportUrl && (
        <button
          type="button"
          onClick={() => setPop(pop === 'download' ? null : 'download')}
          title="تنزيل التقرير"
          aria-label="تنزيل التقرير"
          aria-expanded={pop === 'download'}
          data-testid="download-button"
          className="relative z-[45] flex h-[42px] w-[42px] items-center justify-center rounded-[12px] bg-ink text-white transition-transform hover:-translate-y-px"
        >
          {busy ? <Spinner /> : <IconDownload size={18} />}
        </button>
      )}
      {pop === 'filter' && filters && (
        <div className="absolute top-[50px] left-0 z-[46] flex w-[min(320px,calc(100vw-32px))] animate-pop flex-col gap-3.5 rounded-[16px] border border-line bg-white p-3.5 shadow-[0_16px_40px_rgba(47,79,68,.16)]" role="dialog" aria-label="الفلاتر">
          {filters}
        </div>
      )}
      {pop === 'download' && exportUrl && (
        <div className="absolute top-[50px] left-0 z-[46] flex w-[210px] animate-pop flex-col gap-0.5 rounded-[16px] border border-line bg-white p-2 shadow-[0_16px_40px_rgba(47,79,68,.16)]" role="menu">
          <button type="button" role="menuitem" onClick={() => doExport('pdf')} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-right text-[13.5px] hover:bg-mint-5" data-testid="export-pdf">
            <span className="rounded-[6px] bg-err-bg px-1.5 py-0.5 text-[11px] font-bold text-err-ink">PDF</span>
            تنزيل بصيغة PDF
          </button>
          <button type="button" role="menuitem" onClick={() => doExport('xlsx')} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-right text-[13.5px] hover:bg-mint-5" data-testid="export-xlsx">
            <span className="rounded-[6px] bg-ok-bg px-1.5 py-0.5 text-[11px] font-bold text-ok-ink">XLS</span>
            تنزيل بصيغة Excel
          </button>
        </div>
      )}
    </div>
  );
}

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-bold text-muted">{label}</div>
      {children}
    </div>
  );
}

/** تحكم مقطعي (الفترة / نوع التقييم) */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
  testId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
  testId?: string;
}) {
  return (
    <div
      className="grid gap-1 rounded-[11px] bg-page p-1"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
      role="radiogroup"
      data-testid={testId}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className="min-h-9 rounded-[8px] px-1 py-2 text-[13px] transition-colors"
            style={{ background: on ? '#2F4F44' : 'transparent', color: on ? '#FFFFFF' : '#44665A', fontWeight: on ? 600 : 500 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder = 'الكل',
  testId,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-bold text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-testid={testId}
        className="min-h-11 rounded-[11px] border border-line bg-white px-3 text-[13.5px] text-ink outline-ink disabled:bg-page"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
