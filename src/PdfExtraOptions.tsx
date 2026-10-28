import type { PdfJob } from './pdf-operations';
import type { PdfToolId, PdfPosition } from './pdf-model';
import SignaturePad from './SignaturePad';
export type PdfOptions = NonNullable<PdfJob['options']>;
const positions: { value: PdfPosition; label: string }[] = [
  { value: 'bottom-left', label: 'ล่างซ้าย' }, { value: 'bottom-center', label: 'ล่างกลาง' }, { value: 'bottom-right', label: 'ล่างขวา' },
  { value: 'top-left', label: 'บนซ้าย' }, { value: 'top-center', label: 'บนกลาง' }, { value: 'top-right', label: 'บนขวา' },
];
export default function PdfExtraOptions({ selected, options, change, disabled, onSignature }: {
  selected: PdfToolId; options: PdfOptions; change: (patch: PdfOptions) => void; disabled: boolean; onSignature: (bytes: Uint8Array | null) => void;
}) {
  if (!['watermark', 'sign', 'page-numbers', 'resize-a4', 'n-up', 'clean-metadata', 'reverse', 'extract-text'].includes(selected)) return null;
  return <div className="pdf-options pdf-extra-options">
    {selected === 'watermark' && <>
      <label htmlFor="pdf-watermark-text">ข้อความลายน้ำ</label><input id="pdf-watermark-text" maxLength={120} value={options.text || ''} disabled={disabled} onChange={e => change({ text: e.target.value })} placeholder="เช่น สำเนาถูกต้อง / เอกสารภายใน" />
      <div className="pdf-options-row"><div><label htmlFor="pdf-watermark-angle">แนวข้อความ</label><select id="pdf-watermark-angle" value={options.angle ?? 45} disabled={disabled} onChange={e => change({ angle: Number(e.target.value) })}><option value={45}>แนวทแยงขึ้น</option><option value={-45}>แนวทแยงลง</option><option value={0}>แนวนอน</option></select></div><div><label htmlFor="pdf-watermark-color">สี</label><input id="pdf-watermark-color" type="color" value={options.color || '#37624f'} disabled={disabled} onChange={e => change({ color: e.target.value })} /></div></div>
      <label htmlFor="pdf-watermark-opacity">ความเข้ม {Math.round((options.opacity ?? .2) * 100)}%</label><input id="pdf-watermark-opacity" type="range" min={5} max={80} value={Math.round((options.opacity ?? .2) * 100)} disabled={disabled} onChange={e => change({ opacity: Number(e.target.value) / 100 })} />
      <label htmlFor="pdf-watermark-size">ขนาดข้อความ</label><select id="pdf-watermark-size" value={options.fontSize ?? 48} disabled={disabled} onChange={e => change({ fontSize: Number(e.target.value) })}><option value={28}>เล็ก</option><option value={48}>กลาง</option><option value={72}>ใหญ่</option></select>
    </>}
    {selected === 'sign' && <><label>ลายเซ็น</label><SignaturePad disabled={disabled} onChange={onSignature} /><label htmlFor="pdf-sign-width">ความกว้างลายเซ็น</label><select id="pdf-sign-width" value={options.signatureWidth ?? 180} disabled={disabled} onChange={e => change({ signatureWidth: Number(e.target.value) })}><option value={100}>เล็ก</option><option value={180}>กลาง</option><option value={260}>ใหญ่</option></select></>}
    {selected === 'page-numbers' && <div className="pdf-options-row"><div><label htmlFor="pdf-number-start">เริ่มที่เลข</label><input id="pdf-number-start" type="number" min={1} max={999999} value={options.start ?? 1} disabled={disabled} onChange={e => change({ start: Number(e.target.value) })} /></div><div><label htmlFor="pdf-number-style">รูปแบบ</label><select id="pdf-number-style" value={options.numberStyle || 'number'} disabled={disabled} onChange={e => change({ numberStyle: e.target.value as 'number' | 'fraction' })}><option value="number">1, 2, 3</option><option value="fraction">1 / จำนวนหน้า</option></select></div></div>}
    {(selected === 'sign' || selected === 'page-numbers') && <><label htmlFor="pdf-stamp-position">ตำแหน่งบนหน้า</label><select id="pdf-stamp-position" value={options.position || 'bottom-right'} disabled={disabled} onChange={e => change({ position: e.target.value as PdfPosition })}>{positions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></>}
    {selected === 'n-up' && <><label htmlFor="pdf-per-sheet">จำนวนหน้าต่อแผ่น</label><select id="pdf-per-sheet" value={options.perSheet ?? 4} disabled={disabled} onChange={e => change({ perSheet: Number(e.target.value) as 2 | 4 | 9, orientation: Number(e.target.value) === 2 ? 'landscape' : 'portrait' })}><option value={2}>2 หน้า</option><option value={4}>4 หน้า</option><option value={9}>9 หน้า</option></select></>}
    {(selected === 'n-up' || selected === 'resize-a4') && <><label htmlFor="pdf-sheet-orientation">แนวกระดาษ A4</label><select id="pdf-sheet-orientation" value={options.orientation || 'portrait'} disabled={disabled} onChange={e => change({ orientation: e.target.value as 'portrait' | 'landscape' })}><option value="portrait">แนวตั้ง</option><option value="landscape">แนวนอน</option></select><label htmlFor="pdf-page-margin">ระยะขอบ</label><select id="pdf-page-margin" value={options.margin ?? 24} disabled={disabled} onChange={e => change({ margin: Number(e.target.value) })}><option value={0}>ไม่มีขอบ</option><option value={12}>แคบ</option><option value={24}>ปกติ</option><option value={40}>กว้าง</option></select><p className="quality-hint">คงสัดส่วนหน้าเดิม ไม่ตัดเนื้อหา ผลลัพธ์เหมาะกับอ่านและพิมพ์ ฟอร์มโต้ตอบไม่คงเดิม</p></>}
    {selected === 'clean-metadata' && <p className="quality-hint">ลบชื่อผู้เขียน ชื่อเรื่อง ซอฟต์แวร์ วันที่ และ XMP ในคุณสมบัติเอกสาร ไม่ลบข้อความหรือชื่อที่อยู่บนหน้า PDF</p>}
    {selected === 'reverse' && <p className="quality-hint">กลับลำดับจากหน้าสุดท้ายมาหน้าแรก โดยคงเนื้อหาและมุมหมุนเดิม</p>}
    {selected === 'extract-text' && <p className="quality-hint">ดึงข้อความที่เลือกได้เป็นไฟล์ TXT ภาษาไทย/UTF-8 ไม่ใช่ OCR สำหรับภาพสแกน</p>}
  </div>;
}
