'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/overlay';
import { averageBrightness, CAMERA_ERROR_MESSAGE, grabFrame, useCameraStream } from '@/lib/client/camera';

const DARK_THRESHOLD = 60;

const LABOR_TIPS = [
  'أمسك الجوال عموديًا (طوليًا) وصوّر العامل بكامل هيئته من الرأس إلى القدمين.',
  'صوّر في مكان جيد الإضاءة، ولا تجعل مصدر الضوء أو النافذة خلف العامل.',
  'ثبّت يدك حتى تكون الصورة واضحة غير مهتزة، وعلى مسافة مترين تقريبًا.',
  'يظهر الزي الرسمي وأدوات العمل بوضوح، ودورة المياه في الخلفية.',
];
const PLACE_TIPS = [
  'أمسك الجوال عموديًا (طوليًا) واجعل المكان المطلوب كاملًا داخل الإطار.',
  'صوّر في إضاءة جيدة، وشغّل إنارة دورة المياه إن كانت مطفأة.',
  'ثبّت يدك حتى تكون الصورة واضحة غير مهتزة.',
  'التقط الصورة الآن وقت الجولة؛ لا تُقبل صورة سابقة.',
];

/** رسم توضيحي لصورة صحيحة/خاطئة (بلا صور خارجية) */
function Example({ kind }: { kind: 'good' | 'landscape' | 'dark' | 'blurry' }) {
  const good = kind === 'good';
  const landscape = kind === 'landscape';
  const w = landscape ? 96 : 64;
  const h = landscape ? 64 : 96;
  const bg = kind === 'dark' ? '#3B4743' : '#EAF3EC';
  const figure = kind === 'dark' ? '#55605B' : '#2F4F44';
  return (
    <figure className="m-0 flex flex-col items-center gap-1.5">
      <div className="flex h-[104px] items-center justify-center">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ filter: kind === 'blurry' ? 'blur(1.6px)' : undefined }}>
          <rect x="1" y="1" width={w - 2} height={h - 2} rx="8" fill={bg} stroke={good ? '#55957A' : '#E37452'} strokeWidth="2" />
          <g transform={`translate(${w / 2} ${landscape ? h / 2 + 4 : h / 2 + 6})`} fill={figure}>
            <circle cx="0" cy={landscape ? -18 : -28} r={landscape ? 6 : 9} />
            <rect x={landscape ? -8 : -12} y={landscape ? -11 : -17} width={landscape ? 16 : 24} height={landscape ? 22 : 34} rx="5" />
            <rect x={landscape ? -7 : -10} y={landscape ? 11 : 17} width={landscape ? 5 : 8} height={landscape ? 12 : 18} rx="2" />
            <rect x={landscape ? 2 : 2} y={landscape ? 11 : 17} width={landscape ? 5 : 8} height={landscape ? 12 : 18} rx="2" />
          </g>
        </svg>
      </div>
      <figcaption className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: good ? '#3F7A62' : '#B5512F' }}>
        <span aria-hidden>{good ? '✓' : '✗'}</span>
        {good ? 'صحيحة: عمودية وواضحة' : kind === 'landscape' ? 'خاطئة: أفقية' : kind === 'dark' ? 'خاطئة: مظلمة' : 'خاطئة: مهتزة'}
      </figcaption>
    </figure>
  );
}

/**
 * التقاط صورة العمالة: تعليمات التصوير أولًا، ثم بث الكاميرا الحي والالتقاط منه مباشرة.
 * لا يوجد أي خيار لاختيار صورة محفوظة من الجهاز.
 */
