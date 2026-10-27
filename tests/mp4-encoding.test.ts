import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mp4Encoding } from '../server/mp4-encoding.js';

test('real MP4 output plays with H.264/AAC and retains 60fps and all frames', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'toolbox-mp4-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const supportsHdr = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' }).includes(' zscale ');
  const probe = (path: string) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));
  try {
    for (const [name, video, audio] of [
      ['vp9', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8'], true],
      ['h264', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], true],
      ['high10', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p10le'], true],
      ['hdr', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc'], true],
      ['silent', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8'], false],
    ] as const) {
      await t.test(name, { skip: name === 'hdr' && !supportsHdr ? 'Local FFmpeg lacks zscale; verified separately in Docker' : false }, async () => {
      const input = join(dir, `${name}.mkv`), output = join(dir, `${name}.mp4`);
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-filter_threads', '1', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=60',
        ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
        '-t', '1', ...video, '-threads', '2', ...(audio ? ['-c:a', 'aac'] : []), input]);
      const source = probe(input).streams[0];
      if (name === 'hdr') assert.equal(source.color_transfer, 'smpte2084');
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-filter_threads', '2', '-i', input, ...mp4Encoding(0, 0, source), output]);
      const result = probe(output).streams;
      const v = result.find((s: {codec_type: string}) => s.codec_type === 'video');
      const a = result.find((s: {codec_type: string}) => s.codec_type === 'audio');
      assert.equal(v.codec_name, 'h264', name);
      assert.equal(v.pix_fmt, 'yuv420p', name);
      assert.equal(v.codec_tag_string, 'avc1', name);
      const [rate, denominator] = v.avg_frame_rate.split('/').map(Number);
      // Matroska rounds the 60fps source timestamps to milliseconds.
      assert.ok(Math.abs(rate / denominator - 60) < 0.12, name);
      assert.equal(v.nb_read_frames, '60', name);
      const timestamps = (path: string) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path], { encoding: 'utf8' })).frames.map((frame: {best_effort_timestamp_time: string}) => Number(frame.best_effort_timestamp_time)) as number[];
      const before = timestamps(input), after = timestamps(output);
      assert.equal(after.length, before.length);
      after.forEach((timestamp, index) => assert.ok(Math.abs(timestamp - before[index]) < 0.0001, `${name} frame ${index}`));
      if (audio) { assert.equal(a.codec_name, 'aac'); assert.equal(a.profile, 'LC'); assert.equal(a.channels, 2); }
      else assert.equal(a, undefined);
      if (name === 'hdr') assert.equal(v.color_transfer, 'bt709');
      if (name === 'h264') assert.equal(mp4Encoding(0, 0, source).includes('copy'), true);
      const bytes = await readFile(output);
      assert.ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'), name);
      execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
      console.log(`${name}: H.264 ${v.profile}, ${v.pix_fmt}, ${v.avg_frame_rate}, ${v.nb_read_frames} frames, decoded successfully`);
      });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
