/** دوائر زخرفية شفافة بحد أبيض فوق الخلفيات الخضراء */
const SETS = {
  hero: [
    { w: 260, h: 260, left: -120, top: -40, a: 0.35 },
    { w: 300, h: 200, right: -150, top: 30, a: 0.3 },
    { w: 180, h: 180, left: '40%', top: -130, a: 0.25 },
  ],
  card: [
    { w: 160, h: 160, left: -70, top: -60, a: 0.35 },
    { w: 140, h: 110, right: -60, top: 10, a: 0.3 },
  ],
  sidebar: [
    { w: 260, h: 260, left: -120, top: -40, a: 0.35 },
    { w: 300, h: 200, right: -150, top: '30%', a: 0.3 },
    { w: 280, h: 280, left: -140, top: '55%', a: 0.28 },
    { w: 240, h: 240, right: -110, bottom: -100, a: 0.3 },
  ],
} as const;

type Ring = { w: number; h: number; left?: number | string; right?: number | string; top?: number | string; bottom?: number | string; a: number };

export function Decor({ variant = 'hero' }: { variant?: keyof typeof SETS }) {
  return (
    <>
      {(SETS[variant] as readonly Ring[]).map((r, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute -z-0 rounded-full"
          style={{
            width: r.w,
            height: r.h,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            border: `1.2px solid rgba(255,255,255,${r.a})`,
          }}
        />
      ))}
    </>
  );
}
