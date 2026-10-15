import { scoreColor } from '@/lib/domain/format';
import { cn } from './cn';

/** شريط تقدم 5–6px */
export function Bar({
  value,
  color,
  height = 6,
  track = '#EDF2EF',
  className,
}: {
  value: number | null;
  color?: string;
  height?: number;
  track?: string;
  className?: string;
}) {
  const v = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className={cn('block w-full overflow-hidden rounded-[3px]', className)} style={{ height, background: track }}>
      <span
        className="origin-bar block h-full animate-grow-x rounded-[3px]"
        style={{ width: `${v}%`, background: color ?? scoreColor(value), transition: 'width .5s ease' }}
      />
    </span>
  );
}
