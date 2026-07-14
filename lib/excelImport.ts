import * as XLSX from 'xlsx';
import { suggestVatAmount } from './invoiceLogic';
import type { InvoiceWriteInput } from './invoiceApi';

/** หัวคอลัมน์ในไฟล์ Excel (ทั้งไฟล์เทมเพลตที่สร้างให้ และไฟล์ที่ผู้ใช้อัปโหลดกลับมา) */
export const EXCEL_HEADERS = {
  vendor_name: 'ผู้ขาย',
  transaction_date: 'วันที่ทำรายการ',
  description: 'รายละเอียด',
  amount_excl_vat: 'ยอดก่อน VAT',
  vat_amount: 'VAT',
  reference_no: 'เลขที่อ้างอิง',
  expected_date: 'วันที่คาดว่าจะได้รับใบกำกับภาษี',
  notes: 'หมายเหตุ',
} as const;

export const EXCEL_HEADER_ORDER = Object.values(EXCEL_HEADERS);

export interface ExcelImportRow {
  rowNumber: number; // เลขแถวจริงในไฟล์ Excel (แถว 1 = header เสมอ)
  vendor_name: string;
  transaction_date: string; // ISO YYYY-MM-DD หรือ '' ถ้าไม่ถูกต้อง/ไม่ได้กรอก
  description: string;
  amount_excl_vat: string;
  vat_amount: string;
  reference_no: string;
  expected_date: string;
  notes: string;
  errors: string[]; // ว่าง = แถวนี้ผ่านการตรวจสอบ พร้อม import
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** แปลงเลข serial ของ Excel ให้เป็น Date — วันที่ 0 ของ Excel คือ 1899-12-30 */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * แปลงค่าจากเซลล์ Excel ให้เป็นวันที่แบบ ISO (YYYY-MM-DD)
 * รองรับ: Date object (เซลล์รูปแบบวันที่จริงของ Excel), เลข serial ของ Excel,
 * string แบบ YYYY-MM-DD, และ string แบบ DD/MM/YYYY (นิยมใช้ในไทย)
 */
export function parseExcelDateCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toISODate(value);
  }
  if (typeof value === 'number') {
    const d = excelSerialToDate(value);
    return d ? toISODate(d) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, y, mo, d] = isoMatch;
      return isRealDate(Number(y), Number(mo), Number(d)) ? trimmed : null;
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      const [, d, mo, y] = dmyMatch;
      if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

/** ตรวจสอบว่า ปี/เดือน/วัน ที่ให้มาเป็นวันที่จริงที่มีอยู่จริง (เช่น เดือน 13 หรือวันที่ 30 กุมภาพันธ์ ไม่ผ่าน) */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function cellToNumberString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(value);
  const parsed = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? String(parsed) : String(value).trim();
}

/**
 * แปลง 1 แถวดิบจาก Excel (object ที่ key ตรงกับหัวคอลัมน์ EXCEL_HEADERS) ให้เป็น ExcelImportRow
 * พร้อมตรวจสอบความถูกต้อง — ถ้า VAT ไม่ได้กรอกจะเสนอ 7% อัตโนมัติจากยอดก่อน VAT
 * แถวที่ว่างทั้งแถว (เช่นแถวว่างท้ายไฟล์) จะคืนค่า null เพื่อข้ามไปได้
 */
