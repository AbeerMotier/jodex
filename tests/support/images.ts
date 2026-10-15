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
