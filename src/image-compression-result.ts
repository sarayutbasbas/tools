import { keepOriginalFile } from '../server/compression-policy';

export interface ImageCompressionResult {
  blob: Blob;
  name: string;
  quality: number;
  encodedSize: number;
  keptOriginal: boolean;
}

export async function validateWebP(blob: Blob): Promise<void> {
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...header);
  if (blob.type !== 'image/webp' || text.slice(0, 4) !== 'RIFF' || text.slice(8, 12) !== 'WEBP') {
    throw new Error('ตัวเข้ารหัสไม่ได้ส่งออกเป็น WebP จริง กรุณาลองบีบอัดใหม่');
  }
}

export async function imageCompressionResult(file: File, encoded: Blob, quality: number): Promise<ImageCompressionResult> {
  await validateWebP(encoded);
  if (keepOriginalFile(file.size, encoded.size)) {
    return { blob: file, name: file.name, quality, encodedSize: encoded.size, keptOriginal: true };
  }
  return { blob: encoded, name: `${file.name.replace(/\.[^.]+$/, '')}-compressed.webp`, quality, encodedSize: encoded.size, keptOriginal: false };
}
