import { processPdf, type PdfJob } from './pdf-operations';
self.onmessage = async (event: MessageEvent<PdfJob>) => {
  try {
    const result = await processPdf(event.data, percent => self.postMessage({ type: 'progress', percent }));
    const bytes = new Uint8Array(result.bytes);
    self.postMessage({ type: 'result', name: result.name, mime: result.mime, bytes }, { transfer: [bytes.buffer] });
  } catch (e) { self.postMessage({ type: 'error', message: e instanceof Error ? e.message : 'ประมวลผล PDF ไม่สำเร็จ' }); }
};
