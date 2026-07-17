import * as XLSX from 'xlsx';
import type { RawFileTable, SourceFileType } from '@/types/bankReconcile';

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

/** ระบุประเภทไฟล์จากนามสกุล — ใช้เก็บเป็น source_file_type และแสดง "ประเภทไฟล์: ..." ข้างชื่อไฟล์ตามสเปก
 * ส่วน "FILE TYPE DETECTION" คืน null ถ้านามสกุลไม่รองรับเลย (ผู้เรียกต้องเช็ค validateFileType ก่อนอยู่แล้ว) */
export function detectSourceFileType(fileName: string): SourceFileType | null {
  const ext = getFileExtension(fileName);
  if (ext === '.xlsx' || ext === '.xls') return 'excel';
  if (ext === '.csv') return 'csv';
  if (ext === '.pdf') return 'pdf';
  return null;
}

/**
 * อ่านไฟล์ Excel/CSV เป็นตารางดิบแบบ array-of-arrays (แถวแรก = หัวคอลัมน์ดิบตามไฟล์จริง แถวที่เหลือ = ข้อมูล)
 * — ไม่เปลี่ยนแปลงจากเดิมแม้แต่บรรทัดเดียว (workflow Excel/CSV ต้องคงเดิมทุกประการตามสเปก "Keep the current
 * Excel and CSV workflow unchanged") ไฟล์ PDF ใช้ lib/bankReconcilePdfParse.ts แยกต่างหากแทน (ดูฟังก์ชัน
 * extractPdfToRawTable ในไฟล์นั้น) แล้วแปลงเป็น RawFileTable รูปแบบเดียวกันนี้ก่อนส่งเข้าขั้นตอนจับคู่คอลัมน์
 * ต่อ เพื่อให้ใช้ UI จับคู่คอลัมน์/normalize ชุดเดียวกันได้ทั้งสามประเภทไฟล์
 *
 * ใช้ไลบรารี xlsx (SheetJS) อ่านทั้ง .xlsx/.xls (ผ่าน ArrayBuffer) และ .csv (ผ่าน string) — โยน Error ออกไปถ้า
 * ไฟล์เสียหาย/อ่านไม่ได้เลย ผู้เรียกต้อง try/catch แล้วแปลงเป็นข้อความแจ้งเตือนภาษาไทยเอง
 */
export async function parseFileToRawTable(file: File): Promise<RawFileTable> {
  const ext = getFileExtension(file.name);
  const workbook =
    ext === '.csv'
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const worksheet = workbook.Sheets[sheetName];

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: true });
  const [headerRow, ...dataRows] = aoa;
  const headers = (headerRow ?? []).map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  return { headers, rows: dataRows };
}
