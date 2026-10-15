import type { ReactNode } from 'react';

export function PageHeader({ title, actions, sub }: { title: string; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="relative z-40 flex animate-fade-up flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="m-0 text-[24px] font-bold">{title}</h1>
        {sub && <div className="mt-1 text-[12.5px] text-muted">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}

export function ActiveFilters({ items, onClear }: { items: string[]; onClear: () => void }) {
  if (items.length === 0) return null;
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="active-filters">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-mint-4 px-2.5 py-1 font-semibold text-ok-ink">
          {t}
        </span>
      ))}
      <button type="button" onClick={onClear} className="px-1.5 py-1 font-semibold text-muted underline underline-offset-2">
        مسح الفلاتر
      </button>
    </div>
  );
}
