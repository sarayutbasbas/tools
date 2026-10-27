import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Express } from 'express';
import { parseMediaLink, platformNames } from './media-links.js';
import { mp4Encoding, type VideoStreamInfo } from './mp4-encoding.js';

const require = createRequire(import.meta.url);
const fallbackBinary = require('youtube-dl-exec').constants.YOUTUBE_DL_PATH as string;
const localBinary = join(process.cwd(), '.toolbox-bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const binary = existsSync(localBinary) ? localBinary : fallbackBinary;

interface MediaFormat {
  format_id: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  ext?: string;
  abr?: number;
  tbr?: number;
  has_drm?: boolean;
  url?: string;
}
interface Metadata extends MediaFormat {
  title: string;
  duration?: number;
  is_live?: boolean;
  requested_formats?: MediaFormat[];
  formats?: MediaFormat[];
  id?: string;
  description?: string;
  entries?: Metadata[];
  _type?: string;
  notice?: string;
}

export const audioBitrates = [64, 96, 128, 192, 256, 320];

export function availableVideoQualities(formats: MediaFormat[]): number[] {
  return [...new Set(formats.filter((format) =>
    format.vcodec !== 'none' && !format.has_drm &&
    ['mp4', 'webm'].includes(format.ext || '') && Number.isInteger(format.height) && format.height! > 0,
  ).map((format) => format.height!))].sort((a, b) => b - a);
}

export function qualitySelector(format: string, quality: unknown = 'best'): string {
  if (quality !== 'best' && (typeof quality !== 'number' || !Number.isInteger(quality))) {
    throw new Error('กรุณาเลือกคุณภาพที่ถูกต้อง');
  }
  if (format === 'mp3') {
    if (quality !== 'best' && !audioBitrates.includes(quality as number)) throw new Error('bitrate นี้ไม่รองรับ');
    return 'bestaudio/best';
  }
  if (quality === 'best') return 'bv*+ba/b/bv*';
  if ((quality as number) <= 0 || (quality as number) > 16384) throw new Error('ความละเอียดนี้ไม่รองรับ');
  return `bv*[height=${quality}][ext=mp4]+ba[ext=m4a]/bv*[height=${quality}]+ba/b[height=${quality}]/bv*[height=${quality}]`;
}

export function normalizeMetadata(input: Metadata): Metadata {
  let metadata = input;
  if (input.entries) {
    const video = input.entries.find((entry) => entry && (
      entry.formats?.some((item) => item.vcodec !== 'none' && ['mp4', 'webm'].includes(item.ext || '')) ||
      ['mp4', 'webm'].includes(entry.ext || '')
    ));
    if (!video) throw new Error('โพสต์นี้ไม่มีวิดีโอให้ดาวน์โหลด กรุณาใช้ลิงก์วิดีโอหรือ Reel');
    metadata = { ...video, notice: 'โพสต์นี้มีหลายรายการ ระบบจะดาวน์โหลดวิดีโอแรก' };
  }
  if (!metadata.formats?.length && metadata.url && ['mp4', 'webm'].includes(metadata.ext || '')) {
    metadata = { ...metadata, formats: [{ ...metadata, format_id: metadata.format_id || 'http' }] };
  }
  if (!metadata.formats?.length) throw new Error('ไม่พบเสียงหรือวิดีโอในลิงก์นี้ กรุณาใช้ลิงก์คลิปโดยตรง');
  return { ...metadata, title: metadata.title || metadata.description || `video-${metadata.id || 'download'}` };
}

export function mediaError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'ดาวน์โหลดไม่สำเร็จ';
  if (/private|login required|log[ -]?in|sign[ -]?in|cookies|not logged|authentication|rate.limit|too many requests|HTTP Error (401|403|429)|not available.*guest/i.test(message)) {
    return 'แพลตฟอร์มจำกัดการเข้าถึงคลิปนี้หรือกำหนดให้ล็อกอิน กรุณาใช้คลิปสาธารณะที่เปิดดูได้ หรือทดลองอีกครั้งภายหลัง';
  }
  if (/unable to extract|webpage.*empty|video.*unavailable|not available|not found|404|unsupported url/i.test(message)) {
    return 'อ่านคลิปนี้ไม่สำเร็จ ลิงก์อาจหมดอายุ ถูกลบ หรือแพลตฟอร์มจำกัดการเข้าถึง กรุณาใช้ลิงก์คลิปโดยตรงและลองใหม่';
  }
  if (/matches no streams|does not contain any stream/i.test(message)) return 'คลิปนี้ไม่มีแทร็กเสียงสำหรับแปลงเป็น MP3';
  return message;
}

