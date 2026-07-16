import * as XLSX from 'xlsx';
import type { RawFileTable } from '@/types/bankReconcile';

/** นามสกุลไฟล์ที่รองรับ — ตามสเปก "รองรับ Excel และ CSV" ทั้งสองการ์ด (.xls เก่ารองรับไว้ด้วยเพราะ
 * lib/excelImport.ts ของระบบเดิมก็ยอมรับ .xls อยู่แล้ว ไม่ใช่ของใหม่ที่เพิ่มขอบเขตความเสี่ยง) */
export const ACCEPTED_BANK_RECONCILE_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

export function isAcceptedBankReconcileFileType(fileName: string): boolean {
  return (ACCEPTED_BANK_RECONCILE_EXTENSIONS as readonly string[]).includes(getFileExtension(fileName));
}

/**
 * อ่านไฟล์ต้นฉบับ (Bank Statement หรือ GL จากระบบ Express) เป็นตารางดิบแบบ array-of-arrays
 * (แถวแรก = หัวคอลัมน์ดิบตามไฟล์จริง แถวที่เหลือ = ข้อมูล) — ต่างจาก readWorkbookRows ใน
 * lib/excelImport.ts ที่อ่านเป็น object ตาม header คงที่ของเทมเพลตระบบเอง เพราะไฟล์ธนาคาร/ระบบ Express
 * มีหัวคอลัมน์ไม่ตายตัว (ต่างกันไปตามธนาคาร/ระบบต้นทางของผู้ใช้แต่ละราย) ต้องให้ผู้ใช้จับคู่คอลัมน์เองใน
 * ขั้นตอนถัดไป (ดู components/BankReconcileColumnMapping.tsx)
 *
 * ใช้ไลบรารี xlsx (SheetJS) เดียวกันอ่านทั้ง .xlsx/.xls (ผ่าน ArrayBuffer) และ .csv (ผ่าน string) แทนการ
 * เขียน CSV parser แยกต่างหาก — เพื่อความสม่ำเสมอกับส่วนอื่นของโปรเจกต์ (lib/excelImport.ts,
 * lib/contactExcelImport.ts) ที่ยอมรับความเสี่ยง CVE ของ xlsx (prototype pollution/ReDoS) ไว้แล้วเป็น
 * มาตรฐานทั้งโปรเจกต์อยู่ก่อนแล้ว ไม่ใช่ช่องโหว่ใหม่ที่เพิ่มขอบเขตเฉพาะฟีเจอร์นี้
 *
 * โยน Error ออกไปถ้าไฟล์เสียหาย/อ่านไม่ได้เลย (เช่นไม่ใช่ไฟล์ Excel/CSV จริงแม้จะมีนามสกุลถูกต้อง) —
 * ผู้เรียก (BankReconcileUploadCard) ต้อง try/catch แล้วแปลงเป็นข้อความแจ้งเตือนภาษาไทยเอง
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

  // header:1 → คืนเป็น array-of-arrays ดิบๆ ตามที่อยู่ในไฟล์จริง (ไม่ตีความแถวแรกเป็น key ของ object)
  // raw:true → ไม่แปลงตัวเลข/วันที่เป็น string ก่อนเวลาอันควร ปล่อยให้ lib/bankReconcileNormalize.ts
  // เป็นผู้ตัดสินใจแปลงค่าอย่างปลอดภัยเองทั้งหมด (parseAmountCell/parseDateCell)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: true });
  const [headerRow, ...dataRows] = aoa;
  const headers = (headerRow ?? []).map((h) => (h === null || h === undefined ? '' : String(h).trim()));
  return { headers, rows: dataRows };
}
