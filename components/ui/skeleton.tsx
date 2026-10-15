import { cn } from './cn';

/** هيكل تحميل رمادي فاتح بنفس أبعاد البطاقات */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn('skeleton rounded-[12px]', className)} style={style} />;
}

export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn('rounded-[18px] border border-line bg-white p-[18px]', className)} aria-busy="true" aria-label="جارٍ التحميل">
      <Skeleton className="mb-4 h-5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="mb-3 h-10 w-full" />
      ))}
    </div>
  );
}
