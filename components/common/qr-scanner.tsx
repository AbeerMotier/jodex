'use client';
import jsQR from 'jsqr';
import { useEffect, useRef } from 'react';
import { CAMERA_ERROR_MESSAGE, useCameraStream } from '@/lib/client/camera';

/** نص رمز QR لدورة مياه: الترميز فقط (مثل 100-HMR-HQ1003-00-0001) */
export const RESTROOM_CODE_PATTERN = /^[A-Z0-9-]{2,40}$/;

/** يستخرج ترميز دورة المياه من نص الرمز (الترميز نفسه، أو رابط قديم ينتهي بالترميز أو الرمز العشوائي) */
export function restroomRefFromQr(text: string): string | null {
  const t = text.trim();
  if (RESTROOM_CODE_PATTERN.test(t)) return t;
  const m = t.match(/\/(?:r|go)\/([A-Za-z0-9_-]{2,128})\/?$/);
  return m ? m[1] : null;
}

/**
 * ماسح رمز QR من بث الكاميرا الحي (يعمل في كل المتصفحات الحديثة عبر jsQR).
 * يستدعي onResult مرة واحدة عند قراءة رمز صالح.
 */
export function QrScanner({ active, onResult, hint }: { active: boolean; onResult: (ref: string) => void; hint?: string }) {
  const { videoRef, error, ready, retry } = useCameraStream(active);
  const done = useRef(false);
  const callback = useRef(onResult);
  useEffect(() => {
    callback.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!active || !ready) return;
    done.current = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const video = videoRef.current;
      if (done.current || !video || !ctx) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        const scale = Math.min(1, 640 / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        const ref = code?.data ? restroomRefFromQr(code.data) : null;
        if (ref) {
          done.current = true;
          callback.current(ref);
          return;
        }
      }
      timer = setTimeout(tick, 180);
    };
    tick();
    return () => clearTimeout(timer);
  }, [active, ready, videoRef]);

  if (error) {
    return (
      <div className="flex flex-col gap-2.5 rounded-[12px] bg-err-bg px-3.5 py-3 text-[13.5px] leading-[1.7] text-err-ink" role="alert" data-testid="scanner-error">
        {CAMERA_ERROR_MESSAGE[error]}
        <button type="button" onClick={retry} className="self-start font-bold underline underline-offset-2">
          إعادة المحاولة
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="qr-scanner">
      <div className="relative mx-auto aspect-square w-full max-w-[340px] overflow-hidden rounded-[18px] bg-[#1E2B27]">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <span className="pointer-events-none absolute inset-[16%] rounded-[16px] border-[3px] border-white/80" aria-hidden />
        {!ready && <span className="absolute inset-0 flex items-center justify-center text-[13px] text-white">جارٍ تشغيل الكاميرا…</span>}
      </div>
      <div className="text-center text-[12.5px] text-muted">{hint ?? 'وجّه الكاميرا إلى رمز QR الملصق على دورة المياه.'}</div>
    </div>
  );
}
