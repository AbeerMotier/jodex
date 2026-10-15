import type { FeedbackRating } from '@/lib/domain/catalog';

/** وجوه التقييم بالألوان المعتمدة */
export const FACE_STYLE: Record<FeedbackRating, { fill: string; ink: string; ring: string; mouth: string; msgBg: string }> = {
  excellent: { fill: '#BFE6D2', ink: '#0B2B45', ring: '#2E9E6B', mouth: 'M7.5 14 Q12 19.5 16.5 14', msgBg: '#E8F6EF' },
  good: { fill: '#F7E3A6', ink: '#5A4210', ring: '#E3C068', mouth: 'M8.5 15.5 H15.5', msgBg: '#FBF4E1' },
  bad: { fill: '#F6C9C6', ink: '#7A2522', ring: '#D9534F', mouth: 'M7.5 17.5 Q12 12.8 16.5 17.5', msgBg: '#FBE9E8' },
};

export function Face({ rating, size = 24, className }: { rating: FeedbackRating; size?: number | string; className?: string }) {
  const f = FACE_STYLE[rating];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <circle cx="12" cy="12" r="12" fill={f.fill} />
      <circle cx="8.6" cy="10" r="1.25" fill={f.ink} />
      <circle cx="15.4" cy="10" r="1.25" fill={f.ink} />
      <path d={f.mouth} fill="none" stroke={f.ink} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** أيقونة صفحة الشكر: وجه مبتسم لـ«ممتاز»، علامة صح لـ«جيد» و«سيئ» */
export function ThanksBadge({ rating }: { rating: FeedbackRating }) {
  const happy = rating === 'excellent';
  const fill = happy ? '#BFE6D2' : '#E6F2EA';
  const ink = happy ? '#0B2B45' : '#3F7A62';
  const halo = happy ? 'rgba(46,158,107,.12)' : 'rgba(85,149,122,.10)';
  const halo2 = happy ? 'rgba(46,158,107,.18)' : 'rgba(85,149,122,.16)';
  return (
    <div className="relative mx-auto mb-[22px] flex h-[220px] w-[220px] items-center justify-center" aria-hidden>
      <span className="absolute inset-0 animate-[pop_.6s_ease_.05s_both] rounded-full" style={{ background: halo }} />
      <span className="absolute inset-[22px] animate-[pop_.6s_ease_.15s_both] rounded-full" style={{ background: halo2 }} />
      <div
        className="relative flex h-[140px] w-[140px] animate-[pop_.55s_cubic-bezier(.2,.8,.3,1)_.25s_both] items-center justify-center rounded-full shadow-[0_14px_30px_-12px_rgba(20,35,30,.35)]"
        style={{ background: fill }}
      >
        {happy ? (
          <svg viewBox="0 0 24 24" width="92" height="92">
            <path d="M6.6 9.6 Q8.2 7.6 9.8 9.6" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M14.2 9.6 Q15.8 7.6 17.4 9.6" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
            <path d="M7 13 H17 Q16.4 18.2 12 18.2 Q7.6 18.2 7 13 Z" fill={ink} />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="76" height="76">
            <path
              d="M6 12.5l4 4 8-9"
              fill="none"
              stroke={ink}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="40"
              style={{ animation: 'drawCheck .5s ease .35s both' }}
            />
          </svg>
        )}
      </div>
    </div>
  );
}