export function mp3Encoding(quality: number | 'best'): string[] {
  return quality === 'best' ? ['-q:a', '0'] : ['-b:a', `${quality}k`, '-ar', '44100'];
}

export const safeDownloadName = (name: string) =>
  name.normalize('NFC').replace(/[\u0000-\u001f\u007f\\/]/g, '_').trim() || 'download';

export function downloadPercent(progress: Record<string, unknown>): number | null {
  if (progress.status === 'finished') return 100;
  const total = Number(progress.total_bytes || progress.total_bytes_estimate);
  const downloaded = Number(progress.downloaded_bytes);
  return total > 0 && Number.isFinite(downloaded)
    ? Math.min(99, Math.max(0, Math.round(downloaded / total * 100))) : null;
}

export function preparationPercent(line: string, duration: number): number | null {
  if (!line.startsWith('out_time_us=') || !(duration > 0)) return null;
  const time = Number(line.slice('out_time_us='.length));
  return Number.isFinite(time) ? Math.max(0, Math.min(99, Math.round(time / (duration * 1e6) * 100))) : null;
}

function run(command: string, args: string[], signal: AbortSignal, onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { errors = (errors + chunk).slice(-8000); });
    if (onLine) {
      createInterface({ input: child.stdout }).on('line', onLine);
      createInterface({ input: child.stderr }).on('line', onLine);
    }
    let launchError: Error | undefined;
    child.on('error', (error) => { launchError = error; });
    child.on('close', (code) => {
      if (launchError) reject(launchError);
      else if (code !== 0) reject(new Error(errors.trim() || `${command} exited with code ${code}`));
      else resolve(output);
    });
  });
}

