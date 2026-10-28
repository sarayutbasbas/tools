import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees, rgb } from 'pdf-lib';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { processPdf } from '../src/pdf-operations.js';
import { extractPdfText } from '../src/pdf-canvas.js';

async function fixture() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([400, 500]); page.setCropBox(30, 40, 260, 360); page.setRotation(degrees(i * 90));
    page.drawText(`Original ${i + 1}`, { x: 70, y: 250, size: 16 });
    page.drawRectangle({ x: 45, y: 55, width: 20, height: 30, color: rgb(0, .4, .8) });
  }
  return doc.save();
}
async function withReader(bytes: Uint8Array, action: (doc: PDFDocumentProxy) => Promise<void>) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
  try { await action(await task.promise); } finally { await task.destroy(); }
}
async function raster(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: 'white' }).promise;
  return canvas;
}
const input = async () => [{ name: 'เอกสารไทย.pdf', bytes: await fixture() }];

test('reverse preserves the contents and original rotations in opposite order', async () => {
  const out = await processPdf({ op: 'reverse', inputs: await input() });
  const doc = await PDFDocument.load(out.bytes);
  assert.deepEqual(doc.getPages().map(p => p.getRotation().angle), [270, 180, 90, 0]);
  await withReader(out.bytes, async reader => {
    const text = await (await reader.getPage(1)).getTextContent();
    assert.ok(text.items.some(item => 'str' in item && item.str === 'Original 4'));
  });
});

test('A4 and N-up keep vector text, cropped/rotated pages, dimensions and page counts', async () => {
  for (const [op, perSheet, count] of [['resize-a4', 1, 4], ['n-up', 2, 2], ['n-up', 4, 1], ['n-up', 9, 1]] as const) {
    const out = await processPdf({ op, inputs: await input(), options: { ...(perSheet === 1 ? {} : { perSheet }), orientation: 'portrait', margin: 24 } });
    const doc = await PDFDocument.load(out.bytes); assert.equal(doc.getPageCount(), count);
    assert.ok(Math.abs(doc.getPage(0).getWidth() - 595.28) < .01);
    assert.ok(Math.abs(doc.getPage(0).getHeight() - 841.89) < .01);
    await withReader(out.bytes, async reader => {
      const texts: string[] = [];
      for (let i = 1; i <= reader.numPages; i++) {
        const page = await reader.getPage(i); await raster(page);
        texts.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
      }
      for (let i = 1; i <= 4; i++) assert.ok(texts.join(' ').includes(`Original ${i}`), `${op}: missing original page ${i}`);
    });
  }
  const blank = await PDFDocument.create(); blank.addPage();
  const out = await processPdf({ op: 'resize-a4', inputs: [{ name: 'blank.pdf', bytes: await blank.save() }] });
  assert.equal((await PDFDocument.load(out.bytes)).getPageCount(), 1);
});

test('numbers stay in the displayed bottom-right corner for all four page rotations', async () => {
  const out = await processPdf({ op: 'page-numbers', inputs: await input(), options: { start: 7, numberStyle: 'fraction', position: 'bottom-right', fontSize: 12, margin: 24 } });
  await withReader(out.bytes, async reader => {
    for (let i = 1; i <= 4; i++) {
      const page = await reader.getPage(i), viewport = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items;
      const stamp = items.find(item => 'str' in item && item.str === `${6 + i} / 10`);
      assert.ok(stamp && 'transform' in stamp);
      const [x, y] = viewport.convertToViewportPoint(stamp.transform[4], stamp.transform[5]);
      assert.ok(x > viewport.width / 2 && x < viewport.width, `page ${i} x=${x}`);
      assert.ok(y > viewport.height / 2 && y < viewport.height, `page ${i} y=${y}`);
    }
  });
});

