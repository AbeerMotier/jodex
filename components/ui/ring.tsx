import { fmtPct, scoreColor } from '@/lib/domain/format';

/** حلقة تقدم دائرية (ringDraw) — اللون حسب النتيجة ما لم يُحدَّد */
export function Ring({
  value,
  size = 80,
  stroke = 3.8,
  track = '#FFFFFF',
  color,
  label,
  sublabel,
  textClass = 'text-[15px]',
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  track?: string;
  color?: string;
  label?: string;
  sublabel?: string;
  textClass?: string;
}) {
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const c = color ?? scoreColor(v);
  return (
    <div className="relative flex-none" style={{ width: size, height: size }} role="img" aria-label={`${sublabel ?? ''} ${fmtPct(v)}`.trim()}>
      <svg viewBox="0 0 36 36" width={size} height={size} className="block">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={c}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={v === null ? 100 : 100 - v}
          transform="rotate(-90 18 18)"
          className="ring-draw"
          style={{ ['--ring-circumference' as string]: '100', transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <span className="tabular absolute inset-0 flex flex-col items-center justify-center leading-[1.15]">
        <span className={`${textClass} font-bold`}>{label ?? fmtPct(v)}</span>
        {sublabel && <span className="text-[10px] text-muted">{sublabel}</span>}
      </span>
    </div>
  );
}
