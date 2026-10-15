'use client';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'disabled-look';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }
>(function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'touch-target inline-flex items-center justify-center gap-2 font-semibold transition-[transform,box-shadow,background-color] duration-150 enabled:hover:-translate-y-px disabled:cursor-not-allowed',
        size === 'sm' && 'rounded-[9px] px-3.5 py-[7px] text-[13px]',
        size === 'md' && 'rounded-[11px] px-[18px] py-3 text-[14.5px]',
        size === 'lg' && 'w-full rounded-[13px] p-[15px] text-[16px]',
        variant === 'primary' && 'bg-brand text-white enabled:hover:shadow-[0_6px_16px_rgba(47,79,68,.2)]',
        variant === 'dark' && 'bg-ink text-white enabled:hover:shadow-[0_6px_14px_rgba(47,79,68,.22)]',
        variant === 'outline' && 'border border-line bg-white text-ink enabled:hover:border-[#8FB8A2]',
        variant === 'ghost' && 'bg-transparent text-ink enabled:hover:bg-mint-5',
        variant === 'danger' && 'border border-err-line bg-err-bg text-err-ink',
        variant === 'disabled-look' && 'bg-disabled text-white',
        (disabled || loading) && variant !== 'disabled-look' && 'opacity-70',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
