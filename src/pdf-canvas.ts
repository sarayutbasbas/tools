import type { PDFDocumentProxy } from 'pdfjs-dist';
import { zipSync } from 'fflate';
import { pdfBaseName } from './pdf-model';

export async function extractPdfText(doc: PDFDocumentProxy, name: string, indices: number[], signal: AbortSignal, progress: (value: number) => void) {
  const sections: string[] = []; let found = false;
  for (const [offset, index] of indices.entries()) {
    signal.throwIfAborted();
    const page = await doc.getPage(index + 1);
    try {
      const content = await page.getTextContent(), lines: string[] = [];
      let line = '', previous: { y: number; endX: number; height: number } | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5], x = item.transform[4], height = Math.abs(item.height) || 12;
        if (previous && Math.abs(y - previous.y) > Math.max(2, previous.height * .4) && line.trim()) { lines.push(line.trimEnd()); line = ''; }
        if (previous && line && x - previous.endX > Math.max(1, height * .15) && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
        line += item.str;
        previous = { y, endX: x + item.width, height };
        if (item.hasEOL) { if (line.trim()) lines.push(line.trimEnd()); line = ''; previous = undefined; }
      }
      if (line.trim()) lines.push(line.trimEnd());
      if (lines.join('').trim()) found = true;
      sections.push(`หน้า ${index + 1}\n${lines.join('\n')}`);
      progress(Math.round((offset + 1) / indices.length * 95));
    } finally { page.cleanup(); }
  }
  signal.throwIfAborted();
  if (!found) throw new Error('ไม่พบข้อความที่เลือกได้ เอกสารนี้อาจเป็นภาพสแกน เครื่องมือนี้ยังไม่ใช่ OCR');
  return { bytes: new TextEncoder().encode('\ufeff' + sections.join('\n\n──────────\n\n')), name: `${pdfBaseName(name)}-text.txt`, mime: 'text/plain;charset=utf-8' };
}
export async function thumbnail(doc: PDFDocumentProxy, index: number) {
  const page = await doc.getPage(index + 1);
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(160 / original.width, 200 / original.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvas, viewport, background: 'white' }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
}

export async function pdfToImages(doc: PDFDocumentProxy, name: string, indices: number[], dpi: number, signal: AbortSignal, progress: (value: number) => void) {
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const [i, index] of indices.entries()) {
    signal.throwIfAborted();
    const page = await doc.getPage(index + 1), natural = page.getViewport({ scale: dpi / 72 });
    const limit = Math.min(1, Math.sqrt(16_000_000 / (natural.width * natural.height)));
    const viewport = page.getViewport({ scale: dpi / 72 * limit });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const render = page.render({ canvas, viewport, background: 'white' });
    const cancel = () => render.cancel(); signal.addEventListener('abort', cancel, { once: true });
    try {
      await render.promise; signal.throwIfAborted();
      const blob = await canvasBlob(canvas, 'image/jpeg', 0.92);
      totalBytes += blob.size;
      if (totalBytes > 100 * 1024 * 1024) throw new Error('ภาพรวมมีขนาดเกิน 100 MB กรุณาลดความคมชัดหรือเลือกหน้าครั้งละน้อยลง');
      files[`${pdfBaseName(name)}-page-${index + 1}.jpg`] = new Uint8Array(await blob.arrayBuffer());
      progress(Math.round((i + 1) / indices.length * 95));
    } finally { signal.removeEventListener('abort', cancel); canvas.width = 0; canvas.height = 0; page.cleanup(); }
  }
  signal.throwIfAborted();
  return { bytes: zipSync(files, { level: 0 }), name: `${pdfBaseName(name)}-images.zip`, mime: 'application/zip' };
}

const canvasBlob = (canvas: HTMLCanvasElement, mime: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('แปลงรูปภาพไม่สำเร็จ')), mime, quality);
});

export async function prepareImage(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 5000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    const context = canvas.getContext('2d'); if (!context) throw new Error('เบราว์เซอร์ไม่รองรับการแปลงภาพ');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.95);
    return { name: file.name, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
