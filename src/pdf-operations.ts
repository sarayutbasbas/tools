import { PDFDocument, degrees } from 'pdf-lib';
import { zipSync } from 'fflate';
import { PDF_MAX_PAGES, pdfBaseName, type PagePlan, type PdfPosition, type PdfWorkerToolId } from './pdf-model';
import { processPdfExtras } from './pdf-extras';
export type PdfInput = { name: string; bytes: Uint8Array };
export type PdfJob = {
  op: PdfWorkerToolId; inputs: PdfInput[]; pages?: PagePlan[]; separate?: boolean;
  fontBytes?: Uint8Array; signatureBytes?: Uint8Array;
  options?: { text?: string; opacity?: number; color?: string; fontSize?: number; angle?: number;
    position?: PdfPosition; start?: number; numberStyle?: 'number' | 'fraction';
    orientation?: 'portrait' | 'landscape'; perSheet?: 2 | 4 | 9; margin?: number; signatureWidth?: number };
};
export type PdfOutput = { bytes: Uint8Array; name: string; mime: string };
export async function loadPdf(bytes: Uint8Array) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.getPageCount() < 1 || doc.getPageCount() > PDF_MAX_PAGES) throw new Error('รองรับ PDF ตั้งแต่ 1–300 หน้า');
    return doc;
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(e.message)) throw new Error('PDF นี้มีรหัสผ่าน กรุณาปลดล็อกด้วยรหัสของคุณก่อนใช้งาน');
    throw new Error(e instanceof Error && /รองรับ PDF/.test(e.message) ? e.message : 'อ่าน PDF ไม่สำเร็จ ไฟล์อาจเสียหายหรือไม่ใช่ PDF');
  }
}
export async function processPdf(job: PdfJob, progress: (percent: number) => void = () => {}): Promise<PdfOutput> {
  if (!job.inputs.length || job.inputs.length > 20) throw new Error('เลือกได้ครั้งละ 1–20 ไฟล์');
  if (!['merge', 'split', 'organize', 'images-pdf'].includes(job.op)) return processPdfExtras(job, await loadPdf(job.inputs[0].bytes), progress);
  const output = await PDFDocument.create(), base = pdfBaseName(job.inputs[0].name);
  if (job.op === 'merge') {
    if (job.inputs.length < 2) throw new Error('เลือกรวมอย่างน้อย 2 ไฟล์');
    for (const [i, input] of job.inputs.entries()) {
      const doc = await loadPdf(input.bytes);
      if (output.getPageCount() + doc.getPageCount() > PDF_MAX_PAGES) throw new Error('รวมได้สูงสุด 300 หน้า');
      for (const page of await output.copyPages(doc, doc.getPageIndices())) output.addPage(page);
      progress(Math.round((i + 1) / job.inputs.length * 90));
    }
  } else if (job.op === 'images-pdf') {
    for (const [i, input] of job.inputs.entries()) {
      const image = input.bytes[0] === 0x89 ? await output.embedPng(input.bytes) : await output.embedJpg(input.bytes);
      const wide = image.width > image.height, width = wide ? 841.89 : 595.28, height = wide ? 595.28 : 841.89;
      const scale = Math.min((width - 40) / image.width, (height - 40) / image.height);
      output.addPage([width, height]).drawImage(image, { x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
      progress(Math.round((i + 1) / job.inputs.length * 90));
    }
  } else {
    const doc = await loadPdf(job.inputs[0].bytes);
    const pages = job.pages || doc.getPageIndices().map(index => ({ index, rotation: 0 }));
    if (!pages.length) throw new Error('ต้องเหลืออย่างน้อย 1 หน้า');
    for (const p of pages) if (!Number.isInteger(p.index) || p.index < 0 || p.index >= doc.getPageCount() || ![0, 90, 180, 270].includes(p.rotation)) throw new Error('การเลือกหน้าหรือมุมหมุนไม่ถูกต้อง');
    const files: Record<string, Uint8Array> = {};
    const separate = job.op === 'split' && job.separate;
    const copied = separate ? [] : await output.copyPages(doc, pages.map(p => p.index));
    let zipBytes = 0;
    for (const [i, plan] of pages.entries()) {
      const destination = separate ? await PDFDocument.create() : output;
      const page = separate ? (await destination.copyPages(doc, [plan.index]))[0] : copied[i];
      page.setRotation(degrees((page.getRotation().angle + plan.rotation) % 360));
      destination.addPage(page);
      if (separate) {
        const bytes = await destination.save(); zipBytes += bytes.length;
        if (zipBytes > 100 * 1024 * 1024) throw new Error('ไฟล์แยกรวมเกิน 100 MB กรุณาเลือกครั้งละน้อยหน้า');
        files[`${base}-page-${plan.index + 1}.pdf`] = bytes;
      }
      progress(Math.round((i + 1) / pages.length * 90));
    }
    if (job.op === 'split' && job.separate) return { bytes: zipSync(files, { level: 0 }), name: `${base}-pages.zip`, mime: 'application/zip' };
  }
  return { bytes: await output.save(), name: `${base}-${job.op === 'merge' ? 'merged' : job.op === 'images-pdf' ? 'images' : job.op === 'split' ? 'selected' : 'organized'}.pdf`, mime: 'application/pdf' };
}
