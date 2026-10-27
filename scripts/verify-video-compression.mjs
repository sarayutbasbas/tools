// docker compose exec -T toolbox node --input-type=module < scripts/verify-video-compression.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'toolbox-compression-qa-'));
const base = process.env.TOOLBOX_TEST_URL || 'http://127.0.0.1:1111';
const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
const probe = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', path], { encoding: 'utf8' })).streams[0];
const pts = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path], { encoding: 'utf8', maxBuffer: 10_000_000 })).frames.map((frame) => Number(frame.best_effort_timestamp_time));

try {
  for (const [name, rate] of [['60', '60'], ['59.94', '60000/1001'], ['24', '24']]) {
    run(['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${rate}`, '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-threads', '2', '-crf', '16', '-c:a', 'aac', '-pix_fmt', 'yuv420p', `${name}.mp4`]);
  }
  run(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=60', '-t', '2', '-vf', "select='if(lt(t,1),not(mod(n,2)),1)'", '-fps_mode', 'passthrough', '-enc_time_base', '1/60000', '-c:v', 'libx264', '-threads', '2', '-crf', '16', 'vfr.mp4']);
  run(['-f', 'lavfi', '-i', 'color=black:size=320x180:rate=60', '-t', '1', '-c:v', 'libx264', '-threads', '2', '-crf', '51', 'black.mp4']);
  run(['-i', 'black.mp4', '-c', 'copy', '-bsf:v', 'filter_units=remove_types=6', '-map_metadata', '-1', 'tiny.mov']);

  for (const [name, quality, expectOriginal] of [
    ['60.mp4', 15, false], ['60.mp4', 55, false], ['60.mp4', 100, null],
    ['59.94.mp4', 25, false], ['24.mp4', 25, false], ['vfr.mp4', 25, false], ['tiny.mov', 100, true],
  ]) {
    const path = join(directory, name);
    const original = await readFile(path);
    const source = probe(path);
    const body = new FormData();
    body.append('file', new Blob([original], { type: name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' }), name);
    body.append('filename', name === 'tiny.mov' ? 'ต้นฉบับ.mov' : name);
    body.append('quality', String(quality));
    const response = await fetch(base + '/api/compress/video', { method: 'POST', body });
    assert.ok(response.ok, await (response.ok ? Promise.resolve('') : response.text()));
    const bytes = Buffer.from(await response.arrayBuffer());
    const retained = response.headers.get('X-Compression-Result') === 'original';
    if (expectOriginal !== null) assert.equal(retained, expectOriginal, name + ' reason=' + response.headers.get('X-Compression-Reason'));
    assert.ok(bytes.length <= original.length, 'returned file can never exceed the source');
    if (retained) {
      assert.deepEqual(bytes, original, 'original fallback must be byte-for-byte original');
      if (name.endsWith('.mov')) {
        assert.match(response.headers.get('Content-Type'), /video\/quicktime/);
        assert.ok(response.headers.get('Content-Disposition').includes("filename*=UTF-8''"));
      }
    }
    const outputPath = join(directory, 'result.mp4'); await writeFile(outputPath, bytes);
    const output = probe(outputPath);
    assert.equal(Number(output.nb_frames), Number(source.nb_frames));
    const sourcePts = pts(path), outputPts = pts(outputPath);
    assert.equal(outputPts.length, sourcePts.length);
    for (let index = 0; index < sourcePts.length; index++) assert.ok(Math.abs(sourcePts[index] - outputPts[index]) <= .0001, 'presentation timestamps must remain unchanged');
    console.log(JSON.stringify({ input: name, quality, beforeBytes: original.length, afterBytes: bytes.length, sourceFps: source.avg_frame_rate, outputFps: output.avg_frame_rate, frames: output.nb_frames, keptOriginal: retained }));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
