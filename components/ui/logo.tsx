import { cn } from './cn';

const SIZES = {
  sm: { font: 26, lens: 20, border: 4, inset: 6, hw: 4, hh: 9, hr: -1, hb: -5, ar: 13, track: -1 },
  md: { font: 40, lens: 30, border: 6, inset: 9, hw: 6, hh: 13, hr: -2, hb: -8, ar: 19, track: -1.5 },
  lg: { font: 46, lens: 34, border: 7, inset: 10, hw: 7, hh: 15, hr: -2, hb: -9, ar: 22, track: -1.5 },
} as const;

/** شعار «Jodex»: حرف o عدسة مكبرة (حلقة بيضاء، مركز #C5E2CC، مقبض مائل) وتحته «جُودِكس» — يُستخدم على الأخضر */
export function Logo({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <div aria-label="جُودِكس JODEX" role="img" className={cn('flex flex-col items-center gap-0.5 text-white', className)}>
      <div
        dir="ltr"
        className="flex items-center font-bold leading-none"
        style={{ fontSize: s.font, letterSpacing: s.track }}
        aria-hidden
      >
        <span>J</span>
        <span className="relative flex-none" style={{ width: s.lens, height: s.lens, margin: '0 2px 0 1px' }}>
          <span className="absolute inset-0 rounded-full border-solid border-white" style={{ borderWidth: s.border }} />
          <span className="absolute rounded-full bg-mint-2" style={{ inset: s.inset }} />
          <span
            className="absolute bg-white"
            style={{ width: s.hw, height: s.hh, borderRadius: s.hw / 2, right: s.hr, bottom: s.hb, transform: 'rotate(-42deg)' }}
          />
        </span>
        <span>dex</span>
      </div>
      <span className="font-bold leading-[1.4]" style={{ fontSize: s.ar }} aria-hidden>
        جُودِكس
      </span>
    </div>
  );
}
