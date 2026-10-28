import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eraser, ImagePlus } from 'lucide-react';

export default function SignaturePad({ disabled, onChange }: { disabled: boolean; onChange: (bytes: Uint8Array | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), picker = useRef<HTMLInputElement>(null), drawing = useRef(false), version = useRef(0);
  const [error, setError] = useState('');
  useEffect(() => () => { version.current++; }, []);
  function clear() { version.current++; canvas.current?.getContext('2d')?.clearRect(0, 0, 800, 400); setError(''); onChange(null); }
  async function publish() {
    const source = canvas.current; if (!source) return;
    const context = source.getContext('2d'); if (!context) return;
    const current = ++version.current;
    const image = context.getImageData(0, 0, source.width, source.height);
    let left = source.width, top = source.height, right = -1, bottom = -1;
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) if (image.data[(y * source.width + x) * 4 + 3] > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    if (right < 0) { onChange(null); return; }
    const cropped = document.createElement('canvas'); cropped.width = right - left + 13; cropped.height = bottom - top + 13;
    cropped.getContext('2d')?.drawImage(source, left, top, right - left + 1, bottom - top + 1, 6, 6, right - left + 1, bottom - top + 1);
    const blob = await new Promise<Blob | null>(resolve => cropped.toBlob(resolve, 'image/png'));
    if (blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); if (current === version.current) onChange(bytes); }
    cropped.width = 0; cropped.height = 0;
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * 800 / rect.width, y: (event.clientY - rect.top) * 400 / rect.height };
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || event.button !== 0) return; event.preventDefault(); setError(''); version.current++; onChange(null); drawing.current = true;
    const context = event.currentTarget.getContext('2d'); if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId); const p = point(event);
    context.lineWidth = 3.5; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#202522'; context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(p.x + .1, p.y + .1); context.stroke();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return; event.preventDefault(); const p = point(event), context = event.currentTarget.getContext('2d'); context?.lineTo(p.x, p.y); context?.stroke();
  }
  function end() { if (drawing.current) { drawing.current = false; void publish(); } }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('เลือกรูปลายเซ็นไม่เกิน 5 MB'); return; }
    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!canvas.current) { image.close(); return; }
      clear(); const context = canvas.current?.getContext('2d');
      const scale = Math.min(780 / image.width, 380 / image.height);
      context?.drawImage(image, (800 - image.width * scale) / 2, (400 - image.height * scale) / 2, image.width * scale, image.height * scale);
      image.close(); await publish();
    } catch { setError('อ่านรูปลายเซ็นไม่สำเร็จ กรุณาเลือก PNG หรือ JPG'); }
  }
  return <div className="signature-pad" data-disabled={disabled}>
    <canvas ref={canvas} width={800} height={400} aria-label="พื้นที่วาดลายเซ็นด้วยนิ้ว ปากกา หรือเมาส์" aria-describedby="signature-hint" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />
    <div className="signature-actions"><button type="button" className="pdf-switch" disabled={disabled} onClick={clear}><Eraser size={16} />ล้างลายเซ็น</button><button type="button" className="pdf-switch" disabled={disabled} onClick={() => picker.current?.click()}><ImagePlus size={16} />เลือกรูปลายเซ็น</button></div>
    <input ref={picker} type="file" hidden accept="image/png,image/jpeg" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
    <p id="signature-hint" className="quality-hint">วาดหรือเลือกรูปลายเซ็นเพื่อวางบน PDF เป็นลายเซ็นแบบภาพ ไม่ใช่ลายเซ็นดิจิทัลแบบใบรับรอง</p>
    {error && <p className="quality-error" role="alert">{error}</p>}
  </div>;
}
