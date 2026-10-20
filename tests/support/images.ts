import sharp from 'sharp';

/** صورة JPEG حقيقية صغيرة تحمل بيانات EXIF وموقع GPS (للتحقق من إزالتها) */
export async function jpegWithGps(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 96, height: 72, channels: 3, background: { r: 60 + (seed * 37) % 150, g: 149, b: 122 } } })
    .withExif({
      IFD0: { Make: 'JodexQA', Model: 'GPS-Test' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '24/1 42/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '46/1 40/1 0/1' },
    })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export async function exifOf(buffer: Buffer) {
  const meta = await sharp(buffer).metadata();
  return { exif: meta.exif ?? null, format: meta.format, width: meta.width, height: meta.height };
}

/** صورة ملتقطة من بث الكاميرا الحي في الصفحة (JPEG من canvas بلا أي بيانات EXIF) */
export async function cameraJpeg(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 72, height: 96, channels: 3, background: { r: 80, g: 120 + (seed * 13) % 100, b: 110 } } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** صورة محفوظة مسبقًا على الجهاز: تاريخ التقاط EXIF قديم */
export async function galleryJpeg(dateTimeOriginal = '2026:01:15 10:20:30'): Promise<Buffer> {
  return sharp({ create: { width: 72, height: 96, channels: 3, background: { r: 90, g: 90, b: 140 } } })
    .withExif({ IFD0: { Make: 'Gallery', DateTime: dateTimeOriginal }, IFD2: { DateTimeOriginal: dateTimeOriginal } })
    .jpeg({ quality: 85 })
    .toBuffer();
}
