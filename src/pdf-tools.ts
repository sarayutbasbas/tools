import { ArrowDownUp, FileImage, FileStack, FileText, Gauge, Grid2X2, ImagePlus, ScanText, Scissors, Stamp, PenLine, ListOrdered, Scaling, LayoutGrid, FileX2 } from 'lucide-react';
import type { PdfToolId } from './pdf-model';
export const pdfCategories = ['ทั้งหมด', 'จัดการหน้า', 'แปลงไฟล์', 'แก้ไขและเซ็น', 'ปรับไฟล์'] as const;
export const pdfTools = [
  { id: 'merge', name: 'รวม PDF', description: 'หลายไฟล์เป็นเอกสารเดียว', icon: FileStack, category: 'จัดการหน้า' },
  { id: 'split', name: 'แยก PDF', description: 'เลือกหน้า หรือแยกเป็นไฟล์', icon: Scissors, category: 'จัดการหน้า' },
  { id: 'organize', name: 'จัดหน้า PDF', description: 'สลับลำดับ หมุน และลบหน้า', icon: Grid2X2, category: 'จัดการหน้า' },
  { id: 'reverse', name: 'กลับลำดับหน้า', description: 'หน้าสุดท้ายขึ้นมาก่อน', icon: ArrowDownUp, category: 'จัดการหน้า' },
  { id: 'resize-a4', name: 'ปรับเป็น A4', description: 'ขนาดสม่ำเสมอ พร้อมพิมพ์', icon: Scaling, category: 'จัดการหน้า' },
  { id: 'n-up', name: 'หลายหน้าต่อแผ่น', description: 'รวม 2, 4 หรือ 9 หน้าใน A4', icon: LayoutGrid, category: 'จัดการหน้า' },
  { id: 'images-pdf', name: 'รูปภาพเป็น PDF', description: 'JPG, PNG, WebP เป็นเอกสาร', icon: ImagePlus, category: 'แปลงไฟล์' },
  { id: 'pdf-images', name: 'PDF เป็นรูปภาพ', description: 'แต่ละหน้าเป็น JPG ใน ZIP', icon: FileImage, category: 'แปลงไฟล์' },
  { id: 'extract-text', name: 'ดึงข้อความ', description: 'ข้อความใน PDF เป็น TXT', icon: ScanText, category: 'แปลงไฟล์' },
  { id: 'watermark', name: 'เพิ่มลายน้ำ', description: 'ข้อความไทย สี และความเข้ม', icon: Stamp, category: 'แก้ไขและเซ็น' },
  { id: 'sign', name: 'เซ็น PDF', description: 'วาดหรือเลือกรูปลายเซ็น', icon: PenLine, category: 'แก้ไขและเซ็น' },
  { id: 'page-numbers', name: 'ใส่เลขหน้า', description: 'เลือกตำแหน่งและเลขเริ่มต้น', icon: ListOrdered, category: 'แก้ไขและเซ็น' },
  { id: 'compress', name: 'บีบอัด PDF', description: 'ลดขนาดสำหรับส่งและแชร์', icon: Gauge, category: 'ปรับไฟล์' },
  { id: 'clean-metadata', name: 'ลบข้อมูลเอกสาร', description: 'ลบผู้เขียน ชื่อเรื่อง และ XMP', icon: FileX2, category: 'ปรับไฟล์' },
] satisfies { id: PdfToolId; name: string; description: string; icon: typeof FileText; category: typeof pdfCategories[number] }[];
