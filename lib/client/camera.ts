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

/** إطار من البث الحي إلى canvas (بالأبعاد الفعلية للبث) */
export function grabFrame(video: HTMLVideoElement, maxDimension = 1920): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxDimension / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** متوسط الإضاءة (0–255) لعينة مصغرة من الصورة */
export function averageBrightness(canvas: HTMLCanvasElement): number {
  const sample = document.createElement('canvas');
  sample.width = 32;
  sample.height = 32;
  const ctx = sample.getContext('2d');
  if (!ctx) return 255;
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}
