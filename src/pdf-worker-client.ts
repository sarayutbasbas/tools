import type { PdfJob, PdfOutput } from './pdf-operations';
export function runPdfJob(job: PdfJob, signal: AbortSignal, progress: (percent: number) => void): Promise<PdfOutput> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./pdf-processing.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('ยกเลิกแล้ว', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('โหลดตัวประมวลผล PDF ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress(data.percent);
      else if (data.type === 'result') { finish(); resolve({ bytes: data.bytes, name: data.name, mime: data.mime }); }
      else if (data.type === 'error') { finish(); reject(new Error(data.message)); }
    };
    const buffers = [...job.inputs.map(input => input.bytes.buffer as ArrayBuffer),
      ...(job.fontBytes ? [job.fontBytes.buffer as ArrayBuffer] : []), ...(job.signatureBytes ? [job.signatureBytes.buffer as ArrayBuffer] : [])];
    worker.postMessage(job, [...new Set(buffers)]);
  });
}
