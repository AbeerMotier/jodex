'use client';
/**
 * ضغط الصورة على العميل قبل الرفع (أبعاد قصوى 1920px، JPEG 0.82).
 * إعادة الترميز عبر canvas تُسقط بيانات EXIF/GPS أيضًا. الخادم يعيد التحقق والتطبيع دائمًا.
 */
const MAX_DIMENSION = 1920;

export const ACCEPTED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', ''];

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_MIME.includes(file.type) ? (file.type !== '' || ACCEPTED_EXT.test(file.name)) : false;
}

export async function compressImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    // مثل HEIC في متصفحات لا تدعمه: يُرفع الأصل ويحوّله الخادم
    return file;
  }
}
