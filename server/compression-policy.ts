export function keepOriginalFile(originalBytes: number, encodedBytes: number): boolean {
  return !Number.isSafeInteger(encodedBytes) || encodedBytes <= 0 || encodedBytes >= originalBytes;
}

export interface VideoTiming {
  fps: number;
  frames: number;
  duration: number;
}

export function preservesVideoTiming(source: VideoTiming, encoded: VideoTiming): boolean {
  if (!(source.frames > 0) || source.frames !== encoded.frames) return false;
  if (!(source.fps > 0) || !(encoded.fps > 0)) return false;
  // Permit only container timebase rounding, never a 60 -> 30 conversion.
  if (Math.abs(source.fps - encoded.fps) > Math.max(0.01, source.fps * 0.002)) return false;
  return Math.abs(source.duration - encoded.duration) <= Math.max(2 / source.fps, source.duration * 0.002);
}
