import { useEffect, useRef, useState } from 'react';
import { parseMediaLink } from '../server/media-links';
import { compressImage } from './image-compression';
import type { ImageCompressionResult } from './image-compression-result';
import { keepOriginalFile } from '../server/compression-policy';
import { readApiJson, requireApiStream } from './api-response';
import {
  ArrowDownToLine, Check, ChevronRight, CircleAlert, FileAudio, FileVideo,
  Gauge, Image as ImageIcon, Link2, LoaderCircle, LockKeyhole, PackageOpen,
  Sparkles, UploadCloud, Video,
} from 'lucide-react';

type Tool = 'download' | 'compress';
type DownloadFormat = 'mp3' | 'mp4';
type Status = 'idle' | 'loading' | 'success' | 'error';
type ClipInfo = { title: string; platform: string; hasVideo: boolean; hasAudio: boolean; notice?: string; videoQualities: number[]; audioBitrates: number[]; sourceAudioKbps: number | null };

const readableSize = (bytes: number) => {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function StatusLine({ status, text }: { status: Status; text: string }) {
  if (status === 'idle') return null;
  const Icon = status === 'loading' ? LoaderCircle : status === 'success' ? Check : CircleAlert;
  return (
    <div className={`status-line ${status}`} role="status" aria-live="polite">
      <Icon size={17} className={status === 'loading' ? 'spin' : ''} />
      <span>{text}</span>
    </div>
  );
}

function DownloadTool() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<DownloadFormat>('mp3');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [filename, setFilename] = useState('');
  const [videoQuality, setVideoQuality] = useState('best');
  const [audioQuality, setAudioQuality] = useState('best');
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [infoStatus, setInfoStatus] = useState<Status>('idle');
  const [infoError, setInfoError] = useState('');
  const [infoRetry, setInfoRetry] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    setClipInfo(null);
    setVideoQuality('best');
    setInfoError('');
    const link = parseMediaLink(url);
    if (!link) { setInfoStatus('idle'); return; }
    const controller = new AbortController();
    setInfoStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/media/info', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: link.url }), signal: controller.signal,
        });
        const data = await readApiJson<ClipInfo>(response);
        if (controller.signal.aborted) return;
        setClipInfo(data);
        setInfoStatus('success');
      } catch (error) {
        if (controller.signal.aborted) return;
        setInfoStatus('error');
        setInfoError(error instanceof Error ? error.message : 'อ่านคุณภาพของคลิปไม่สำเร็จ');
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, infoRetry]);

  const handleDownload = async () => {
    const link = parseMediaLink(url);
    if (!link) {
      setStatus('error');
      setMessage('วางลิงก์คลิป YouTube, TikTok หรือ Instagram ที่ถูกต้องก่อนดาวน์โหลด');
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    setPercent(null);
    setFilename('');
    setMessage('กำลังอ่านข้อมูลคลิป…');
    try {
      const response = await fetch('/api/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.url, format, progress: true,
          quality: (format === 'mp3' ? audioQuality : videoQuality) === 'best' ? 'best' : Number(format === 'mp3' ? audioQuality : videoQuality) }),
        signal: controller.signal,
      });
      await requireApiStream(response);
      if (!response.body) throw new Error('เบราว์เซอร์ไม่รองรับการแสดงความคืบหน้า');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ready: { filename: string; downloadUrl: string } | undefined;
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); }
        catch { throw new Error('การเชื่อมต่อกับเซิร์ฟเวอร์ขาดหาย กรุณาลองดาวน์โหลดอีกครั้ง'); }
        if (!event || typeof event !== 'object') throw new Error('ข้อมูลความคืบหน้าจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        if (event.type === 'error') throw new Error(event.message || 'ดาวน์โหลดไม่สำเร็จ');
        if (event.type === 'progress') {
          setPercent(event.percent);
          setMessage(event.message);
          if (event.filename) setFilename(event.filename);
        } else if (event.type === 'ready') {
          ready = { filename: event.filename, downloadUrl: event.downloadUrl };
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          consumeLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (done) { if (buffer.trim()) consumeLine(buffer); break; }
      }
      if (!ready) throw new Error('การเชื่อมต่อขาดหาย กรุณาลองดาวน์โหลดอีกครั้ง');

      setMessage('กำลังรับไฟล์ลงเครื่อง');
      setPercent(0);
      const fileResponse = await fetch(ready.downloadUrl, { signal: controller.signal });
      if (!fileResponse.ok) await readApiJson(fileResponse);
      if (!fileResponse.body || !/^(audio\/|video\/|application\/octet-stream)/i.test(fileResponse.headers.get('content-type') || '')) {
        throw new Error('เซิร์ฟเวอร์ไม่ได้ส่งไฟล์กลับมา กรุณาลองดาวน์โหลดอีกครั้ง');
      }
      const total = Number(fileResponse.headers.get('content-length'));
      const fileReader = fileResponse.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await fileReader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        setPercent(total > 0 ? Math.min(99, Math.round(received / total * 100)) : null);
      }
      const blob = new Blob(chunks, { type: fileResponse.headers.get('content-type') || 'application/octet-stream' });
      downloadBlob(blob, ready.filename);
      setPercent(100);
      setStatus('success');
      setMessage(`ดาวน์โหลด ${format.toUpperCase()} เรียบร้อยแล้ว`);
    } catch (error) {
      controller.abort();
      if (error instanceof Error && error.name === 'AbortError') return;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'ดาวน์โหลดไม่สำเร็จ');
    }
  };

  return (
    <section className="tool-panel" aria-labelledby="download-title">
      <div className="panel-heading">
        <div><p className="section-kicker">ดึงจากลิงก์</p><h1 id="download-title">Media Downloader</h1></div>
        <div className="privacy-note"><LockKeyhole size={15} /> ไม่เก็บประวัติ</div>
      </div>

      <p className="intro">ดาวน์โหลดเสียงและวิดีโอจาก YouTube, TikTok และ Instagram</p>

      <div className="field-stack">
        <label htmlFor="media-url">ลิงก์วิดีโอ</label>
        <div className="url-input">
          <Link2 size={20} aria-hidden="true" />
          <input id="media-url" value={url} disabled={status === 'loading'} onChange={(event) => { setUrl(event.target.value); setStatus('idle'); }}
            placeholder="วางลิงก์ หรือข้อความที่แชร์จากแอป…" inputMode="url" autoComplete="off" />
          {url && <button className="clear-button" disabled={status === 'loading'} onClick={() => { setUrl(''); setStatus('idle'); }} aria-label="ล้างลิงก์">×</button>}
        </div>
      </div>

      {clipInfo && <div className="clip-info"><span className="source-platform">{clipInfo.platform}</span><p className="clip-title">{clipInfo.title}</p>
        {clipInfo.notice && <p className="quality-hint">{clipInfo.notice}</p>}</div>}

      <fieldset className="format-fieldset" disabled={status === 'loading'}>
        <legend>รูปแบบไฟล์</legend>
        <div className="format-grid">
          <button className={`format-card ${format === 'mp3' ? 'selected' : ''}`} onClick={() => setFormat('mp3')} aria-pressed={format === 'mp3'}>
            <span className="format-icon"><FileAudio size={23} /></span>
            <span><strong>MP3</strong><small>เสียงคุณภาพสูง · ไฟล์เล็ก</small></span>
            <span className="radio-mark">{format === 'mp3' && <Check size={13} />}</span>
          </button>
          <button className={`format-card ${format === 'mp4' ? 'selected' : ''}`} onClick={() => setFormat('mp4')} aria-pressed={format === 'mp4'}>
            <span className="format-icon"><FileVideo size={23} /></span>
            <span><strong>MP4</strong><small>ภาพและเสียง · พร้อมดู</small></span>
            <span className="radio-mark">{format === 'mp4' && <Check size={13} />}</span>
          </button>
        </div>
      </fieldset>

      <div className="download-quality">
        <label htmlFor="download-quality">{format === 'mp4' ? 'ความละเอียดวิดีโอ' : 'คุณภาพเสียง MP3'}</label>
        <select id="download-quality" value={format === 'mp4' ? videoQuality : audioQuality}
          disabled={status === 'loading' || (format === 'mp4' && (!clipInfo || infoStatus === 'loading'))}
          onChange={(event) => {
            if (format === 'mp4') setVideoQuality(event.target.value); else setAudioQuality(event.target.value);
            setStatus('idle');
          }}>
          <option value="best">{format === 'mp4' ? 'ความละเอียดสูงสุดที่มี' : 'คุณภาพสูงสุด (VBR)'}</option>
          {(format === 'mp4' ? clipInfo?.videoQualities || [] : clipInfo?.audioBitrates || [64, 96, 128, 192, 256, 320]).map((value) => (
            <option key={value} value={value}>{value}{format === 'mp4' ? 'p' : ' kbps'}</option>
          ))}
        </select>
        {infoStatus === 'loading' && <p className="quality-hint" role="status"><LoaderCircle size={14} className="spin" />กำลังตรวจสอบคุณภาพที่คลิปมี…</p>}
        {infoStatus === 'error' && <div className="quality-error" role="status"><span>{infoError}</span><button onClick={() => setInfoRetry((value) => value + 1)}>ลองใหม่</button></div>}
        {format === 'mp4' && infoStatus === 'idle' && <p className="quality-hint">วางลิงก์เพื่อดูความละเอียดที่คลิปนี้มีจริง</p>}
        {format === 'mp4' && clipInfo && !clipInfo.videoQualities.length && <p className="quality-hint">{clipInfo.hasVideo ? 'แหล่งนี้ไม่ระบุความละเอียด ระบบจะใช้คุณภาพสูงสุดที่มี' : 'ลิงก์นี้ไม่มีวิดีโอให้ดาวน์โหลด'}</p>}
        {format === 'mp3' && <p className="quality-hint">{clipInfo?.sourceAudioKbps ? `เสียงต้นฉบับสูงสุดประมาณ ${clipInfo.sourceAudioKbps} kbps · ` : ''}bitrate สูงขึ้นทำให้ไฟล์ใหญ่ขึ้น แต่ไม่เพิ่มรายละเอียดจากต้นฉบับ</p>}
        {format === 'mp3' && clipInfo && !clipInfo.hasAudio && <p className="quality-hint">คลิปนี้ไม่มีแทร็กเสียงสำหรับแปลงเป็น MP3 เลือก MP4 เพื่อดาวน์โหลดวิดีโอ</p>}
      </div>

      <button className="primary-button" onClick={handleDownload}
        disabled={status === 'loading' || infoStatus === 'loading' || (format === 'mp4' && (!clipInfo || !clipInfo.hasVideo)) || (format === 'mp3' && clipInfo?.hasAudio === false)}>
        {status === 'loading' ? <LoaderCircle size={19} className="spin" /> : <ArrowDownToLine size={19} />}
        {status === 'loading' ? 'กำลังเตรียมไฟล์' : `ดาวน์โหลด ${format.toUpperCase()}`}
      </button>
      {(status === 'loading' || status === 'success') && (
        <div className="download-progress">
          <div className="download-progress-heading"><span>{message}</span><strong>{percent === null ? '…' : `${percent}%`}</strong></div>
          <progress max="100" value={percent ?? undefined} aria-label={message} />
          {filename && <p className="download-filename">{filename}</p>}
        </div>
      )}
      <StatusLine status={status} text={message} />
      <p className="legal-note">ดาวน์โหลดเฉพาะสื่อที่คุณเป็นเจ้าของหรือได้รับอนุญาตให้ใช้งาน</p>
    </section>
  );
}

