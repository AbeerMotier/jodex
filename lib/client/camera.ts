'use client';
import { useEffect, useRef, useState } from 'react';

export type CameraError = 'unsupported' | 'denied' | 'unavailable';

export const CAMERA_ERROR_MESSAGE: Record<CameraError, string> = {
  unsupported: 'المتصفح لا يدعم فتح الكاميرا من الصفحة. افتح الرابط في متصفح حديث (Chrome أو Safari) عبر اتصال آمن.',
  denied: 'لم يُسمح باستخدام الكاميرا. اسمح للمتصفح باستخدام الكاميرا من إعدادات الموقع ثم أعد المحاولة.',
  unavailable: 'تعذّر تشغيل الكاميرا. تأكد أن تطبيقًا آخر لا يستخدمها ثم أعد المحاولة.',
};

/**
 * بث الكاميرا الحي (الخلفية افتراضيًا) في عنصر video. يُوقف البث عند الإغلاق أو مغادرة الصفحة.
 * الصورة الملتقطة من البث لا يمكن أن تكون صورة محفوظة على الجهاز.
 */
export function useCameraStream(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  // حالة كل تشغيل مرتبطة برقم محاولته، فلا تبقى حالة تشغيل سابق بعد إعادة الفتح
  const [status, setStatus] = useState<{ attempt: number; error: CameraError | null; ready: boolean }>({ attempt: -1, error: null, ready: false });

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const video = videoRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => !cancelled && setStatus({ attempt, error: 'unsupported', ready: false }));
      return () => {
        cancelled = true;
      };
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = s;
        try {
          await el.play();
        } catch {
          /* بعض المتصفحات تبدأ التشغيل تلقائيًا */
        }
        if (!cancelled) setStatus({ attempt, error: null, ready: true });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setStatus({ attempt, error: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable', ready: false });
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [active, attempt]);

  const current = active && status.attempt === attempt;
  return {
    videoRef,
    error: current ? status.error : null,
    ready: current ? status.ready : false,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** الشاشة عمودية (اتجاه واجهة الصفحة) */
function screenIsPortrait(): boolean {
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  if (type) return type.startsWith('portrait');
  return window.matchMedia?.('(orientation: portrait)').matches ?? window.innerHeight >= window.innerWidth;
}

/**
 * البث وصل بغير اتجاه الشاشة (عرضي والجوال عمودي): يحدث في بعض أجهزة iPhone
 * إذ تصل إطارات الكاميرا بلا تدوير، فتظهر الصورة الطولية بالعرض.
 */
export function streamIsSideways(video: HTMLVideoElement | null): boolean {
  if (!video?.videoWidth || !video.videoHeight) return false;
  return video.videoWidth > video.videoHeight && screenIsPortrait();
}

/** يرسم مصدرًا على canvas مع تدوير ربع دورة (1 = مع عقارب الساعة، -1 = عكسها، 0 = بلا تدوير) */
function drawRotated(source: CanvasImageSource, w: number, h: number, quarter: -1 | 0 | 1, maxDimension: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxDimension / Math.max(w, h));
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = quarter ? sh : sw;
  canvas.height = quarter ? sw : sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (quarter === 1) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (quarter === -1) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0, sw, sh);
  return canvas;
}

/** إطار من البث الحي إلى canvas بالاتجاه الصحيح (يصحّح البث العرضي والجوال عمودي) */
export function grabFrame(video: HTMLVideoElement, maxDimension = 1920): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  return drawRotated(video, w, h, streamIsSideways(video) ? -1 : 0, maxDimension);
}

/** تدوير صورة ملتقطة ربع دورة مع عقارب الساعة (زر «تدوير» في المعاينة) */
export async function rotateBlob(blob: Blob, maxDimension = 1920): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  const canvas = drawRotated(bitmap, bitmap.width, bitmap.height, 1, maxDimension);
  bitmap.close();
  if (!canvas) return null;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
