import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { parsePageRange } from '../src/pdf-model.js';
import { processPdf } from '../src/pdf-operations.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { pdfToImages, thumbnail } from '../src/pdf-canvas.js';
import { resolve } from 'node:path';

async function fixture(widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const [index, width] of widths.entries()) {
    const page = pdf.addPage([width, 400]);
    page.drawText(`Test page ${index + 1}`, { x: 20, y: 350, size: 18 });
    page.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: rgb(index / widths.length, 0.3, 0.5) });
    if (index === 1) page.setRotation(degrees(90));
  }
  return pdf.save();
}

test('PDF ranges preserve requested order and reject missing, duplicate and invalid pages', () => {
  assert.deepEqual(parsePageRange('3,1-2', 3), [2, 0, 1]);
  assert.deepEqual(parsePageRange('', 3), [0, 1, 2]);
  for (const text of ['0', '4', '3-1', '1,1', '1,,2', 'abc', '1-999999']) assert.throws(() => parsePageRange(text, 3));
});

test('merging retains page order, original dimensions and rotations', async () => {
  const out = await processPdf({ op: 'merge', inputs: [{ name: 'เอกสารไทย.pdf', bytes: await fixture([200, 250]) }, { name: 'b.pdf', bytes: await fixture([300]) }] });
  const doc = await PDFDocument.load(out.bytes);
  assert.deepEqual(doc.getPages().map(p => p.getWidth()), [200, 250, 300]);
  assert.equal(doc.getPage(1).getRotation().angle, 90);
  assert.equal(out.name, 'เอกสารไทย-merged.pdf');
});

test('organizing removes pages and applies rotations relative to their original angle', async () => {
  const out = await processPdf({ op: 'organize', inputs: [{ name: 'test.pdf', bytes: await fixture([200, 250, 300]) }], pages: [{ index: 1, rotation: 90 }, { index: 0, rotation: 270 }] });
  const doc = await PDFDocument.load(out.bytes);
  assert.deepEqual(doc.getPages().map(p => p.getWidth()), [250, 200]);
  assert.deepEqual(doc.getPages().map(p => p.getRotation().angle), [180, 270]);
});

test('split ZIP contains separately readable PDFs with Unicode filenames', async () => {
  const out = await processPdf({ op: 'split', inputs: [{ name: 'ทดสอบ.pdf', bytes: await fixture([200, 250, 300]) }], pages: [{ index: 2, rotation: 0 }, { index: 0, rotation: 0 }], separate: true });
  const files = unzipSync(out.bytes);
  assert.deepEqual(Object.keys(files), ['ทดสอบ-page-3.pdf', 'ทดสอบ-page-1.pdf']);
  assert.equal((await PDFDocument.load(files['ทดสอบ-page-3.pdf'])).getPage(0).getWidth(), 300);
  assert.equal((await PDFDocument.load(files['ทดสอบ-page-1.pdf'])).getPageCount(), 1);
});

test('image conversion makes an A4 PDF with an embedded image', async () => {
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64'));
  const out = await processPdf({ op: 'images-pdf', inputs: [{ name: 'ภาพ.png', bytes: png }] });
  const doc = await PDFDocument.load(out.bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.ok(Math.abs(doc.getPage(0).getWidth() - 595.28) < 0.01);
  assert.ok(out.bytes.length > 500);
});

test('invalid documents and attempts to delete every page fail clearly', async () => {
  await assert.rejects(processPdf({ op: 'merge', inputs: [{ name: 'bad.pdf', bytes: new Uint8Array([1]) }, { name: 'a.pdf', bytes: await fixture([200]) }] }), /อ่าน PDF/);
  await assert.rejects(processPdf({ op: 'organize', inputs: [{ name: 'a.pdf', bytes: await fixture([200]) }], pages: [] }), /อย่างน้อย 1 หน้า/);
});

test('PDF image exports really render each page into readable JPEGs and honor cancellation', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: await fixture([300, 250]), standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await task.promise;
  const previous = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) } as unknown as Document;
  try {
    const preview = await thumbnail(doc, 0); assert.match(preview, /^data:image\/jpeg;base64,/);
    const progress: number[] = [];
    const result = await pdfToImages(doc, 'ทดสอบ.pdf', [0, 1], 100, new AbortController().signal, value => progress.push(value));
    const files = unzipSync(result.bytes); assert.equal(Object.keys(files).length, 2);
    for (const bytes of Object.values(files)) {
      assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
      const image = await loadImage(Buffer.from(bytes)); assert.ok(image.width > 300 && image.height > 300);
    }
    assert.equal(progress.at(-1), 95);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(pdfToImages(doc, 'test.pdf', [0], 100, controller.signal, () => {}), { name: 'AbortError' });
  } finally { globalThis.document = previous; await task.destroy(); }
});
