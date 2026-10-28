// Run against the rebuilt Docker app: node scripts/verify-pdf-compression.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolve } from 'node:path';
const origin = process.env.TOOLBOX_URL || 'http://localhost:1111';
const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1800x2400:rate=1', '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', '-'], { maxBuffer: 20 * 1024 * 1024 });
const doc = await PDFDocument.create(), image = await doc.embedPng(png);
const page = doc.addPage([600, 800]); page.drawImage(image, { x: 0, y: 0, width: 600, height: 800 });
page.drawText('Text remains selectable', { x: 30, y: 740, size: 20 });
const source = await doc.save();
const results = [];
for (const quality of ['small', 'balanced', 'high']) {
  const form = new FormData(); form.append('file', new Blob([source], { type: 'application/pdf' }), 'ทดสอบ.pdf'); form.append('filename', 'ทดสอบ.pdf'); form.append('quality', quality);
  const response = await fetch(origin + '/api/pdf/compress', { method: 'POST', body: form });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.ok(bytes.length <= source.length);
  const result = await PDFDocument.load(bytes); assert.equal(result.getPageCount(), 1);
  assert.equal(result.getPage(0).getWidth(), 600); assert.equal(result.getPage(0).getHeight(), 800);
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
  try {
    const pdf = await task.promise, page = await pdf.getPage(1), content = await page.getTextContent();
    assert.match(content.items.map(item => item.str || '').join(' '), /Text remains selectable/);
  } finally { await task.destroy(); }
  results.push(bytes.length); console.log({ quality, before: source.length, after: bytes.length, result: response.headers.get('X-Compression-Result') });
}
assert.ok(new Set(results).size > 1, 'Compression choices should produce distinct results');
const tiny = await PDFDocument.create(); tiny.addPage([100, 100]); const tinyBytes = await tiny.save();
const form = new FormData(); form.append('file', new Blob([tinyBytes], { type: 'application/pdf' }), 'เล็ก.pdf'); form.append('filename', 'เล็ก.pdf'); form.append('quality', 'high');
const response = await fetch(origin + '/api/pdf/compress', { method: 'POST', body: form });
assert.equal(response.status, 200); const bytes = new Uint8Array(await response.arrayBuffer());
assert.equal(response.headers.get('X-Compression-Result'), 'original'); assert.deepEqual(bytes, tinyBytes);
console.log('Tiny PDF returns original bytes; no output grows.');
const invalid = new FormData(); invalid.append('file', new Blob(['not a PDF']), 'bad.pdf'); invalid.append('quality', 'balanced');
const error = await fetch(origin + '/api/pdf/compress', { method: 'POST', body: invalid });
assert.equal(error.status, 422); assert.match((await error.json()).error, /PDF/);
console.log('Invalid PDF rejected with JSON error.');