function CompressorTool() {
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(72);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ blob: Blob; name: string; keptOriginal: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [imageResult, setImageResult] = useState<ImageCompressionResult | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ sourceFps: number; outputFps: number; frames: number } | null>(null);

  useEffect(() => { setResult(null); setImageResult(null); setVideoInfo(null); setStatus('idle'); }, [file, quality]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const pickFile = (candidate?: File) => {
    if (!candidate) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
    if (!allowed.includes(candidate.type)) {
      setStatus('error'); setMessage('รองรับ JPG, PNG, WebP, MP4 และ MOV เท่านั้น'); return;
    }
    if (candidate.size > 500 * 1024 * 1024) {
      setStatus('error'); setMessage('ไฟล์ต้องมีขนาดไม่เกิน 500 MB'); return;
    }
    setFile(candidate);
  };

  const compress = async () => {
    if (!file) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    setMessage(file.type.startsWith('image/') ? 'กำลังปรับสมดุลรายละเอียดและขนาดไฟล์…' : 'กำลังเข้ารหัสวิดีโอ งานนี้อาจใช้เวลาหลายนาที…');
    try {
      let blob: Blob;
      let name: string;
      let compressedImage: ImageCompressionResult | undefined;
      let keptOriginal = false;
      let reason = '';
      if (file.type.startsWith('image/')) {
        compressedImage = await compressImage(file, quality, controller.signal);
        blob = compressedImage.blob;
        name = compressedImage.name;
        keptOriginal = compressedImage.keptOriginal;
        setImageResult(compressedImage);
      } else {
        const form = new FormData();
        form.append('file', file); form.append('quality', String(quality)); form.append('filename', file.name);
        const response = await fetch('/api/compress/video', { method: 'POST', body: form, signal: controller.signal });
        if (!response.ok) {
          await readApiJson(response);
        }
        if (!/^(video\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) {
          throw new Error('เซิร์ฟเวอร์ไม่ได้ส่งไฟล์วิดีโอกลับมา กรุณาลองอีกครั้ง');
        }
        blob = await response.blob();
        const sourceFps = Number(response.headers.get('X-Source-Fps'));
        const outputFps = Number(response.headers.get('X-Output-Fps'));
        const sourceFrames = Number(response.headers.get('X-Source-Frames'));
        const outputFrames = Number(response.headers.get('X-Output-Frames'));
        const timingOk = sourceFps > 0 && outputFps > 0 && sourceFrames > 0 && sourceFrames === outputFrames && Math.abs(sourceFps - outputFps) <= Math.max(.01, sourceFps * .002);
        keptOriginal = response.headers.get('X-Compression-Result') === 'original' || keepOriginalFile(file.size, blob.size) || !timingOk;
        reason = !timingOk ? 'timing' : response.headers.get('X-Compression-Reason') || '';
        if (keptOriginal) blob = file;
        name = keptOriginal ? file.name : `${file.name.replace(/\.[^.]+$/, '')}-compressed.mp4`;
        if (sourceFps > 0) setVideoInfo({ sourceFps, outputFps: keptOriginal ? sourceFps : outputFps, frames: sourceFrames });
      }
      // Final client-side guard applies to every type, even if a server/encoder regresses.
      if (keepOriginalFile(file.size, blob.size)) { blob = file; name = file.name; keptOriginal = true; }
      setResult({ blob, name, keptOriginal }); setStatus('success');
      const saved = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
      setMessage(keptOriginal
        ? reason === 'timing' ? 'คงไฟล์ต้นฉบับไว้ เพื่อรักษาเฟรมและจังหวะการเล่นเดิม'
          : 'การตั้งค่านี้ลดขนาดไม่ได้ จึงคงไฟล์ต้นฉบับไว้ ไม่ส่งไฟล์ที่ใหญ่กว่าเดิม'
        : saved ? `ลดขนาดได้ ${saved}% พร้อมดาวน์โหลดแล้ว` : 'ไฟล์เล็กลงแล้ว พร้อมดาวน์โหลด');
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'บีบอัดไม่สำเร็จ');
    }
  };

  return (
    <section className="tool-panel" aria-labelledby="compress-title">
      <div className="panel-heading">
        <div><p className="section-kicker">ทำให้เบาลง</p><h1 id="compress-title">Media Compressor</h1></div>
        <div className="privacy-note"><LockKeyhole size={15} /> ภาพทำบนเครื่อง</div>
      </div>
      <p className="intro">ลดขนาดรูปและวิดีโอ โดยคุมระดับรายละเอียดได้เอง</p>

      {!file ? (
        <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); pickFile(event.dataTransfer.files[0]); }} role="button" tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}>
          <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(event) => pickFile(event.target.files?.[0])} />
          <span className="upload-mark"><UploadCloud size={27} /></span>
          <strong>แตะเพื่อเลือก หรือลากไฟล์มาวาง</strong>
          <span>JPG, PNG, WebP, MP4, MOV · สูงสุด 500 MB</span>
        </div>
      ) : (
        <div className="file-card">
          <div className="file-thumb">{file.type.startsWith('image/') ? <ImageIcon size={25} /> : <Video size={25} />}</div>
          <div className="file-meta"><strong>{file.name}</strong><span>{readableSize(file.size)} · {file.type.split('/')[1].toUpperCase()}</span></div>
          <button className="replace-button" disabled={status === 'loading'} onClick={() => { setFile(null); setResult(null); }}>เปลี่ยน</button>
        </div>
      )}

      <div className="quality-block">
        <div className="quality-heading"><label htmlFor="quality">คุณภาพไฟล์</label><output htmlFor="quality">{quality}%</output></div>
        <input id="quality" type="range" min="1" max="100" value={quality} disabled={status === 'loading'} onChange={(event) => setQuality(Number(event.target.value))}
          style={{ '--range-value': `${quality}%` } as React.CSSProperties} />
        <div className="range-labels"><span>ไฟล์เล็ก</span><span>สมดุล</span><span>คมชัด</span></div>
        <p className="quality-hint">ปรับคุณภาพแล้วกดเริ่มบีบอัดใหม่เพื่ออัปเดตผลลัพธ์</p>
        {file?.type.startsWith('video/') && <p className="quality-hint">คงอัตราเฟรมเดิมทุกระดับคุณภาพ ไม่ลด 60 fps เป็น 30 fps</p>}
      </div>

      {file && result && (
        <div className="comparison" aria-label="เปรียบเทียบขนาดไฟล์">
          <div><span>ก่อน</span><strong>{readableSize(file.size)}</strong></div>
          <ChevronRight size={18} />
          <div className="after"><span>หลัง</span><strong>{readableSize(result.blob.size)}</strong></div>
        </div>
      )}
      {imageResult && !imageResult.keptOriginal && <p className="quality-hint">WebP ที่คุณภาพ {imageResult.quality}%: {readableSize(result?.blob.size || 0)} · เข้ารหัสบนเครื่อง ไม่อัปโหลดภาพ</p>}
      {videoInfo && <p className="quality-hint">อัตราเฟรม {videoInfo.sourceFps.toFixed(2)} → {videoInfo.outputFps.toFixed(2)} fps · คงครบ {videoInfo.frames.toLocaleString()} เฟรม</p>}

      {result ? (
        <button className="primary-button" onClick={() => downloadBlob(result.blob, result.name)}><ArrowDownToLine size={19} />{result.keptOriginal ? 'ดาวน์โหลดไฟล์เดิม' : 'ดาวน์โหลดไฟล์ที่บีบอัด'}</button>
      ) : (
        <button className="primary-button" onClick={compress} disabled={!file || status === 'loading'}>
          {status === 'loading' ? <LoaderCircle size={19} className="spin" /> : <Sparkles size={19} />}
          {status === 'loading' ? 'กำลังบีบอัด' : 'เริ่มบีบอัดไฟล์'}
        </button>
      )}
      <StatusLine status={status} text={message} />
    </section>
  );
}

