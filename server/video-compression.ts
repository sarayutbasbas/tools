import type { Express } from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { keepOriginalFile, preservesVideoTiming, type VideoTiming } from './compression-policy.js';
import { safeDownloadName } from './youtube.js';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

function command(binary: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    let launchError: Error | undefined;
    child.stdout.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-2_000_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-6000); });
    child.on('error', (error) => { launchError = error; });
    child.on('close', (code) => {
      if (launchError) reject(launchError);
      else if (code !== 0) reject(new Error(stderr || `ประมวลผลไม่สำเร็จ (${code})`));
      else resolve(stdout);
    });
  });
}

interface VideoInfo extends VideoTiming {
  index: number;
  timeBase: string;
  width: number;
  height: number;
}

const fraction = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) return 0;
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator > 0 ? numerator / denominator : 0;
};

async function inspect(path: string, signal: AbortSignal): Promise<VideoInfo> {
  const data = JSON.parse(await command(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], signal));
  const video = data.streams?.find((stream: { codec_type: string; disposition?: { attached_pic?: number } }) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw new Error('ไฟล์นี้ไม่มีวิดีโอที่อ่านได้');
  let frames = Number(video.nb_frames) || 0;
  if (!frames) {
    const count = JSON.parse(await command(ffprobe, ['-v', 'error', '-select_streams', String(video.index), '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', path], signal));
    frames = Number(count.streams?.[0]?.nb_read_frames) || 0;
  }
  const fps = fraction(video.avg_frame_rate) || fraction(video.r_frame_rate);
  const timeBase = fraction(video.time_base) > 0 ? video.time_base : '1/60000';
  const duration = Number(video.duration || data.format?.duration);
  if (!(fps > 0 && frames > 0 && duration > 0)) throw new Error('อ่านจำนวนเฟรมและความยาวคลิปไม่สำเร็จ กรุณาเลือกวิดีโอที่เปิดดูได้');
  return { index: video.index, fps, frames, duration, timeBase, width: video.width, height: video.height };
}

export function registerVideoCompressionRoutes(app: Express) {
  const upload = multer({
    dest: join(tmpdir(), 'toolbox-uploads'),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, done) => {
      if (['video/mp4', 'video/quicktime'].includes(file.mimetype) || ['.mp4', '.mov'].includes(extname(file.originalname).toLowerCase())) done(null, true);
      else done(new Error('รองรับเฉพาะไฟล์ MP4 และ MOV'));
    },
  });

  app.post('/api/compress/video', upload.single('file'), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'ไม่พบไฟล์วิดีโอ' }); return; }
    const input = req.file.path;
    const output = `${input}-compressed.mp4`;
    const cleanup = () => Promise.all([rm(input, { force: true }), rm(output, { force: true })]);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let sending = false;
    try {
      const quality = Number(req.body.quality);
      if (!Number.isFinite(quality) || quality < 1 || quality > 100) throw new Error('คุณภาพต้องอยู่ระหว่าง 1–100');
      const source = await inspect(input, controller.signal);
      const maxWidth = quality < 36 ? 854 : quality < 66 ? 1280 : 1920;
      const audioRate = quality < 36 ? '64k' : quality < 66 ? '96k' : '160k';
      await command(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '4', '-filter_threads', '2', '-i', input,
        '-map', `0:${source.index}`, '-map', '0:a:0?',
        '-vf', `scale='trunc(min(${maxWidth},iw)/2)*2':-2`,
        '-c:v', 'libx264', '-threads', '4', '-preset', 'medium', '-crf', String(Math.round(42 - quality / 100 * 24)), '-pix_fmt', 'yuv420p',
        // Keep every frame at its original presentation time, including 59.94fps and VFR.
        '-fps_mode:v', 'passthrough', '-enc_time_base:v', source.timeBase,
        '-c:a', 'aac', '-b:a', audioRate, '-movflags', '+faststart', output,
      ], controller.signal);
      const candidate = await inspect(output, controller.signal);
      const encodedBytes = (await stat(output)).size;
      const timingOk = preservesVideoTiming(source, candidate);
      const keptOriginal = keepOriginalFile(req.file.size, encodedBytes) || !timingOk;
      const originalName = safeDownloadName(typeof req.body.filename === 'string' ? req.body.filename : req.file.originalname);
      const name = keptOriginal ? originalName : `${basename(originalName, extname(originalName))}-compressed.mp4`;
      const selected = keptOriginal ? source : candidate;
      res.setHeader('X-Compression-Result', keptOriginal ? 'original' : 'compressed');
      res.setHeader('X-Compression-Reason', !timingOk ? 'timing' : keptOriginal ? 'size' : 'smaller');
      res.setHeader('X-Encoded-Size', String(encodedBytes));
      res.setHeader('X-Source-Fps', String(source.fps));
      res.setHeader('X-Output-Fps', String(selected.fps));
      res.setHeader('X-Source-Frames', String(source.frames));
      res.setHeader('X-Output-Frames', String(selected.frames));
      res.type(keptOriginal && (req.file.mimetype === 'video/quicktime' || extname(originalName).toLowerCase() === '.mov') ? 'video/quicktime' : 'video/mp4');
      if (res.destroyed) throw new Error('ยกเลิกการบีบอัดแล้ว');
      res.download(keptOriginal ? input : output, name, () => { void cleanup(); });
      sending = true;
    } catch (error) {
      if (!res.destroyed && !res.headersSent) res.status(400).json({ error: error instanceof Error ? error.message : 'บีบอัดวิดีโอไม่สำเร็จ' });
    } finally { if (!sending) await cleanup(); }
  });
}