export function registerYoutubeRoutes(app: Express) {
  const downloads = new Map<string, { path: string; filename: string; cleanup: () => Promise<void> }>();
  const metadataCache = new Map<string, { raw: string; expires: number }>();
  const common = ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '--socket-timeout', '20', '--retries', '2'];
  const getMetadata = async (url: string, signal: AbortSignal) => {
    const cached = metadataCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.raw;
    metadataCache.delete(url);
    const result = await run(binary, [...common, '--dump-single-json', '--skip-download', '--', url], signal);
    const raw = JSON.stringify(normalizeMetadata(JSON.parse(result) as Metadata));
    if (metadataCache.size >= 20) metadataCache.delete(metadataCache.keys().next().value!);
    metadataCache.set(url, { raw, expires: Date.now() + 5 * 60 * 1000 });
    return raw;
  };

  app.post(['/api/media/info', '/api/youtube/info'], async (req, res) => {
    const link = parseMediaLink(req.body?.url);
    if (!link) {
      res.status(400).json({ error: 'กรุณาใส่ลิงก์คลิป YouTube, TikTok หรือ Instagram ที่ถูกต้อง' });
      return;
    }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const metadata = JSON.parse(await getMetadata(link.url, controller.signal)) as Metadata;
      if (metadata.is_live) throw new Error('คลิปนี้กำลังถ่ายทอดสด กรุณารอให้การถ่ายทอดสดสิ้นสุดก่อน');
      const formats = metadata.formats || [];
      const sourceAudioKbps = Math.max(0, ...formats.filter((item) => item.vcodec === 'none' && !item.has_drm)
        .map((item) => item.abr || item.tbr || 0));
      res.json({ title: metadata.title, platform: platformNames[link.platform], notice: metadata.notice,
        hasVideo: formats.some((item) => item.vcodec !== 'none' && !item.has_drm && ['mp4', 'webm'].includes(item.ext || '')),
        hasAudio: formats.some((item) => item.acodec !== 'none' && !item.has_drm),
        videoQualities: availableVideoQualities(formats), audioBitrates,
        sourceAudioKbps: sourceAudioKbps ? Math.round(sourceAudioKbps) : null });
    } catch (error) {
      // This is a media-processing failure, not a gateway failure. Cloudflare
      // can replace origin 502 responses with HTML and hide our JSON message.
      if (!res.destroyed) res.status(422).json({ error: mediaError(error) });
    }
  });

  app.get(['/api/media/files/:id', '/api/youtube/files/:id'], (req, res) => {
    const file = downloads.get(typeof req.params.id === 'string' ? req.params.id : '');
    if (!file) {
      res.status(404).json({ error: 'ไฟล์หมดอายุแล้ว กรุณาดาวน์โหลดอีกครั้ง' });
      return;
    }
    res.download(file.path, file.filename, () => { void file.cleanup(); });
  });

  app.post(['/api/media', '/api/youtube'], async (req, res) => {
    const { format, progress, quality = 'best' } = req.body || {};
    const link = parseMediaLink(req.body?.url);
    if (!link || !['mp3', 'mp4'].includes(format)) {
      res.status(400).json({ error: 'กรุณาใส่ลิงก์คลิป YouTube, TikTok หรือ Instagram ที่ถูกต้องและเลือกรูปแบบไฟล์' });
      return;
    }
    let selector: string;
    try { selector = qualitySelector(format, quality); }
    catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'คุณภาพไม่ถูกต้อง' });
      return;
    }

    const controller = new AbortController();
    let completed = false;
    res.on('close', () => { if (!completed) controller.abort(); });
    const emit = (event: Record<string, unknown>) => {
      if (progress && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    if (progress) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }
    const heartbeat = progress ? setInterval(() => emit({ type: 'heartbeat' }), 15000) : undefined;
    let jobDir: string | undefined;
    try {
      emit({ type: 'progress', phase: 'metadata', percent: null, message: 'กำลังอ่านข้อมูลคลิป…' });
      jobDir = await mkdtemp(join(tmpdir(), 'toolbox-media-'));
      const infoPath = join(jobDir, 'metadata.json');
      const sourceMetadata = await getMetadata(link.url, controller.signal);
      if (format === 'mp3' && !(JSON.parse(sourceMetadata) as Metadata).formats?.some((item) => item.acodec !== 'none' && !item.has_drm)) {
        throw new Error('คลิปนี้ไม่มีแทร็กเสียงสำหรับแปลงเป็น MP3');
      }
      if (format === 'mp4' && quality !== 'best' &&
          !availableVideoQualities((JSON.parse(sourceMetadata) as Metadata).formats || []).includes(quality)) {
        throw new Error(`คลิปนี้ไม่มีความละเอียด ${quality}p กรุณาอ่านข้อมูลคลิปและเลือกใหม่`);
      }
      await writeFile(infoPath, sourceMetadata);
      const rawMetadata = await run(binary, [...common, '--dump-single-json', '--skip-download',
        '--load-info-json', infoPath, '-f', selector], controller.signal);
      const metadata = JSON.parse(rawMetadata) as Metadata;
      if (metadata.is_live) throw new Error('คลิปนี้กำลังถ่ายทอดสด กรุณารอให้การถ่ายทอดสดสิ้นสุดก่อน');
      const filename = `${safeDownloadName(metadata.title)}.${format}`;
      await writeFile(infoPath, rawMetadata);
      const streams = metadata.requested_formats || [metadata];
      const paths: string[] = [];

      for (const [index, stream] of streams.entries()) {
        let downloadedPath = '';
        const label = streams.length > 1 ? `กำลังดาวน์โหลดสตรีม ${index + 1}/${streams.length}` : 'กำลังดาวน์โหลดคลิป';
        const update = (percent: number | null) => emit({
          type: 'progress', phase: 'download', percent, message: label, filename,
        });
        update(0);
        await run(binary, [
          ...common, '--load-info-json', infoPath, '-f', stream.format_id,
          '--no-simulate', '--newline', '--progress', '--no-colors', '--fixup', 'never',
          '--progress-template', 'download:TOOLBOX_PROGRESS:%(progress)j',
          '--print', 'after_move:TOOLBOX_FILE:%(filepath)j',
          '-o', join(jobDir, `source-${index}.%(ext)s`),
        ], controller.signal, (line) => {
          if (line.startsWith('TOOLBOX_PROGRESS:')) {
            try { update(downloadPercent(JSON.parse(line.slice('TOOLBOX_PROGRESS:'.length)))); } catch { /* Ignore non-JSON output. */ }
          } else if (line.startsWith('TOOLBOX_FILE:')) {
            downloadedPath = JSON.parse(line.slice('TOOLBOX_FILE:'.length)) as string;
          }
        });
        if (!downloadedPath || !existsSync(downloadedPath)) throw new Error('ไม่พบไฟล์ที่ดาวน์โหลดเสร็จแล้ว');
        paths.push(downloadedPath);
        update(100);
      }

      const outputPath = join(jobDir, `output.${format}`);
      const qualityLabel = quality === 'best' ? 'คุณภาพสูงสุด' : `${quality}${format === 'mp3' ? ' kbps' : 'p'}`;
      const preparing = format === 'mp4'
        ? `กำลังเตรียม MP4 ${qualityLabel} สำหรับ iPhone และเครื่องเล่นทั่วไป`
        : `กำลังเตรียมไฟล์ MP3 ${qualityLabel}`;
      emit({ type: 'progress', phase: 'prepare', percent: 0, message: preparing, filename });
      const inputs = paths.flatMap((path) => ['-i', path]);
      const videoIndex = streams.findIndex((stream) => stream.vcodec && stream.vcodec !== 'none');
      const audioIndex = streams.findIndex((stream) => stream.acodec && stream.acodec !== 'none');
      let videoSource: VideoStreamInfo = {};
      if (format === 'mp4') {
        const probe = JSON.parse(await run(process.env.FFPROBE_PATH || 'ffprobe', [
          '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', paths[Math.max(0, videoIndex)],
        ], controller.signal)) as { streams: VideoStreamInfo[] };
        if (!probe.streams[0]) throw new Error('ไม่พบภาพวิดีโอในไฟล์ที่ดาวน์โหลด');
        videoSource = probe.streams[0];
      }
      const encoding = format === 'mp3'
        ? ['-map', `${Math.max(0, audioIndex)}:a:0`, '-vn', '-c:a', 'libmp3lame', ...mp3Encoding(quality)]
        : mp4Encoding(videoIndex, audioIndex, videoSource);
      await run(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_threads', '2', ...inputs,
        ...encoding, '-metadata', `title=${metadata.title}`, '-progress', 'pipe:1', '-nostats', outputPath,
      ], controller.signal, (line) => {
        const percent = preparationPercent(line, metadata.duration || 0);
        if (percent !== null) emit({ type: 'progress', phase: 'prepare', percent, message: preparing, filename });
      });
      if (format === 'mp4') {
        const output = JSON.parse(await run(process.env.FFPROBE_PATH || 'ffprobe', [
          '-v', 'error', '-show_streams', '-of', 'json', outputPath,
        ], controller.signal)) as { streams: Array<VideoStreamInfo & { codec_type: string }> };
        const video = output.streams.find((item) => item.codec_type === 'video');
        if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
            output.streams.some((item) => item.codec_type === 'audio' && item.codec_name !== 'aac')) {
          throw new Error('เตรียม MP4 ที่รองรับเครื่องเล่นไม่สำเร็จ กรุณาลองอีกครั้ง');
        }
      }
      completed = true;
      if (progress) {
        const id = randomUUID();
        const directory = jobDir;
        const cleanup = async () => {
          clearTimeout(expiry);
          downloads.delete(id);
          await rm(directory, { recursive: true, force: true });
        };
        const expiry = setTimeout(() => { void cleanup(); }, 15 * 60 * 1000);
        expiry.unref();
        downloads.set(id, { path: outputPath, filename, cleanup });
        emit({ type: 'ready', phase: 'prepare', percent: 100, filename, downloadUrl: `/api/media/files/${id}` });
        res.end();
      } else {
        const directory = jobDir;
        res.download(outputPath, filename, () => { void rm(directory, { recursive: true, force: true }); });
      }
    } catch (error) {
      if (jobDir) await rm(jobDir, { recursive: true, force: true });
      const message = mediaError(error);
      if (!res.destroyed) {
        if (progress) { emit({ type: 'error', message }); res.end(); }
        else res.status(422).json({ error: message });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  });
}