export function parseExcelRow(raw: Record<string, unknown>, rowNumber: number): ExcelImportRow | null {
  const vendor_name = cellToString(raw[EXCEL_HEADERS.vendor_name]);
  const transactionDateRaw = raw[EXCEL_HEADERS.transaction_date];
  const description = cellToString(raw[EXCEL_HEADERS.description]);
  const amountRaw = raw[EXCEL_HEADERS.amount_excl_vat];
  const vatRaw = raw[EXCEL_HEADERS.vat_amount];
  const reference_no = cellToString(raw[EXCEL_HEADERS.reference_no]);
  const expectedDateRaw = raw[EXCEL_HEADERS.expected_date];
  const notes = cellToString(raw[EXCEL_HEADERS.notes]);

  const isRowEmpty =
    !vendor_name &&
    !transactionDateRaw &&
    !description &&
    (amountRaw === undefined || amountRaw === null || amountRaw === '') &&
    (vatRaw === undefined || vatRaw === null || vatRaw === '') &&
    !reference_no &&
    !expectedDateRaw &&
    !notes;
  if (isRowEmpty) return null;

  const errors: string[] = [];

  if (!vendor_name) errors.push('ไม่ได้กรอกผู้ขาย');

  const transaction_date = parseExcelDateCell(transactionDateRaw) ?? '';
  if (!transaction_date) errors.push('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');

  const amount_excl_vat = cellToNumberString(amountRaw);
  const amountNum = parseFloat(amount_excl_vat);
  const amountValid = amount_excl_vat !== '' && Number.isFinite(amountNum) && amountNum > 0;
  if (!amountValid) errors.push('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');

  let vat_amount = cellToNumberString(vatRaw);
  if (vat_amount === '') {
    vat_amount = amountValid ? String(suggestVatAmount(amountNum)) : '';
  } else {
    const vatNum = parseFloat(vat_amount);
    if (Number.isNaN(vatNum) || vatNum < 0) errors.push('VAT ไม่ถูกต้อง');
  }

  const expected_date = parseExcelDateCell(expectedDateRaw) ?? '';
  const expectedDateProvided =
    expectedDateRaw !== undefined && expectedDateRaw !== null && String(expectedDateRaw).trim() !== '';
  if (expectedDateProvided && !expected_date) {
    errors.push('วันที่คาดว่าจะได้รับไม่ถูกต้อง');
  }
  if (expected_date && transaction_date && expected_date < transaction_date) {
    errors.push('วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่ทำรายการ');
  }

  return {
    rowNumber,
    vendor_name,
    transaction_date,
    description,
    amount_excl_vat,
    vat_amount,
    reference_no,
    expected_date,
    notes,
    errors,
  };
}

/** แปลงแถวดิบทั้งหมดจาก Excel (ตามลำดับในไฟล์) ให้เป็น ExcelImportRow[] โดยข้ามแถวว่างไปอัตโนมัติ */
export function parseExcelRows(rawRows: Record<string, unknown>[]): ExcelImportRow[] {
  const rows: ExcelImportRow[] = [];
  rawRows.forEach((raw, idx) => {
    // แถวที่ 1 ในไฟล์คือ header เสมอ ดังนั้นแถวข้อมูลแถวแรก (idx 0) = แถวที่ 2 จริง
    const parsed = parseExcelRow(raw, idx + 2);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

/** แปลง ExcelImportRow ที่ผ่านการตรวจสอบแล้ว (errors ว่าง) ให้เป็น payload สำหรับบันทึกลง Supabase */
export function excelRowToWriteInput(row: ExcelImportRow): InvoiceWriteInput {
  return {
    vendor_name: row.vendor_name.trim(),
    transaction_date: row.transaction_date,
    description: row.description.trim() || null,
    amount_excl_vat: parseFloat(row.amount_excl_vat) || 0,
    vat_amount: parseFloat(row.vat_amount) || 0,
    reference_no: row.reference_no.trim() || null,
    expected_date: row.expected_date || null,
    notes: row.notes.trim() || null,
  };
}

/** อ่านไฟล์ Excel (ArrayBuffer) แล้วแปลงชีทแรกให้เป็น array ของแถวดิบ (key ตรงกับหัวคอลัมน์) */
export function readWorkbookRows(data: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
}

/** สร้างไฟล์ Excel เทมเพลตพร้อมตัวอย่าง 1 แถว คืนค่าเป็น Blob พร้อมดาวน์โหลด */
export function buildTemplateBlob(): Blob {
  const exampleRow: Record<string, unknown> = {
    [EXCEL_HEADERS.vendor_name]: 'บริษัท ตัวอย่าง จำกัด',
    [EXCEL_HEADERS.transaction_date]: new Date(),
    [EXCEL_HEADERS.description]: 'ค่าสินค้า/บริการ (ตัวอย่าง — ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
    [EXCEL_HEADERS.amount_excl_vat]: 1000,
    [EXCEL_HEADERS.vat_amount]: '',
    [EXCEL_HEADERS.reference_no]: 'PO-0001',
    [EXCEL_HEADERS.expected_date]: '',
    [EXCEL_HEADERS.notes]: '',
  };
  const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: EXCEL_HEADER_ORDER });
  worksheet['!cols'] = EXCEL_HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายการ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
