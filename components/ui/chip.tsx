import type { ReactNode } from 'react';
import type { Role, Tone } from '@/lib/domain/catalog';
import { ROLE_LABEL } from '@/lib/domain/catalog';
import { cn } from './cn';

export const TONE_COLORS: Record<Tone | 'monitor' | 'supervisor' | 'brand', { bg: string; c: string }> = {
  success: { bg: '#E6F2EA', c: '#3F7A62' },
  warning: { bg: '#FBF4E1', c: '#94711C' },
  error: { bg: '#FCEDE7', c: '#B5512F' },
  neutral: { bg: '#EAF3EC', c: '#44665A' },
  brand: { bg: '#E6F2EA', c: '#3F7A62' },
  // ألوان فئة المستخدم: مراقب المقاول أزرق، المشرف الميداني أحمر
  monitor: { bg: '#E4EEF8', c: '#1F5F99' },
  supervisor: { bg: '#F8E4E4', c: '#A12B2B' },
};

type ChipTone = keyof typeof TONE_COLORS;

export function Chip({
  tone = 'neutral',
  size = 'md',
  dot = false,
  children,
  className,
  ...rest
}: {
  tone?: ChipTone;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  dot?: boolean;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const t = TONE_COLORS[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
        size === 'xs' && 'px-2 py-px text-[10.5px] font-bold',
        size === 'sm' && 'px-[9px] py-0.5 text-[11px]',
        size === 'md' && 'px-2.5 py-[3px] text-[12px]',
        size === 'lg' && 'px-3.5 py-1.5 text-[13px] font-bold',
        className,
      )}
      style={{ background: t.bg, color: t.c }}
      {...rest}
    >
      {dot && <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: t.c }} />}
      {children}
    </span>
  );
}

/** شارة الدور: مكتوبة بالنص دائمًا وبلون الفئة (مراقب = أزرق، مشرف = أحمر) */
export function RoleChip({ role, size = 'xs' }: { role: Role; size?: 'xs' | 'sm' | 'md' }) {
  const tone = role === 'supervisor' ? 'supervisor' : role === 'contractor_monitor' ? 'monitor' : 'neutral';
  return (
    <Chip tone={tone} size={size} data-role-chip={role}>
      {ROLE_LABEL[role]}
    </Chip>
  );
}
