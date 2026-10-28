import { PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, degrees, rgb, type PDFPage, type PDFEmbeddedPage } from 'pdf-lib';
import { pdfBaseName, type PdfPosition } from './pdf-model';
import type { PdfJob, PdfOutput } from './pdf-operations';

const a4 = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] } as const;

export function visiblePage(page: PDFPage) {
  const box = page.getCropBox(), rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('มุมหมุนของ PDF นี้ไม่รองรับ');
  return { box, rotation, width: rotation % 180 ? box.height : box.width, height: rotation % 180 ? box.width : box.height };
}

// Map displayed-page coordinates back into the PDF's cropped, rotated page.
export function displayedPoint(page: PDFPage, u: number, v: number) {
  const { box, rotation } = visiblePage(page);
  const [x, y] = rotation === 90 ? [box.width - v, u] : rotation === 180 ? [box.width - u, box.height - v] : rotation === 270 ? [v, box.height - u] : [u, v];
  return { x: box.x + x, y: box.y + y, rotation };
}

function placement(position: PdfPosition, width: number, height: number, itemWidth: number, itemHeight: number, margin: number) {
  if (!/^(top|bottom)-(left|center|right)$/.test(position)) throw new Error('ตำแหน่งไม่ถูกต้อง');
  const x = position.endsWith('left') ? margin : position.endsWith('right') ? width - margin - itemWidth : (width - itemWidth) / 2;
  return { x, y: position.startsWith('top') ? height - margin - itemHeight : margin };
}

function drawFitted(target: PDFPage, embedded: PDFEmbeddedPage, source: PDFPage, rect: { x: number; y: number; width: number; height: number }) {
  const view = visiblePage(source), scale = Math.min(rect.width / view.width, rect.height / view.height);
  const width = view.width * scale, height = view.height * scale;
  let x = rect.x + (rect.width - width) / 2, y = rect.y + (rect.height - height) / 2;
  if (view.rotation === 90) y += height;
  else if (view.rotation === 180) { x += width; y += height; }
  else if (view.rotation === 270) x += width;
  target.drawPage(embedded, { x, y, width: embedded.width * scale, height: embedded.height * scale, rotate: degrees(-view.rotation) });
}

