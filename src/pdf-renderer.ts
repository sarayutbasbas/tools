import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export { thumbnail, pdfToImages, prepareImage, extractPdfText } from './pdf-canvas';
GlobalWorkerOptions.workerSrc = workerUrl;
export function openPdf(file: File) {
  return file.arrayBuffer().then(data => getDocument({
    data: new Uint8Array(data), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
  }));
}
