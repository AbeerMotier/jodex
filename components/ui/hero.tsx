import type { ReactNode } from 'react';
import { Decor } from './decor';
import { cn } from './cn';

/** بطاقة الرأس الخضراء (#55957A، زوايا 24px، دوائر زخرفية) */
export function GreenHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'relative isolate animate-pop overflow-hidden rounded-[24px] bg-brand text-white shadow-[0_16px_36px_rgba(47,79,68,.18)]',
        className,
      )}
    >
      <Decor variant="hero" />
      <div className="relative z-[1]">{children}</div>
    </section>
  );
}

export function InfoTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-white/20 bg-white/[.12] px-3 py-2.5 backdrop-blur-[8px]">
      <div className="text-[11.5px] text-white">{label}</div>
      <div className="mt-0.5 text-[14.5px] font-semibold">{value}</div>
    </div>
  );
}

export function Avatar({ name, size = 52, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex flex-none items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {name.trim().charAt(0)}
    </span>
  );
}
