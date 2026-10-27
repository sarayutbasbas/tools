import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { simd } from 'wasm-feature-detect';
import encode, { init } from '@jsquash/webp/encode.js';
import decode, { init as initDecode } from '@jsquash/webp/decode.js';
import { imageCompressionResult, validateWebP } from '../src/image-compression-result.ts';

const wasmRoot = new URL('../node_modules/@jsquash/webp/codec/', import.meta.url);
const encoderReady = (async () => {
  const binary = await readFile(new URL(await simd() ? 'enc/webp_enc_simd.wasm' : 'enc/webp_enc.wasm', wasmRoot));
  await init({ wasmBinary: binary });
})();

function fixture(width = 192, height = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 123456789;
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[offset + channel] = seed >>> 24;
    }
    data[offset + 3] = offset < width * 4 ? 0 : 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

test('real libwebp encoding produces different sizes for different quality levels', async () => {
  await encoderReady;
  const image = fixture();
  const sizes: number[] = [];
  for (const quality of [1, 25, 50, 75, 100]) {
    const bytes = await encode(image, { quality, method: 4, alpha_quality: 100 });
    const blob = new Blob([bytes], { type: 'image/webp' });
    await validateWebP(blob);
    sizes.push(bytes.byteLength);
  }
  assert.equal(new Set(sizes).size, 5, 'slider must change the actual encoded bytes');
  for (let index = 1; index < sizes.length; index++) assert.ok(sizes[index] > sizes[index - 1]);
  console.log('WebP bytes at Q1/Q25/Q50/Q75/Q100:', sizes.join('/'));
});

test('compression preserves dimensions and transparent pixels', async () => {
  await encoderReady;
  const binary = await readFile(new URL('dec/webp_dec.wasm', wasmRoot));
  await initDecode({ wasmBinary: binary });
  const image = fixture();
  const encoded = await encode(image, { quality: 50, alpha_quality: 100 });
  const decoded = await decode(encoded);
  assert.equal(decoded.width, image.width); assert.equal(decoded.height, image.height);
  assert.equal(decoded.data[3], 0);
  assert.equal(decoded.data[image.width * 4 + 3], 255);
});

test('rejects Safari-style PNG fallback even if the extension or MIME claims WebP', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await assert.rejects(validateWebP(new Blob([png], { type: 'image/png' })));
  await assert.rejects(validateWebP(new Blob([png], { type: 'image/webp' })));
});

test('never presents a larger encoded image as a smaller compressed download', async () => {
  await encoderReady;
  const encoded = new Blob([await encode(fixture(), { quality: 50 })], { type: 'image/webp' });
  const tiny = new File(['small original'], 'รูปต้นฉบับ.jpg', { type: 'image/jpeg' });
  const retained = await imageCompressionResult(tiny, encoded, 50);
  assert.equal(retained.keptOriginal, true);
  assert.equal(retained.blob, tiny);
  assert.equal(retained.name, tiny.name);
  assert.equal(retained.encodedSize, encoded.size);
  const large = new File([new Uint8Array(encoded.size + 100)], 'ภาพใหญ่.png', { type: 'image/png' });
  const compressed = await imageCompressionResult(large, encoded, 50);
  assert.equal(compressed.keptOriginal, false);
  assert.equal(compressed.name, 'ภาพใหญ่-compressed.webp');
  assert.equal(compressed.blob.type, 'image/webp');
});
