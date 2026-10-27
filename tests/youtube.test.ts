import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { availableVideoQualities, audioBitrates, downloadPercent, mediaError, mp3Encoding, normalizeMetadata, preparationPercent, qualitySelector, registerYoutubeRoutes, safeDownloadName } from '../server/youtube.js';
import { parseMediaLink } from '../server/media-links.js';

test('accepts YouTube, TikTok full/short links, Instagram posts and Reels, and mobile share text', () => {
  for (const url of ['https://www.youtube.com/watch?v=test', 'https://youtu.be/test']) assert.equal(parseMediaLink(url)?.platform, 'youtube');
  for (const url of [
    'https://www.tiktok.com/@creator/video/7059698374567611694',
    'https://vm.tiktok.com/ABC123/', 'https://vt.tiktok.com/ABC123/', 'https://www.tiktok.com/t/ABC123/',
  ]) assert.equal(parseMediaLink(url)?.platform, 'tiktok');
  for (const url of ['https://www.instagram.com/reel/ABC/', 'https://instagram.com/p/ABC/', 'https://www.instagram.com/share/reel/ABC/']) assert.equal(parseMediaLink(url)?.platform, 'instagram');
  assert.equal(parseMediaLink('ดูคลิปนี้ https://vt.tiktok.com/ABC123/ แชร์จาก TikTok')?.url, 'https://vt.tiktok.com/ABC123/');
});

test('rejects lookalike domains, credentials, custom ports, and profile links', () => {
  for (const url of [
    'https://instagram.com.evil.test/reel/ABC', 'https://evil.test/?url=https://www.tiktok.com/@x/video/123',
    'https://www.instagram.com@evil.test/reel/ABC', 'https://user:password@www.instagram.com/reel/ABC',
    'https://www.instagram.com:1111/reel/ABC', 'https://www.instagram.com/creator/',
    'https://www.tiktok.com/@creator', 'file:///etc/passwd',
  ]) assert.equal(parseMediaLink(url), null, url);
});

test('handles Instagram metadata with unknown codecs and picks the first video from a carousel', () => {
  const video = { title: 'Reel ภาษาไทย', format_id: 'http', ext: 'mp4', url: 'https://cdn.example/video.mp4', height: 1280 };
  const result = normalizeMetadata({ title: 'post', format_id: '', entries: [
    { title: 'photo', format_id: '', ext: 'jpg' }, video,
  ] });
  assert.equal(result.title, video.title);
  assert.ok(result.notice);
  assert.deepEqual(availableVideoQualities(result.formats || []), [1280]);
  assert.throws(() => normalizeMetadata({ title: 'photo', format_id: '', ext: 'jpg' }), /ไม่พบเสียงหรือวิดีโอ/);
});

test('explains platform authentication failures and missing audio', () => {
  assert.match(mediaError(new Error('Instagram login required')), /ล็อกอิน/);
  assert.match(mediaError(new Error('HTTP Error 429 Too Many Requests')), /จำกัดการเข้าถึง/);
  assert.match(mediaError(new Error('Stream map matches no streams')), /ไม่มีแทร็กเสียง/);
});

test('video quality choices contain actual playable heights, deduplicated and sorted', () => {
  assert.deepEqual(availableVideoQualities([
    { format_id: '1', height: 720, vcodec: 'avc1', ext: 'mp4' },
    { format_id: '2', height: 1080, vcodec: 'vp9', ext: 'webm' },
    { format_id: '3', height: 720, vcodec: 'av01', ext: 'mp4' },
    { format_id: '4', height: 2160, vcodec: 'av01', ext: 'mp4', has_drm: true },
    { format_id: 'audio', vcodec: 'none', ext: 'm4a' },
    { format_id: 'storyboard', height: 90, vcodec: 'none', ext: 'mhtml' },
  ]), [1080, 720]);
});

test('selected resolution is exact and never silently falls back to another height', () => {
  for (const selector of qualitySelector('mp4', 720).split('/')) assert.ok(selector.includes('[height=720]'));
  assert.equal(qualitySelector('mp3', 192), 'bestaudio/best');
  assert.throws(() => qualitySelector('mp4', '720;bad'));
  assert.throws(() => qualitySelector('mp4', 720.5));
  assert.throws(() => qualitySelector('mp3', 999));
  assert.throws(() => qualitySelector('mp4', 0));
});

test('all offered MP3 bitrates are encoded at the selected rate', () => {
  for (const bitrate of audioBitrates) {
    assert.ok(mp3Encoding(bitrate).includes(`${bitrate}k`));
    assert.doesNotThrow(() => qualitySelector('mp3', bitrate));
  }
  assert.deepEqual(mp3Encoding('best'), ['-q:a', '0']);
});

test('invalid quality requests fail before starting a media job', async () => {
  const app = express();
  app.use(express.json());
  registerYoutubeRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/youtube`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/jNQXAC9IVRw', format: 'mp3', quality: 999, progress: true }),
    });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('preserves Thai vowels, tone marks, punctuation and the complete video title', () => {
  const title = 'Aunchi | เมดเลย์เพลงเพราะที่สุดของโบว์ สุนิตา [Medley]';
  assert.equal(safeDownloadName(title), title);
  assert.equal(safeDownloadName(`${title} ${title}`), `${title} ${title}`);
  assert.equal(safeDownloadName('เพลง "รัก" 🎵'), 'เพลง "รัก" 🎵');
});

test('removes path separators and header control characters without stripping Unicode marks', () => {
  assert.equal(safeDownloadName('เพลง/รัก\\ใหม่\r\n'), 'เพลง_รัก_ใหม่__');
});

test('download percentage uses actual bytes, estimates, and completion events', () => {
  assert.equal(downloadPercent({ downloaded_bytes: 25, total_bytes: 100 }), 25);
  assert.equal(downloadPercent({ downloaded_bytes: 50, total_bytes_estimate: 200 }), 25);
  assert.equal(downloadPercent({ downloaded_bytes: 100 }), null);
  assert.equal(downloadPercent({ downloaded_bytes: 200, total_bytes_estimate: 100 }), 99);
  assert.equal(downloadPercent({ status: 'finished' }), 100);
});

test('preparation percentage uses FFmpeg output time and reserves 100 for successful completion', () => {
  assert.equal(preparationPercent('out_time_us=5000000', 20), 25);
  assert.equal(preparationPercent('out_time_us=20000000', 20), 99);
  assert.equal(preparationPercent('out_time_us=N/A', 20), null);
  assert.equal(preparationPercent('out_time_us=5000000', 0), null);
  assert.equal(preparationPercent('progress=continue', 20), null);
});

test('download response carries the complete Thai filename in its UTF-8 header', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'toolbox-filename-test-'));
  const path = join(directory, 'output.mp3');
  const filename = 'Aunchi | เมดเลย์เพลงเพราะที่สุดของโบว์ สุนิตา [Medley].mp3';
  await writeFile(path, 'filename regression fixture');
  const app = express();
  app.get('/download', (_req, res) => res.download(path, safeDownloadName(filename)));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/download`);
    assert.equal(response.status, 200);
    const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    assert.ok(encoded);
    assert.equal(decodeURIComponent(encoded), filename);
    await response.arrayBuffer();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
