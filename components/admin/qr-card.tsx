import { Decor } from '@/components/ui/decor';
import { Logo } from '@/components/ui/logo';

/** بطاقة رمز QR (نفس التصميم للعرض والطباعة) */
export function QrCardFace({ svg, name, location, displayUrl, qrSize = 120 }: { svg: string; name: string; location: string; displayUrl: string; qrSize?: number }) {
  return (
    <>
      <div className="relative isolate flex w-full justify-center overflow-hidden bg-brand px-3 pt-4 pb-[46px]">
        <Decor variant="card" />
        <Logo size="sm" className="relative z-[1]" />
      </div>
      <div className="relative -mt-8 rounded-[18px] bg-white p-3 shadow-[0_10px_24px_-12px_rgba(47,79,68,.35)]">
        <span className="absolute top-1 right-1 h-4 w-4 rounded-tr-[8px] border-t-[3px] border-r-[3px] border-brand" aria-hidden />
        <span className="absolute top-1 left-1 h-4 w-4 rounded-tl-[8px] border-t-[3px] border-l-[3px] border-brand" aria-hidden />
        <span className="absolute right-1 bottom-1 h-4 w-4 rounded-br-[8px] border-r-[3px] border-b-[3px] border-brand" aria-hidden />
        <span className="absolute bottom-1 left-1 h-4 w-4 rounded-bl-[8px] border-b-[3px] border-l-[3px] border-brand" aria-hidden />
        <div className="block p-[3px] [&>svg]:block [&>svg]:h-full [&>svg]:w-full" style={{ width: qrSize, height: qrSize }} dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`رمز QR لتقييم ${name}`} />
      </div>
      <div className="flex w-full flex-col items-center gap-2 px-4 pt-3 pb-1">
        <span className="rounded-full bg-ok-bg px-3 py-[3px] text-[12px] font-semibold text-ok-ink">امسح لتقييم النظافة</span>
        <div>
          <div className="text-[14.5px] font-bold text-ink">{name}</div>
          <div className="text-[12.5px] text-muted">{location}</div>
        </div>
        <div className="max-w-full font-mono text-[11px] break-all text-muted" dir="ltr">
          {displayUrl}
        </div>
      </div>
    </>
  );
}