export function CameraCapture({
  open,
  title,
  worker = false,
  onClose,
  onCapture,
}: {
  open: boolean;
  title: string;
  /** صورة العمالة: تعليمات تصوير العامل؛ وإلا تعليمات تصوير المكان */
  worker?: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
}) {
  const [step, setStep] = useState<'guide' | 'camera' | 'review'>('guide');
  const [shot, setShot] = useState<{ blob: Blob; url: string; landscape: boolean; dark: boolean } | null>(null);
  const [openedAt, setOpenedAt] = useState(false);
  const { videoRef, error, ready, retry } = useCameraStream(open && step === 'camera');

  // كل فتح جديد يبدأ بالتعليمات
  if (open && !openedAt) {
    setOpenedAt(true);
    setStep('guide');
    setShot(null);
  } else if (!open && openedAt) {
    setOpenedAt(false);
  }

  function close() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    onClose();
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = grabFrame(video);
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return;
    setShot({ blob, url: URL.createObjectURL(blob), landscape: canvas.width > canvas.height, dark: averageBrightness(canvas) < DARK_THRESHOLD });
    setStep('review');
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setStep('camera');
  }

  function accept() {
    if (!shot) return;
    const blob = shot.blob;
    URL.revokeObjectURL(shot.url);
    setShot(null);
    onCapture(blob);
  }

  return (
    <Modal open={open} onClose={close} title={title} subtitle="التقاط مباشر بالكاميرا فقط" width={520}>
      {step === 'guide' && (
        <div className="flex flex-col gap-3.5 pb-3" data-testid="camera-guide">
          <div className="text-[14px] font-bold">قبل التصوير: طريقة التقاط صورة صحيحة</div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px] leading-[1.7]">
            {(worker ? LABOR_TIPS : PLACE_TIPS).map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-[3px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-ok-bg text-[11px] font-bold text-ok-ink" aria-hidden>
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 rounded-[14px] bg-[#F6F9F7] p-3 sm:grid-cols-4">
            <Example kind="good" />
            <Example kind="landscape" />
            <Example kind="dark" />
            <Example kind="blurry" />
          </div>
          <div className="rounded-[10px] bg-[#FBF4E1] px-3 py-2 text-[12.5px] text-[#7A5B14]">لا يمكن رفع صورة محفوظة على الجهاز؛ تُلتقط الصورة الآن من الكاميرا.</div>
          <button type="button" onClick={() => setStep('camera')} className="touch-target rounded-[12px] bg-brand px-4 py-3 text-[15px] font-semibold text-white" data-testid="camera-start">
            فهمت، افتح الكاميرا
          </button>
        </div>
      )}

      {step === 'camera' && (
        <div className="flex flex-col gap-3 pb-3" data-testid="camera-live">
          {error ? (
            <div className="flex flex-col gap-2.5 rounded-[12px] bg-err-bg px-3.5 py-3 text-[13.5px] leading-[1.7] text-err-ink" role="alert">
              {CAMERA_ERROR_MESSAGE[error]}
              <button type="button" onClick={retry} className="self-start font-bold underline underline-offset-2">
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[360px] overflow-hidden rounded-[16px] bg-[#1E2B27]">
              <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" data-testid="camera-video" />
              <span className="pointer-events-none absolute inset-[8%] rounded-[14px] border-2 border-dashed border-white/70" aria-hidden />
              {!ready && <span className="absolute inset-0 flex items-center justify-center text-[13px] text-white">جارٍ تشغيل الكاميرا…</span>}
            </div>
          )}
          <div className="text-center text-[12.5px] text-muted">{worker ? 'اجعل العامل داخل الإطار والجوال عموديًا.' : 'اجعل المكان داخل الإطار والجوال عموديًا.'}</div>
          <button
            type="button"
            onClick={capture}
            disabled={!ready}
            className="touch-target rounded-[12px] bg-brand px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
            data-testid="camera-shoot"
          >
            التقاط الصورة
          </button>
        </div>
      )}

      {step === 'review' && shot && (
        <div className="flex flex-col gap-3 pb-3" data-testid="camera-review">
          {/* eslint-disable-next-line @next/next/no-img-element -- معاينة محلية لصورة ملتقطة */}
          <img src={shot.url} alt="معاينة الصورة الملتقطة" className="mx-auto max-h-[420px] w-auto max-w-full rounded-[14px] border border-line object-contain" />
          {(shot.landscape || shot.dark) && (
            <div className="rounded-[10px] bg-[#FBF4E1] px-3 py-2 text-[12.5px] leading-[1.7] text-[#7A5B14]" role="status" data-testid="camera-quality-warning">
              {shot.landscape && 'الصورة أفقية؛ الأفضل إعادة الالتقاط والجوال عمودي. '}
              {shot.dark && 'الصورة مظلمة؛ انتقل لمكان أفضل إضاءة وأعد الالتقاط.'}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={retake} className="touch-target rounded-[12px] border border-line bg-white px-4 py-3 text-[14.5px] font-semibold text-ink" data-testid="camera-retake">
              إعادة الالتقاط
            </button>
            <button type="button" onClick={accept} className="touch-target rounded-[12px] bg-brand px-4 py-3 text-[14.5px] font-semibold text-white" data-testid="camera-accept">
              اعتماد الصورة
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
