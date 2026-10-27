import assert from 'node:assert/strict';
import test from 'node:test';
import { keepOriginalFile, preservesVideoTiming } from '../server/compression-policy.js';

test('every returned candidate must be nonempty and strictly smaller than the source', () => {
  for (const original of [1, 100, 8_800_000, 500_000_000]) {
    for (const candidate of [0, 1, original - 1, original, original + 1, original * 5, NaN, Infinity]) {
      const kept = keepOriginalFile(original, candidate);
      const returned = kept ? original : candidate;
      assert.ok(returned <= original);
      if (!kept) assert.ok(returned > 0 && returned < original);
    }
  }
});

test('preserves 60 and fractional frame rates and rejects frame loss, drift and 60-to-30', () => {
  const original = { fps: 60, frames: 180, duration: 3 };
  assert.equal(preservesVideoTiming(original, { ...original }), true);
  assert.equal(preservesVideoTiming(original, { fps: 30, frames: 90, duration: 3 }), false);
  assert.equal(preservesVideoTiming(original, { ...original, frames: 179 }), false);
  assert.equal(preservesVideoTiming(original, { ...original, duration: 3.5 }), false);
  const fractional = { fps: 60000 / 1001, frames: 180, duration: 3.003 };
  assert.equal(preservesVideoTiming(fractional, { ...fractional }), true);
  assert.equal(preservesVideoTiming(fractional, { ...fractional, fps: 30000 / 1001 }), false);
});
