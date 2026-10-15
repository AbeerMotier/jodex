import 'server-only';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES } from '@/lib/domain/catalog';
import { ApiError } from './http';
import { createServiceClient } from './supabase';

export const PHOTO_BUCKET = 'photos';
/** مدة صلاحية الروابط الموقّعة للصور (ثوانٍ) */
export const SIGNED_URL_TTL = 300;

const ACCEPTED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export const PHOTO_ERRORS = {
  missing: 'اختر صورة لرفعها.',
  empty: 'الملف فارغ.',
  tooLarge: 'حجم الصورة يتجاوز الحد المسموح (10 ميجابايت).',
  type: 'نوع الملف غير مسموح. الأنواع المسموحة: JPEG وPNG وWebP وHEIC.',
  corrupt: 'تعذّر قراءة الصورة. جرّب صورة أخرى.',
  upload: 'تعذّر حفظ الصورة. أعد رفع الخانة.',
} as const;

/** قراءة ملف الصورة من طلب multipart مع التحقق من الحجم قبل القراءة */
export async function readUploadedFile(req: Request): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_PHOTO_BYTES + 512 * 1024) throw new ApiError(413, 'too_large', PHOTO_ERRORS.tooLarge);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, 'bad_form', PHOTO_ERRORS.missing);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new ApiError(422, 'missing_file', PHOTO_ERRORS.missing);
  if (file.size === 0) throw new ApiError(422, 'empty_file', PHOTO_ERRORS.empty);
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_large', PHOTO_ERRORS.tooLarge);
  return Buffer.from(await file.arrayBuffer());
}

/**
 * تحقق النوع من البصمة الثنائية (لا من الامتداد)، تحويل HEIC إلى JPEG،
 * تصحيح الاتجاه، تصغير الأبعاد، وإعادة الترميز دون أي بيانات وصفية (EXIF/GPS).
 */
export async function normalizePhoto(input: Buffer): Promise<{ buffer: Buffer; mime: 'image/jpeg'; size: number }> {
  if (input.length === 0) throw new ApiError(422, 'empty_file', PHOTO_ERRORS.empty);
  if (input.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_large', PHOTO_ERRORS.tooLarge);
  const { fileTypeFromBuffer } = await import('file-type');
  const type = await fileTypeFromBuffer(input);
  if (!type || !ACCEPTED.has(type.mime)) throw new ApiError(415, 'unsupported_type', PHOTO_ERRORS.type);
  let source = input;
  if (type.mime.startsWith('image/hei')) {
    try {
      const { default: heicConvert } = await import('heic-convert');
      const converted = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
      source = Buffer.isBuffer(converted) ? converted : Buffer.from(new Uint8Array(converted));
    } catch {
      throw new ApiError(422, 'corrupt', PHOTO_ERRORS.corrupt);
    }
  }
  try {
    const data = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { buffer: data, mime: 'image/jpeg', size: data.length };
  } catch {
    throw new ApiError(422, 'corrupt', PHOTO_ERRORS.corrupt);
  }
}

export async function storePhoto(key: string, buffer: Buffer, mime: string) {
  const { error } = await createServiceClient()
    .storage.from(PHOTO_BUCKET)
    .upload(key, buffer, { contentType: mime, upsert: false, cacheControl: '300' });
  if (error) {
    console.error('[jodex] storage upload failed', error.message);
    throw new ApiError(502, 'upload_failed', PHOTO_ERRORS.upload);
  }
}

export async function removePhotos(keys: string[]) {
  if (keys.length === 0) return;
  const { error } = await createServiceClient().storage.from(PHOTO_BUCKET).remove(keys);
  if (error) console.error('[jodex] storage remove failed', error.message);
}

/** روابط موقّعة قصيرة الأمد لمستخدم مخوّل (يُستدعى بعد التحقق من الصلاحية فقط) */
export async function signPhotoUrls(keys: string[], ttl = SIGNED_URL_TTL): Promise<Record<string, string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await createServiceClient().storage.from(PHOTO_BUCKET).createSignedUrls(unique, ttl);
  if (error || !data) {
    console.error('[jodex] signing urls failed', error?.message);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of data) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
