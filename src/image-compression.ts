import { imageCompressionResult, type ImageCompressionResult } from './image-compression-result';

async function decodeImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Some Safari versions decode through HTMLImageElement instead. */ }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('อ่านรูปนี้ไม่ได้ กรุณาเลือกไฟล์ JPG, PNG หรือ WebP ที่เปิดดูได้');
  }
}

export async function compressImage(file: File, quality: number, signal?: AbortSignal): Promise<ImageCompressionResult> {
  signal?.throwIfAborted();
  const decoded = await decodeImage(file);
  const canvas = document.createElement('canvas');
  let pixels: ImageData;
  try {
    signal?.throwIfAborted();
    canvas.width = decoded.width; canvas.height = decoded.height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) throw new Error('หน่วยความจำไม่พอสำหรับอ่านภาพนี้ ลองใช้รูปที่มีจำนวนพิกเซลน้อยลง');
    context.drawImage(decoded.image, 0, 0);
    pixels = context.getImageData(0, 0, decoded.width, decoded.height);
  } finally {
    decoded.close();
    // Free the large canvas before allocating WebAssembly encoder memory.
    canvas.width = 0; canvas.height = 0;
  }
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./image-encoder.worker.ts', import.meta.url), { type: 'module' });
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(new DOMException('หยุดการบีบอัดแล้ว', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      const finish = (callback: () => void) => { signal?.removeEventListener('abort', abort); callback(); };
      worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
        finish(() => event.data.error || !event.data.buffer
          ? reject(new Error(event.data.error || 'สร้างไฟล์ภาพไม่สำเร็จ'))
          : resolve(new Blob([event.data.buffer], { type: 'image/webp' })));
      };
      worker.onerror = () => finish(() => reject(new Error('โหลดตัวเข้ารหัสภาพไม่สำเร็จ กรุณารีเฟรชหน้าและลองใหม่')));
      worker.postMessage({ pixels: pixels.data.buffer, width: pixels.width, height: pixels.height, quality }, [pixels.data.buffer]);
    });
    signal?.throwIfAborted();
    return await imageCompressionResult(file, blob, quality);
  } finally { worker.terminate(); }
}
