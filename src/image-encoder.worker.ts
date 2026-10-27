import encode, { init } from '@jsquash/webp/encode.js';
import normalWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';

// Explicit asset URLs keep both WebAssembly variants available in production Docker builds.
const ready = init({ locateFile: (path: string) => path.includes('_simd') ? simdWasm : normalWasm });

self.onmessage = async (event: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number; quality: number }>) => {
  try {
    await ready;
    const { pixels, width, height, quality } = event.data;
    const rgba = new ImageData(new Uint8ClampedArray(pixels), width, height);
    const buffer = await encode(rgba, { quality: Math.min(100, Math.max(1, Math.round(quality))), method: 4, alpha_quality: 100 });
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'เข้ารหัส WebP ไม่สำเร็จ' });
  }
};
