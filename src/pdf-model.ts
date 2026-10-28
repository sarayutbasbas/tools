export type PdfToolId = 'merge' | 'split' | 'organize' | 'compress' | 'images-pdf' | 'pdf-images' |
  'watermark' | 'sign' | 'page-numbers' | 'resize-a4' | 'n-up' | 'reverse' | 'clean-metadata' | 'extract-text';
export type PdfWorkerToolId = Exclude<PdfToolId, 'compress' | 'pdf-images' | 'extract-text'>;
export type PdfPosition = 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right';
export type PagePlan = { index: number; rotation: number };
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 300;
export function parsePageRange(value: string, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > PDF_MAX_PAGES) throw new Error('รองรับ PDF ตั้งแต่ 1–300 หน้า');
  if (!value.trim()) return Array.from({ length: count }, (_, i) => i);
  const pages: number[] = [];
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('ระบุหน้าแบบ 1-3,5 หรือเว้นว่างเพื่อเลือกทุกหน้า');
    const first = Number(match[1]), last = Number(match[2] || first);
    if (first < 1 || last > count || last < first) throw new Error(`หมายเลขหน้าต้องอยู่ระหว่าง 1–${count}`);
    for (let p = first; p <= last; p++) { if (pages.includes(p - 1)) throw new Error(`เลือกหน้า ${p} ซ้ำ`); pages.push(p - 1); }
  }
  return pages;
}
export const pdfBaseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\\/]/g, '_') || 'document';