test('Thai watermark embeds a real font, renders, and only marks selected pages', async () => {
  const fontBytes = new Uint8Array(await readFile('public/pdf-fonts/NotoSansThai.ttf'));
  const out = await processPdf({ op: 'watermark', inputs: await input(), fontBytes, pages: [{ index: 1, rotation: 0 }], options: { text: 'ข้อมูลภายใน', opacity: .3, color: '#37624f', angle: 45, fontSize: 48 } });
  await withReader(out.bytes, async reader => {
    const a = (await (await reader.getPage(1)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    const page = await reader.getPage(2), b = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    assert.ok(!a.includes('ข้อมูล')); assert.ok(b.includes('ข้อมูลภายใน'), b); await raster(page);
  });
});

test('signature placement is pixel-correct on cropped pages at 0/90/180/270 degrees', async () => {
  const mark = createCanvas(200, 80), ctx = mark.getContext('2d'); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 200, 80);
  const out = await processPdf({ op: 'sign', inputs: await input(), signatureBytes: new Uint8Array(mark.toBuffer('image/png')), options: { signatureWidth: 80, margin: 24, position: 'bottom-right' } });
  await withReader(out.bytes, async reader => {
    for (let i = 1; i <= 4; i++) {
      const canvas = await raster(await reader.getPage(i));
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const p = (y * canvas.width + x) * 4;
        if (data[p] > 220 && data[p + 1] < 60 && data[p + 2] > 220) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      }
      assert.ok(Math.abs(left - (canvas.width - 24 - 80)) < 2, `page ${i}, left ${left}`);
      assert.ok(Math.abs(top - (canvas.height - 24 - 32)) < 2, `page ${i}, top ${top}`);
      assert.ok(Math.abs(right - (canvas.width - 25)) < 2); assert.ok(Math.abs(bottom - (canvas.height - 25)) < 2);
    }
  });
});

test('metadata cleaning removes Info and XMP without removing page text', async () => {
  const doc = await PDFDocument.load(await fixture()); doc.setAuthor('Private Author'); doc.setTitle('Private Title');
  const xmp = doc.context.flateStream('<x:xmpmeta>Private metadata</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  const xmpRef = doc.context.register(xmp), infoRef = doc.context.trailerInfo.Info;
  doc.catalog.set(PDFName.of('Metadata'), xmpRef);
  const out = await processPdf({ op: 'clean-metadata', inputs: [{ name: 'private.pdf', bytes: await doc.save() }] });
  const clean = await PDFDocument.load(out.bytes, { updateMetadata: false });
  assert.equal(clean.context.trailerInfo.Info, undefined); assert.equal(clean.catalog.has(PDFName.of('Metadata')), false); assert.equal(clean.getPageCount(), 4);
  assert.equal(clean.context.lookup(xmpRef), undefined);
  if (infoRef) assert.equal(clean.context.lookup(infoRef), undefined);
  const decodedObjects = clean.context.enumerateIndirectObjects().map(([, object]) => object instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(object).decode()).toString('latin1') : object.toString()).join('\n');
  assert.ok(!decodedObjects.includes('Private metadata'));
  assert.ok(!decodedObjects.includes(Buffer.from('Private Author', 'utf16le').swap16().toString('hex').toUpperCase()));
  await withReader(out.bytes, async reader => { assert.ok((await (await reader.getPage(1)).getTextContent()).items.some(item => 'str' in item && item.str === 'Original 1')); });
});

test('TXT extraction respects selected pages, produces UTF-8 and rejects scans and cancellation', async () => {
  await withReader(await fixture(), async reader => {
    const out = await extractPdfText(reader, 'ไทย.pdf', [2], new AbortController().signal, () => {});
    const text = new TextDecoder().decode(out.bytes); assert.ok(text.includes('หน้า 3') && text.includes('Original 3')); assert.ok(!text.includes('Original 1')); assert.equal(out.name, 'ไทย-text.txt');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(extractPdfText(reader, 'a.pdf', [0], controller.signal, () => {}), { name: 'AbortError' });
  });
  const blank = await PDFDocument.create(); blank.addPage();
  await withReader(await blank.save(), async reader => { await assert.rejects(extractPdfText(reader, 'scan.pdf', [0], new AbortController().signal, () => {}), /OCR/); });
});

test('invalid watermark, missing signature and invalid page selections are rejected', async () => {
  await assert.rejects(processPdf({ op: 'watermark', inputs: await input(), options: { text: '' } }), /ลายน้ำ/);
  await assert.rejects(processPdf({ op: 'sign', inputs: await input() }), /ลายเซ็น/);
  await assert.rejects(processPdf({ op: 'page-numbers', inputs: await input(), pages: [{ index: 9, rotation: 0 }] }), /เลือกหน้า/);
});