export async function processPdfExtras(job: PdfJob, source: PDFDocument, progress: (value: number) => void): Promise<PdfOutput> {
  const base = pdfBaseName(job.inputs[0].name), options = job.options || {};
  const indices = job.pages?.map(page => page.index) || source.getPageIndices();
  if (!indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= source.getPageCount()) || new Set(indices).size !== indices.length) throw new Error('กรุณาเลือกหน้าที่ถูกต้องและไม่ซ้ำกัน');
  const margin = options.margin ?? 24;
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) throw new Error('ระยะขอบต้องอยู่ระหว่าง 0–100 pt');
  let result = source, suffix = job.op;

  if (job.op === 'reverse') {
    result = await PDFDocument.create();
    for (const page of await result.copyPages(source, source.getPageIndices().reverse())) result.addPage(page);
  } else if (job.op === 'clean-metadata') {
    const refs = new Set<PDFRef>();
    const info = source.context.trailerInfo.Info; if (info instanceof PDFRef) refs.add(info);
    const xmp = source.catalog.get(PDFName.of('Metadata')); if (xmp instanceof PDFRef) refs.add(xmp);
    delete source.context.trailerInfo.Info;
    delete source.context.trailerInfo.ID;
    source.catalog.delete(PDFName.of('Metadata'));
    for (const page of source.getPages()) { const metadata = page.node.get(PDFName.of('Metadata')); if (metadata instanceof PDFRef) refs.add(metadata); page.node.delete(PDFName.of('Metadata')); }
    for (const ref of refs) source.context.delete(ref);
    // Old object/xref streams can retain a compressed copy of deleted metadata.
    // Their parsed objects are already registered and the writer rebuilds them.
    for (const [ref, object] of source.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream && ['/ObjStm', '/XRef'].includes(object.dict.get(PDFName.of('Type'))?.toString() || '')) source.context.delete(ref);
    }
  } else if (job.op === 'resize-a4' || job.op === 'n-up') {
    result = await PDFDocument.create();
    const perSheet = job.op === 'resize-a4' ? 1 : options.perSheet ?? 4;
    if (![1, 2, 4, 9].includes(perSheet)) throw new Error('เลือก 2, 4 หรือ 9 หน้าต่อแผ่น');
    const orientation = options.orientation || (perSheet === 2 ? 'landscape' : 'portrait');
    if (!['portrait', 'landscape'].includes(orientation)) throw new Error('แนวกระดาษไม่ถูกต้อง');
    const [width, height] = a4[orientation];
    const cols = perSheet === 1 ? 1 : perSheet === 2 || perSheet === 4 ? 2 : 3, rows = Math.ceil(perSheet / cols), gap = perSheet === 1 ? 0 : 8;
    const cellWidth = (width - margin * 2 - (cols - 1) * gap) / cols, cellHeight = (height - margin * 2 - (rows - 1) * gap) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) throw new Error('ระยะขอบมากเกินไป');
    const originals = source.getPages();
    for (const page of originals) if (!page.node.Contents()) page.drawRectangle({ x: 0, y: 0, width: 1, height: 1, color: rgb(1, 1, 1), opacity: 0 });
    const embedded = await result.embedPages(originals, originals.map(page => { const b = page.getCropBox(); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; }));
    for (let start = 0; start < originals.length; start += perSheet) {
      const target = result.addPage([width, height]);
      for (let offset = 0; offset < perSheet && start + offset < originals.length; offset++) {
        const row = Math.floor(offset / cols), col = offset % cols;
        drawFitted(target, embedded[start + offset], originals[start + offset], { x: margin + col * (cellWidth + gap), y: height - margin - (row + 1) * cellHeight - row * gap, width: cellWidth, height: cellHeight });
      }
      progress(Math.round(Math.min(start + perSheet, originals.length) / originals.length * 90));
    }
  } else if (job.op === 'page-numbers') {
    const start = options.start ?? 1, fontSize = options.fontSize ?? 12;
    if (!Number.isInteger(start) || start < 1 || start > 999999 || !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 48) throw new Error('หมายเลขเริ่มต้นหรือขนาดตัวเลขไม่ถูกต้อง');
    const font = await source.embedFont(StandardFonts.Helvetica);
    for (const [offset, index] of indices.entries()) {
      const page = source.getPage(index), view = visiblePage(page);
      const text = options.numberStyle === 'fraction' ? `${start + offset} / ${start + indices.length - 1}` : String(start + offset);
      const width = font.widthOfTextAtSize(text, fontSize);
      const position = placement(options.position || 'bottom-center', view.width, view.height, width, fontSize, Math.min(margin, view.width / 10, view.height / 10));
      const point = displayedPoint(page, position.x, position.y);
      page.drawText(text, { x: point.x, y: point.y, font, size: fontSize, rotate: degrees(view.rotation), color: rgb(.16, .2, .18) });
      progress(Math.round((offset + 1) / indices.length * 90));
    }
  } else if (job.op === 'watermark') {
    const text = options.text?.trim();
    if (!text || text.length > 120) throw new Error('กรอกลายน้ำตั้งแต่ 1–120 ตัวอักษร');
    if (!job.fontBytes?.length) throw new Error('โหลดฟอนต์ภาษาไทยไม่สำเร็จ');
    const opacity = options.opacity ?? .2, fontSize = options.fontSize ?? 48, angle = options.angle ?? 45;
    if (!Number.isFinite(opacity) || opacity < .05 || opacity > 1 || !Number.isFinite(fontSize) || fontSize < 10 || fontSize > 150 || ![0, 45, -45].includes(angle)) throw new Error('การตั้งค่าลายน้ำไม่ถูกต้อง');
    const color = options.color || '#37624f';
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('สีลายน้ำไม่ถูกต้อง');
    const { default: fontkit } = await import('@pdf-lib/fontkit'); source.registerFontkit(fontkit);
    const font = await source.embedFont(job.fontBytes, { subset: true });
    const supported = new Set(font.getCharacterSet());
    if ([...text].some(character => !supported.has(character.codePointAt(0)!))) throw new Error('ลายน้ำมีสัญลักษณ์ที่ฟอนต์ไม่รองรับ กรุณาใช้ข้อความไทย อังกฤษ หรือตัวเลข');
    for (const [offset, index] of indices.entries()) {
      const page = source.getPage(index), view = visiblePage(page), radians = angle * Math.PI / 180;
      const rawWidth = font.widthOfTextAtSize(text, fontSize), rawHeight = font.heightAtSize(fontSize);
      const boundsW = Math.abs(Math.cos(radians)) * rawWidth + Math.abs(Math.sin(radians)) * rawHeight;
      const boundsH = Math.abs(Math.sin(radians)) * rawWidth + Math.abs(Math.cos(radians)) * rawHeight;
      const scale = Math.min(1, view.width * .85 / boundsW, view.height * .85 / boundsH);
      const width = rawWidth * scale, height = rawHeight * scale;
      const point = displayedPoint(page, view.width / 2 - Math.cos(radians) * width / 2 + Math.sin(radians) * height / 2, view.height / 2 - Math.sin(radians) * width / 2 - Math.cos(radians) * height / 2);
      page.drawText(text, { x: point.x, y: point.y, font, size: fontSize * scale, rotate: degrees(view.rotation + angle), opacity,
        color: rgb(parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255) });
      progress(Math.round((offset + 1) / indices.length * 90));
    }
  } else if (job.op === 'sign') {
    if (!job.signatureBytes?.length) throw new Error('กรุณาวาดหรือเลือกรูปลายเซ็น');
    const image = job.signatureBytes[0] === 0x89 ? await source.embedPng(job.signatureBytes) : await source.embedJpg(job.signatureBytes);
    const requestedWidth = options.signatureWidth ?? 180;
    if (!Number.isFinite(requestedWidth) || requestedWidth < 40 || requestedWidth > 400) throw new Error('ความกว้างลายเซ็นไม่ถูกต้อง');
    for (const [offset, index] of indices.entries()) {
      const page = source.getPage(index), view = visiblePage(page);
      const inset = Math.min(margin, view.width / 10, view.height / 10);
      const scale = Math.min(requestedWidth / image.width, (view.width - inset * 2) / image.width, view.height * .25 / image.height);
      const width = image.width * scale, height = image.height * scale;
      const pos = placement(options.position || 'bottom-right', view.width, view.height, width, height, inset);
      const point = displayedPoint(page, pos.x, pos.y);
      page.drawImage(image, { x: point.x, y: point.y, width, height, rotate: degrees(view.rotation) });
      progress(Math.round((offset + 1) / indices.length * 90));
    }
  } else throw new Error('ไม่พบเครื่องมือ PDF นี้');
  progress(95);
  return { bytes: await result.save(), name: `${base}-${suffix}.pdf`, mime: 'application/pdf' };
}
