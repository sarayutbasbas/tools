import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUp, ArrowDown, Check, ChevronLeft, ChevronRight, FileText, Grid2X2, LoaderCircle, Plus, RotateCw, Search, Trash2, UploadCloud, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_MAX_BYTES, PDF_MAX_PAGES, parsePageRange, pdfBaseName, type PagePlan, type PdfToolId } from './pdf-model';
import { runPdfJob } from './pdf-worker-client';
import { readApiJson } from './api-response';
import { pdfTools as tools, pdfCategories } from './pdf-tools';
import PdfExtraOptions, { type PdfOptions } from './PdfExtraOptions';
import './pdf.css';

const rangeTools: PdfToolId[] = ['split', 'pdf-images', 'extract-text', 'watermark', 'sign', 'page-numbers'];
type Input = { id: number; file: File };
type Result = { blob: Blob; name: string; original?: boolean };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const save = (result: Result) => {
  const url = URL.createObjectURL(result.blob), link = document.createElement('a');
  link.href = url; link.download = result.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export default function PdfTool() {
  const [selected, setSelected] = useState<PdfToolId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [files, setFiles] = useState<Input[]>([]);
  const [pages, setPages] = useState<PagePlan[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [batch, setBatch] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [range, setRange] = useState('');
  const [separate, setSeparate] = useState(false);
  const [quality, setQuality] = useState('balanced');
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<typeof pdfCategories[number]>('ทั้งหมด');
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [options, setOptions] = useState<PdfOptions>({ text: 'สำเนา', opacity: .2, color: '#37624f', fontSize: 48, angle: 45, position: 'bottom-right', start: 1, numberStyle: 'number', orientation: 'portrait', perSheet: 4, margin: 24, signatureWidth: 180 });
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null), serial = useRef(0);
  const tool = tools.find(item => item.id === selected);
  const group = selected === 'merge' || selected === 'images-pdf';
  const first = files[0]?.file;
  const query = search.trim().toLowerCase();
  const filteredTools = tools.filter(item => (category === 'ทั้งหมด' || item.category === category) && `${item.name} ${item.description} ${item.id}`.toLowerCase().includes(query));

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (sheetOpen && !dialog.current?.open) dialog.current?.showModal();
    else if (!sheetOpen && dialog.current?.open) dialog.current.close();
  }, [sheetOpen]);

  useEffect(() => {
    setResult(null); setError(''); setMessage(''); setRange(''); setPages([]); setPageCount(0); setBatch(0); setThumbnails({}); setDocument(null);
    if (!first || group) { setReading(false); return; }
    let disposed = false, doc: PDFDocumentProxy | undefined;
    let task: Awaited<ReturnType<typeof import('./pdf-renderer')['openPdf']>> | undefined;
    setReading(true);
    void (async () => {
      try {
        const renderer = await import('./pdf-renderer');
        if (disposed) return;
        task = await renderer.openPdf(first);
        if (disposed) { await task.destroy(); return; }
        doc = await task.promise;
        if (disposed) { await task.destroy(); return; }
        if (doc.numPages > PDF_MAX_PAGES) throw new Error('รองรับ PDF สูงสุด 300 หน้า กรุณาแบ่งไฟล์ก่อน');
        setDocument(doc); setPageCount(doc.numPages);
        setPages(Array.from({ length: doc.numPages }, (_, index) => ({ index, rotation: 0 })));
        if (selected === 'sign') setRange(String(doc.numPages));
      } catch (e) {
        if (!disposed) setError(e instanceof Error && /password/i.test(e.message) ? 'PDF มีรหัสผ่าน กรุณาปลดล็อกด้วยรหัสของคุณก่อน' : e instanceof Error && /รองรับ PDF/.test(e.message) ? e.message : 'อ่าน PDF ไม่สำเร็จ ไฟล์อาจเสียหาย กรุณาเลือกไฟล์ที่เปิดอ่านได้');
      } finally { if (!disposed) setReading(false); }
    })();
    return () => { disposed = true; if (task) void task.destroy(); };
  }, [first, group, selected]);

  const visiblePages = pages.slice(batch * 8, batch * 8 + 8);
  const visibleIndices = visiblePages.map(page => page.index).join(',');
  useEffect(() => {
    if (!document || selected !== 'organize') return;
    let disposed = false;
    void (async () => {
      const renderer = await import('./pdf-renderer');
      for (const page of visiblePages) {
        if (disposed) break;
        try {
          const url = await renderer.thumbnail(document, page.index);
          if (!disposed) setThumbnails(previous => ({ ...previous, [page.index]: url }));
        } catch { /* A page still has its number and controls if its preview cannot render. */ }
      }
    })();
    return () => { disposed = true; };
    // Render only the current batch; rotations happen in CSS, not by re-decoding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, selected, visibleIndices]);

  function choose(id: PdfToolId) {
    if (id !== selected) {
      operation.current?.abort(); setFiles([]); setResult(null); setError(''); setMessage(''); setSignature(null); setSelected(id);
      setOptions(previous => ({ ...previous, fontSize: id === 'page-numbers' ? 12 : id === 'watermark' ? 48 : previous.fontSize, position: id === 'page-numbers' ? 'bottom-center' : 'bottom-right' }));
    }
    setSheetOpen(false);
  }
  function openSheet() { setSearch(''); setCategory('ทั้งหมด'); setSheetOpen(true); }
  function changeOptions(patch: PdfOptions) { setOptions(previous => ({ ...previous, ...patch })); setResult(null); setError(''); }
  function pick(candidates: File[]) {
    if (!selected || busy) return;
    const allowed = selected === 'images-pdf' ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf'];
    if (!candidates.length) return;
    if (candidates.some(file => !(allowed.includes(file.type) || (selected !== 'images-pdf' && /\.pdf$/i.test(file.name))))) { setError('กรุณาเลือกไฟล์ชนิดที่เครื่องมือนี้รองรับ'); return; }
    if (candidates.some(file => file.size > PDF_MAX_BYTES)) { setError('รองรับไฟล์ละไม่เกิน 50 MB'); return; }
    const next = group ? [...files, ...candidates.map(file => ({ id: ++serial.current, file }))] : [{ id: ++serial.current, file: candidates[0] }];
    if (next.length > 20 || next.reduce((total, item) => total + item.file.size, 0) > 100 * 1024 * 1024) { setError('เลือกได้สูงสุด 20 ไฟล์ รวมไม่เกิน 100 MB'); return; }
    setResult(null); setError(''); setMessage(''); setFiles(next);
  }
  function moveFile(index: number, direction: number) {
    setFiles(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); setResult(null);
  }
  function editPages(change: (previous: PagePlan[]) => PagePlan[]) { setPages(change); setResult(null); setMessage(''); }

  async function process() {
    if (!selected || !first) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(''); setResult(null); setPercent(0); setMessage('กำลังเตรียมไฟล์…');
    try {
      let next: Result;
      if (selected === 'compress') {
        setMessage('กำลังส่งไปบีบอัดใน Docker…');
        const form = new FormData(); form.append('file', first); form.append('filename', first.name); form.append('quality', quality);
        const response = await fetch('/api/pdf/compress', { method: 'POST', body: form, signal: controller.signal });
        if (!response.ok) await readApiJson(response);
        if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('เซิร์ฟเวอร์ไม่ได้ส่ง PDF กลับมา');
        const blob = await response.blob();
        const original = response.headers.get('X-Compression-Result') === 'original' || blob.size >= first.size;
        next = { blob: original ? first : blob, name: original ? first.name : `${pdfBaseName(first.name)}-compressed.pdf`, original };
      } else if (selected === 'pdf-images' || selected === 'extract-text') {
        if (!document) throw new Error('กรุณารออ่าน PDF ให้เสร็จ');
        const indices = parsePageRange(range, pageCount);
        if (selected === 'pdf-images' && indices.length > 50) throw new Error('แปลงเป็นรูปได้ครั้งละ 50 หน้า กรุณาระบุช่วงหน้า เช่น 1-50');
        setMessage(selected === 'pdf-images' ? 'กำลังแปลงแต่ละหน้าเป็นรูปภาพ…' : 'กำลังดึงข้อความจากเอกสาร…');
        const renderer = await import('./pdf-renderer');
        const output = selected === 'pdf-images' ? await renderer.pdfToImages(document, first.name, indices, dpi, controller.signal, setPercent) : await renderer.extractPdfText(document, first.name, indices, controller.signal, setPercent);
        next = { blob: new Blob([new Uint8Array(output.bytes)], { type: output.mime }), name: output.name };
      } else {
        setMessage('กำลังประมวลผลบนเครื่องคุณ…');
        const inputs = [];
        let preparedBytes = 0;
        for (const item of files) {
          controller.signal.throwIfAborted();
          const prepared = selected === 'images-pdf' ? await (await import('./pdf-renderer')).prepareImage(item.file) : { name: item.file.name, bytes: new Uint8Array(await item.file.arrayBuffer()) };
          preparedBytes += prepared.bytes.length;
          if (preparedBytes > 100 * 1024 * 1024) throw new Error('ข้อมูลหลังเตรียมเกิน 100 MB กรุณาเลือกไฟล์ครั้งละน้อยลง');
          inputs.push(prepared);
        }
        const plan = rangeTools.includes(selected) ? parsePageRange(range, pageCount).map(index => ({ index, rotation: 0 })) : pages;
        let fontBytes: Uint8Array | undefined;
        if (selected === 'watermark') {
          const response = await fetch('/pdf-fonts/NotoSansThai.ttf', { signal: controller.signal });
          if (!response.ok || !/^(font\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) throw new Error('โหลดฟอนต์ภาษาไทยไม่สำเร็จ กรุณาลองใหม่');
          fontBytes = new Uint8Array(await response.arrayBuffer());
        }
        const output = await runPdfJob({ op: selected, inputs, pages: plan, separate, options, fontBytes, signatureBytes: signature ? new Uint8Array(signature) : undefined }, controller.signal, setPercent);
        next = { blob: new Blob([new Uint8Array(output.bytes)], { type: output.mime }), name: output.name };
      }
      controller.signal.throwIfAborted();
      setResult(next); setPercent(100); setMessage(next.original ? 'ลดขนาดไม่ได้ จึงคงไฟล์ต้นฉบับไว้' : 'ไฟล์พร้อมดาวน์โหลด');
    } catch (e) {
      if (controller.signal.aborted) setMessage('ยกเลิกแล้ว');
      else setError(e instanceof Error ? e.message : 'ประมวลผลไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  return <section className="tool-panel pdf-panel" aria-labelledby="pdf-title">
    <div className="pdf-heading"><h1 id="pdf-title">{tool?.name || 'PDF Tools'}</h1><button className="pdf-switch" onClick={openSheet} disabled={busy}><Grid2X2 size={18} />เครื่องมือ</button></div>
    <input ref={input} type="file" hidden multiple={group} accept={selected === 'images-pdf' ? 'image/jpeg,image/png,image/webp' : 'application/pdf,.pdf'} onChange={event => { pick(Array.from(event.target.files || [])); event.target.value = ''; }} />
    {!selected ? <div className="pdf-welcome"><FileText size={48} strokeWidth={1.2} /><h2>จัดการเอกสารได้ในที่เดียว</h2><button className="primary-button" onClick={openSheet}>เลือกเครื่องมือ PDF</button></div> : <>
      <div className="pdf-content">
        {!files.length ? <div className={`drop-zone pdf-upload ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }}
          onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); pick(Array.from(event.dataTransfer.files)); }}>
          <UploadCloud size={30} /><strong>{selected === 'images-pdf' ? 'เลือกรูปภาพ' : group ? 'เลือกไฟล์ PDF ที่ต้องการรวม' : 'เลือกไฟล์ PDF'}</strong><span>แตะเลือก หรือลากไฟล์มาวาง · ไฟล์ละไม่เกิน 50 MB</span></div> : <>
          <div className="pdf-files" aria-label="ไฟล์ที่เลือก">{files.map((item, index) => <div className="pdf-file" key={item.id}>
            <FileText size={20} /><div><strong title={item.file.name}>{item.file.name}</strong><small>{size(item.file.size)}{!group && pageCount > 0 ? ` · ${pageCount} หน้า` : ''}</small></div>
            {group && <><button aria-label={`เลื่อน ${item.file.name} ขึ้น`} disabled={busy || index === 0} onClick={() => moveFile(index, -1)}><ArrowUp size={16} /></button><button aria-label={`เลื่อน ${item.file.name} ลง`} disabled={busy || index === files.length - 1} onClick={() => moveFile(index, 1)}><ArrowDown size={16} /></button></>}
            <button aria-label={`นำ ${item.file.name} ออก`} disabled={busy} onClick={() => { setFiles(previous => previous.filter(f => f.id !== item.id)); setResult(null); }}><X size={18} /></button>
          </div>)}</div>
          {group && <button className="pdf-add" disabled={busy} onClick={() => input.current?.click()}><Plus size={17} />เพิ่มไฟล์</button>}
        </>}
        {reading && <p className="quality-hint" role="status"><LoaderCircle size={16} className="spin" />กำลังอ่านเอกสาร…</p>}
        {rangeTools.includes(selected) && first && <div className="pdf-options">
          <label htmlFor="pdf-pages">{selected === 'sign' ? 'หน้าที่ต้องการเซ็น' : 'เลือกหน้า'} {pageCount > 0 ? `(1–${pageCount})` : ''}</label><input id="pdf-pages" type="text" value={range} placeholder="ทุกหน้า หรือ 1-3,5" disabled={busy || reading} onChange={event => { setRange(event.target.value); setResult(null); }} />
          {selected === 'split' && <label className="pdf-check"><input type="checkbox" checked={separate} disabled={busy} onChange={event => { setSeparate(event.target.checked); setResult(null); }} />แยกหน้าเป็น PDF แต่ละไฟล์ (ZIP)</label>}
          {selected === 'pdf-images' && <><label htmlFor="pdf-dpi">ความคมชัดรูปภาพ</label><select id="pdf-dpi" value={dpi} disabled={busy} onChange={event => { setDpi(Number(event.target.value)); setResult(null); }}><option value={100}>มาตรฐาน · 100 dpi</option><option value={150}>คมชัด · 150 dpi</option><option value={200}>คมชัดสูง · 200 dpi</option></select></>}
        </div>}
        {first && <PdfExtraOptions selected={selected} options={options} change={changeOptions} disabled={busy || reading} onSignature={bytes => { setSignature(bytes); setResult(null); setError(''); }} />}
        {selected === 'compress' && first && <div className="pdf-options"><label htmlFor="pdf-quality">ระดับการบีบอัด</label><select id="pdf-quality" value={quality} disabled={busy} onChange={event => { setQuality(event.target.value); setResult(null); }}><option value="small">ไฟล์เล็ก · เหมาะกับดูบนจอ</option><option value="balanced">สมดุล · เหมาะกับแชร์เอกสาร</option><option value="high">คมชัด · เหมาะกับพิมพ์</option></select><p className="quality-hint">ไฟล์จะส่งไปประมวลผลใน Docker และลบเมื่อส่งกลับเสร็จ เหมาะกับเอกสารทั่วไป ฟอร์มโต้ตอบอาจเปลี่ยนไป</p></div>}
        {selected === 'organize' && pageCount > 0 && <><div className="pdf-page-toolbar"><span>{pages.length} / {pageCount} หน้า</span><button className="pdf-switch" disabled={busy} onClick={() => { editPages(() => Array.from({ length: pageCount }, (_, index) => ({ index, rotation: 0 }))); setBatch(0); }}>คืนค่า</button></div>
          <div className="pdf-page-grid">{visiblePages.map((page, offset) => {
            const position = batch * 8 + offset;
            return <div className="pdf-page" key={page.index}><div className="pdf-page-preview">{thumbnails[page.index] ? <img src={thumbnails[page.index]} alt={`หน้า ${page.index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} /> : <FileText size={32} />}<span>หน้า {page.index + 1}</span></div><div className="pdf-page-actions">
              <button aria-label={`เลื่อนหน้า ${page.index + 1} ไปก่อนหน้า`} disabled={busy || position === 0} onClick={() => editPages(previous => { const next = [...previous]; [next[position - 1], next[position]] = [next[position], next[position - 1]]; return next; })}><ChevronLeft size={16} /></button>
              <button aria-label={`หมุนหน้า ${page.index + 1}`} disabled={busy} onClick={() => editPages(previous => previous.map(p => p.index === page.index ? { ...p, rotation: (p.rotation + 90) % 360 } : p))}><RotateCw size={16} /></button>
              <button aria-label={`ลบหน้า ${page.index + 1}`} disabled={busy || pages.length === 1} onClick={() => { editPages(previous => previous.filter(p => p.index !== page.index)); setBatch(Math.min(batch, Math.floor((pages.length - 2) / 8))); }}><Trash2 size={16} /></button>
              <button aria-label={`เลื่อนหน้า ${page.index + 1} ไปถัดไป`} disabled={busy || position === pages.length - 1} onClick={() => editPages(previous => { const next = [...previous]; [next[position + 1], next[position]] = [next[position], next[position + 1]]; return next; })}><ChevronRight size={16} /></button>
            </div></div>;
          })}</div>
          {pages.length > 8 && <div className="pdf-pagination"><button disabled={batch === 0 || busy} onClick={() => setBatch(batch - 1)}><ChevronLeft size={18} />ก่อนหน้า</button><span>{batch + 1} / {Math.ceil(pages.length / 8)}</span><button disabled={(batch + 1) * 8 >= pages.length || busy} onClick={() => setBatch(batch + 1)}>ถัดไป<ChevronRight size={18} /></button></div>}
        </>}
        {result && selected === 'compress' && first && <div className="comparison pdf-comparison"><div><span>ก่อน</span><strong>{size(first.size)}</strong></div><ChevronRight size={18} /><div className="after"><span>หลัง</span><strong>{size(result.blob.size)}</strong></div></div>}
      </div>
      <div className="tool-footer pdf-footer">
        {busy && <div className="pdf-processing" role="status"><span><LoaderCircle size={16} className="spin" />{message}</span>{selected !== 'compress' && <progress value={percent} max={100} aria-label="ความคืบหน้า PDF" />}<button className="pdf-switch" onClick={() => operation.current?.abort()}>ยกเลิก</button></div>}
        {error && <div className="status-line error" role="alert">{error}</div>}
        {result ? <><p className="pdf-result" role="status"><Check size={16} />{message} · {size(result.blob.size)}</p><button className="primary-button" onClick={() => save(result)}><ArrowDownToLine size={19} />ดาวน์โหลด {result.name.split('.').at(-1)?.toUpperCase()}</button></> : <button className="primary-button" disabled={!files.length || busy || reading || (selected === 'merge' && files.length < 2) || (selected === 'sign' && !signature) || (!group && !document)} onClick={process}>{busy ? <LoaderCircle className="spin" size={19} /> : <FileText size={19} />}{busy ? 'กำลังประมวลผล' : `เริ่ม${tool?.name || 'ประมวลผล'}`}</button>}
        {!first && <p className="pdf-local-note">{selected === 'compress' ? 'บีบอัดใน Docker ของคุณ' : 'ประมวลผลในเบราว์เซอร์ ไม่อัปโหลดไฟล์'}</p>}
      </div>
    </>}
    <dialog ref={dialog} className="pdf-sheet" aria-labelledby="pdf-sheet-title" onClose={() => setSheetOpen(false)} onClick={event => { if (event.target === dialog.current) setSheetOpen(false); }}>
      <div className="pdf-sheet-body"><div className="pdf-sheet-handle" aria-hidden="true" /><header><div><p>เอกสาร</p><h2 id="pdf-sheet-title">เครื่องมือ PDF</h2></div><button aria-label="ปิดเครื่องมือ PDF" className="pdf-sheet-close" onClick={() => setSheetOpen(false)}><X size={22} /></button></header>
        <label className="pdf-tool-search"><Search size={18} /><input type="search" aria-label="ค้นหาเครื่องมือ PDF" placeholder={`ค้นหา ${tools.length} เครื่องมือ…`} value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="pdf-category-tabs" role="group" aria-label="หมวดเครื่องมือ">{pdfCategories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="pdf-tool-grid">{filteredTools.map(item => <button key={item.id} disabled={busy} onClick={() => choose(item.id)}><item.icon size={26} strokeWidth={1.7} /><strong>{item.name}</strong><small>{item.description}</small></button>)}</div>
        {filteredTools.length === 0 && <p className="pdf-no-tools" role="status">ไม่พบเครื่องมือ ลองคำค้นอื่นหรือเลือกหมวดทั้งหมด</p>}
      </div>
    </dialog>
  </section>;
}
