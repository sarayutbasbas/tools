import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { availableVideoQualities, audioBitrates, downloadPercent, mediaError, mp3Encoding, normalizeMetadata, preparationPercent, qualitySelector, registerYoutubeRoutes, safeDownloadName } from '../server/youtube.js';
import { parseMediaLink } from '../server/media-links.js';
test('accepts all public HTTP(S) media links and shared text without a site allowlist', () => {
  for (const url of [
    'https://vimeo.com/76979871', 'https://www.dailymotion.com/video/x123',
    'https://www.reddit.com/r/videos/comments/123/video/', 'https://x.com/creator/status/123',
    'https://soundcloud.com/creator/track', 'https://archive.org/details/video',
    'https://cdn.example.com/video.mp4', 'https://www.facebook.com/share/r/ABC/',
    'https://www.youtube.com/shorts/ABC', 'https://www.tiktok.com/@creator/video/123',
  ]) assert.ok(parseMediaLink(url), url);
  assert.equal(parseMediaLink('ดูคลิป https://vimeo.com/76979871 แชร์จากมือถือ')?.url, 'https://vimeo.com/76979871');
  assert.equal(parseMediaLink('https://youtube.com.evil.com/watch?v=123')?.platform, 'website');
  assert.equal(parseMediaLink('https://www.facebook.com/reel/123')?.platform, 'facebook');
});

test('rejects non-web schemes, credentials, private IPs, local domains and nonstandard ports', () => {
  for (const url of [
    'file:///etc/passwd', 'ftp://public.com/video', 'https://user:password@vimeo.com/123',
    'http://127.0.0.1/video', 'http://2130706433/video', 'http://0x7f000001/video',
    'http://10.0.0.1/video', 'http://172.20.0.1/video', 'http://192.168.1.1/video',
    'http://169.254.169.254/latest/meta-data', 'http://100.100.100.200/video',
    'http://localhost/video', 'http://host.docker.internal/video', 'http://router.local/video',
    'http://[::1]/video', 'http://[::ffff:127.0.0.1]/video', 'http://[fc00::1]/video',
    'https://vimeo.com:1111/123', 'http://metadata/video',
  ]) assert.equal(parseMediaLink(url), null, url);
});

test('additional-source metadata and file flow work without accounts and do not advertise platform names', async () => {
  const app = express(); app.use(express.json());
  const extractors: string[] = [];
  const stream = { format_id: 'audio', vcodec: 'none', acodec: 'aac', ext: 'm4a' };
  registerYoutubeRoutes(app, async (_command, args, _signal, onLine) => {
    if (args.includes('--use-extractors')) extractors.push(args[args.indexOf('--use-extractors') + 1]);
    if (args.includes('--dump-single-json')) return JSON.stringify({ title: 'Anonymous test', duration: 1, formats: [stream], requested_formats: [stream] });
    if (args.includes('--print')) { const path = args[args.indexOf('-o') + 1].replace('%(ext)s', 'm4a'); await writeFile(path, 'source fixture'); onLine?.('TOOLBOX_FILE:' + JSON.stringify(path)); }
    else await writeFile(args.at(-1)!, 'audio fixture');
    return '';
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    for (const [url, platform] of [['https://www.facebook.com/reel/12345/', 'Facebook'], ['https://vimeo.com/76979871', 'วิดีโอ'], ['https://cdn.example.com/video.mp4', 'วิดีโอ']]) {
      const request = (path: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, format: 'mp3', quality: 128, progress: true }) });
      const info = await request('/api/media/info'); assert.equal(info.status, 200); assert.equal((await info.json()).platform, platform);
      const job = await request('/api/media'); assert.equal(job.status, 200);
      const ready = (await job.text()).trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'ready'); assert.ok(ready);
      const file = await fetch(base + ready.downloadUrl); assert.equal(file.status, 200); assert.equal(await file.text(), 'audio fixture');
    }
    assert.deepEqual(extractors, []); // All built-in and generic extractors stay enabled.
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
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
