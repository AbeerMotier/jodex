import type { ReactNode } from 'react';
import { cn } from './cn';

/** بطاقة بيضاء بزوايا 18–20px وحد 1px #E3EAE6 */
export function Card({
  children,
  className,
  as: Tag = 'section',
  ...rest
}: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn('rounded-[18px] border border-line bg-white', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHeader({ title, aside, className }: { title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2.5', className)}>
      <h2 className="m-0 text-[17px] font-bold">{title}</h2>
      {aside && <span className="text-[13px] whitespace-nowrap text-muted">{aside}</span>}
    </div>
  );
}

export function MissingList({ items, title = 'قبل الإرسال:' }: { items: string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-[12px] bg-mint-5 px-3.5 py-3 text-[13.5px] text-ink-2" data-testid="missing-list" role="status">
      <span className="font-semibold text-ink">{title}</span>
      {items.map((m) => (
        <span key={m}>• {m}</span>
      ))}
    </div>
  );
}

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('animate-[fadeIn_.2s_ease_both] rounded-[10px] bg-err-bg px-3 py-2.5 text-[13px] text-err-ink', className)}>
      {children}
    </div>
  );
}
