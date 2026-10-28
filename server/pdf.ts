import type { Express } from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { safeDownloadName } from './youtube.js';
import { keepOriginalFile } from './compression-policy.js';

export function registerPdfRoutes(app: Express) {
  const upload = multer({ dest: join(tmpdir(), 'toolbox-pdf'), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  app.post('/api/pdf/compress', upload.single('file'), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'กรุณาเลือก PDF' }); return; }
    const input = req.file.path, output = `${input}-compressed.pdf`;
    const cleanup = async () => { await Promise.all([rm(input, { force: true }), rm(output, { force: true })]); };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let sending = false;
    try {
      const profile = ({ small: '/screen', balanced: '/ebook', high: '/printer' } as Record<string, string>)[req.body.quality];
      if (!profile) throw new Error('กรุณาเลือกระดับการบีบอัด');
      const bytes = await readFile(input);
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('ไฟล์นี้ไม่ใช่ PDF ที่อ่านได้');
      let source: PDFDocument;
      try { source = await PDFDocument.load(bytes, { updateMetadata: false }); }
      catch { throw new Error('อ่าน PDF ไม่สำเร็จ ไฟล์อาจมีรหัสผ่านหรือเสียหาย'); }
      if (source.getPageCount() < 1 || source.getPageCount() > 300) throw new Error('รองรับ PDF ตั้งแต่ 1–300 หน้า');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.env.GHOSTSCRIPT_PATH || 'gs', [
          '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
          `-dPDFSETTINGS=${profile}`, '-dAutoRotatePages=/None', '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true',
          `-sOutputFile=${output}`, '-f', input,
        ], { signal: controller.signal, stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.resume();
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('บีบอัด PDF ไม่สำเร็จ กรุณาใช้ไฟล์ที่เปิดอ่านได้')));
      });
      const size = (await stat(output)).size;
      const candidate = await PDFDocument.load(await readFile(output), { updateMetadata: false });
      const keptOriginal = keepOriginalFile(req.file.size, size) || candidate.getPageCount() !== source.getPageCount();
      const original = safeDownloadName(typeof req.body.filename === 'string' ? req.body.filename : req.file.originalname);
      const filename = keptOriginal ? original : `${original.replace(/\.pdf$/i, '')}-compressed.pdf`;
      res.setHeader('X-Compression-Result', keptOriginal ? 'original' : 'compressed');
      res.type('application/pdf');
      sending = true;
      res.download(keptOriginal ? input : output, filename, () => { void cleanup(); });
    } catch (e) {
      if (!res.destroyed) res.status(422).json({ error: controller.signal.aborted ? 'ประมวลผลนานเกินไป กรุณาแบ่ง PDF ให้เล็กลง' : e instanceof Error ? e.message : 'บีบอัด PDF ไม่สำเร็จ' });
    } finally { clearTimeout(timeout); if (!sending) await cleanup(); }
  });
}