export default function App() {
  const [activeTool, setActiveTool] = useState<Tool>('download');
  const [serverStatus, setServerStatus] = useState<Status>('loading');
  useEffect(() => {
    let stopped = false;
    let request: AbortController | undefined;
    const check = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        const result = await readApiJson<{ ok: boolean }>(response);
        if (!stopped && request === controller) setServerStatus(result.ok ? 'success' : 'error');
      } catch { if (!stopped && request === controller) setServerStatus('error'); }
      finally { clearTimeout(timeout); }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 30000);
    window.addEventListener('online', check);
    return () => { stopped = true; clearInterval(timer); request?.abort(); window.removeEventListener('online', check); };
  }, []);
  return (
    <div className="app-shell">
      <header className="mobile-header">
        <a className="brand" href="#" aria-label="Toolbox home"><img className="brand-mark" src="/brand/toolbox-mark-128.png" width="36" height="36" alt="" /><span>Toolbox</span></a>
        <span className={`online-dot ${serverStatus}`} role="status">{serverStatus === 'success' ? 'พร้อมใช้งาน' : serverStatus === 'loading' ? 'กำลังตรวจสอบ' : 'เซิร์ฟเวอร์ไม่พร้อม'}</span>
      </header>
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Toolbox home"><img className="brand-mark" src="/brand/toolbox-mark-128.png" width="36" height="36" alt="" /><span>Toolbox</span></a>
        <p className="sidebar-caption">เครื่องมือ</p>
        <nav aria-label="เลือกเครื่องมือ">
          <button className={activeTool === 'download' ? 'active' : ''} onClick={() => setActiveTool('download')}><ArrowDownToLine size={20} /><span>ดาวน์โหลด</span></button>
          <button className={activeTool === 'compress' ? 'active' : ''} onClick={() => setActiveTool('compress')}><Gauge size={20} /><span>บีบอัดไฟล์</span></button>
          <button className="disabled-tool" disabled><PackageOpen size={20} /><span>เครื่องมือถัดไป</span><small>เร็ว ๆ นี้</small></button>
        </nav>
        <div className="sidebar-foot"><span className="online-pulse" /><span><strong>ทำงานบนเครื่องคุณ</strong><small>ไม่สร้างบัญชี · ไม่เก็บประวัติ</small></span></div>
      </aside>
      <main>
        <div className="mobile-tabs" role="tablist" aria-label="เครื่องมือ">
          <button role="tab" aria-selected={activeTool === 'download'} onClick={() => setActiveTool('download')}><ArrowDownToLine size={18} />ดาวน์โหลด</button>
          <button role="tab" aria-selected={activeTool === 'compress'} onClick={() => setActiveTool('compress')}><Gauge size={18} />บีบอัดไฟล์</button>
        </div>
        <div className="workspace">
          {activeTool === 'download' ? <DownloadTool /> : <CompressorTool />}
          <aside className="context-panel" aria-label="ข้อมูลเครื่องมือ">
            <div className="context-icon">{activeTool === 'download' ? <ArrowDownToLine size={26} /> : <Gauge size={26} />}</div>
            <h2>{activeTool === 'download' ? 'เลือกเฉพาะที่ต้องใช้' : 'เล็กลงโดยยังดูดี'}</h2>
            <p>{activeTool === 'download' ? 'MP3 เหมาะกับเพลงและพอดแคสต์ ส่วน MP4 เก็บทั้งภาพและเสียงไว้ครบ' : 'ระบบใช้ WebP สำหรับภาพ และ H.264 แบบปรับ CRF สำหรับวิดีโอ เพื่อสมดุลขนาดกับรายละเอียด'}</p>
            <div className="context-rule" />
            <p className="context-tip"><span>เคล็ดลับ</span>{activeTool === 'download' ? 'วิดีโอยาวจะใช้เวลาเตรียมไฟล์มากขึ้น ปล่อยหน้านี้เปิดไว้จนดาวน์โหลดเริ่ม' : 'ค่า 65–80% เหมาะกับการแชร์ทั่วไป และมักลดขนาดได้มากโดยยังดูคมชัด'}</p>
          </aside>
        </div>
      </main>
    </div>
  );
}
