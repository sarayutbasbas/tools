import { cp, mkdir } from 'node:fs/promises';
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir('public/pdfjs', { recursive: true });
  await cp(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, { recursive: true });
}
