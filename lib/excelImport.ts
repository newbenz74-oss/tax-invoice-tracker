import * as XLSX from 'xlsx';
import { deriveStatusForTaxType } from './invoiceLogic';
import type { InvoiceWriteInput } from './invoiceApi';
import type { PendingTaxInvoice, TaxType } from '@/types/invoice';

/** หัวคอลัมน์ในไฟล์ Excel (ทั้งไฟล์เทมเพลตที่สร้างให้ และไฟล์ที่ผู้ใช้อัปโหลดกลับมา)
 * total_amount เป็นคอลัมน์อ้างอิงเฉยๆ (ตรงกับ total_amount ที่ฐานข้อมูลคำนวณอัตโนมัติอยู่แล้วเสมอ
 * จากยอดก่อน VAT + VAT) parseExcelRow() ไม่เขียนทับค่านี้ลงฐานข้อมูลเลย แต่จะ "เตือน" (ไม่ error) ถ้าค่า
 * ที่กรอกมาในไฟล์ไม่ตรงกับผลรวมที่คำนวณได้ ดูฟังก์ชัน parseExcelRow ด้านล่าง
 *
 * ⚠️ ตั้งแต่ 2026-07-15 ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปแล้ว (เคยมีช่วงสั้นๆ ก่อนหน้านี้)
 * — ระบบจำแนกว่ารายการมี VAT หรือไม่มี VAT จากยอดในคอลัมน์ "VAT" โดยตรงเสมอ (VAT > 0 → มี VAT,
 * VAT ว่าง/0/"-" → ไม่มี VAT) ดู parseVatCell/parseExcelRow ด้านล่างสำหรับ logic เต็ม ถ้าผู้ใช้ยังมี
 * ไฟล์เทมเพลตเก่าที่มีคอลัมน์ "ประเภทภาษี" อยู่ อัปโหลดได้ตามปกติ ระบบจะไม่อ่าน/ไม่สนใจคอลัมน์นั้นเลย
 * (ไม่ error ไม่มีผลใดๆ ต่อการนำเข้า) */
export const EXCEL_HEADERS = {
  vendor_name: 'ผู้ขาย',
  transaction_date: 'วันที่ทำรายการ',
  vendor_tax_id: 'เลขประจำตัวผู้เสียภาษี',
  description: 'รายละเอียด',
  amount_excl_vat: 'ยอดก่อน VAT',
  vat_amount: 'VAT',
  total_amount: 'ยอดรวม',
  reference_no: 'เลขที่อ้างอิง',
  expected_date: 'วันที่คาดว่าจะได้รับใบกำกับภาษี',
  notes: 'หมายเหตุ',
} as const;

export const EXCEL_HEADER_ORDER = Object.values(EXCEL_HEADERS);

export interface ExcelImportRow {
  rowNumber: number; // เลขแถวจริงในไฟล์ Excel (แถว 1 = header เสมอ)
  vendor_name: string;
  transaction_date: string; // ISO YYYY-MM-DD หรือ '' ถ้าไม่ถูกต้อง/ไม่ได้กรอก
  vendor_tax_id: string;
  description: string;
  amount_excl_vat: string;
  vat_amount: string;
  // ตรวจจับอัตโนมัติจากยอดในคอลัมน์ VAT เท่านั้นเสมอ (VAT > 0 → claimable_vat, VAT ว่าง/0/"-" →
  // no_vat) ไม่มีคอลัมน์ให้ผู้ใช้กรอก/เลือกเองอีกต่อไป — '' หมายถึงคอลัมน์ VAT มีค่าที่อ่านเป็นตัวเลข
  // ไม่ได้ (ดู errors) ยังจำแนกประเภทไม่ได้ แถวนี้จะ import ไม่ได้จนกว่าจะแก้ไขค่า VAT ให้ถูกต้อง
  tax_type: TaxType | '';
  reference_no: string;
  expected_date: string;
  notes: string;
  errors: string[]; // ว่าง = ผ่านตรวจสอบพื้นฐาน แต่ยังต้องดู warnings/รายการซ้ำก่อน import อยู่ดี
  warnings: string[]; // ไม่ block การนำเข้า แต่ควรแจ้งเตือนให้ผู้ใช้ตรวจสอบก่อนยืนยัน
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type VatCellResult = { kind: 'ok'; amount: number } | { kind: 'invalid'; raw: string };

/** แปลงค่าจากคอลัมน์ "VAT" อย่างปลอดภัย — นี่คือแหล่งเดียวที่ใช้จำแนกว่ารายการ "มี VAT" หรือ "ไม่มี VAT"
 * (ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปตั้งแต่ 2026-07-15) รองรับ:
 * - ตัวเลขปกติ (7, 70, 140) และตัวเลขที่มี comma คั่นหลักพัน (เช่น "1,400.00")
 * - ค่าว่าง / ไม่มีค่า / เครื่องหมาย "-" / ข้อความที่มีแต่ช่องว่าง / 0 / 0.00 → ถือเป็น 0 ทั้งหมด (ไม่ error)
 * ห้ามคืนค่า NaN เด็ดขาด — ถ้าค่าที่กรอกมาไม่ใช่ตัวเลขล้วนๆ เลย (เช่น "abc" หรือ "12abc" ที่มีตัวอักษรปน)
 * จะคืนเป็น invalid ให้ parseExcelRow ใส่ error บล็อกแถวนั้นไว้จนกว่าจะแก้ไข */
export function parseVatCell(value: unknown): VatCellResult {
  if (value === null || value === undefined) return { kind: 'ok', amount: 0 };
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { kind: 'ok', amount: value } : { kind: 'invalid', raw: String(value) };
  }
  const raw = String(value).trim();
  if (raw === '' || raw === '-') return { kind: 'ok', amount: 0 };
  const cleaned = raw.replace(/,/g, '');
  // ต้องเป็นตัวเลขล้วนๆ ทั้งสตริง (parseFloat("12abc") จะได้ 12 ทั้งที่ไม่ใช่ตัวเลขล้วน จึงเช็คด้วย
  // regex ควบคู่ไปด้วยเสมอ ไม่พึ่ง parseFloat อย่างเดียว)
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { kind: 'invalid', raw };
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return { kind: 'invalid', raw };
  return { kind: 'ok', amount: parsed };
}

/**
 * แปลง 1 แถวดิบจาก Excel (object ที่ key ตรงกับหัวคอลัมน์ EXCEL_HEADERS) ให้เป็น ExcelImportRow
 * พร้อมตรวจสอบความถูกต้อง แถวที่ว่างทั้งแถว (เช่นแถวว่างท้ายไฟล์) จะคืนค่า null เพื่อข้ามไปได้
 *
 * การจำแนกประเภทภาษี (ตั้งแต่ 2026-07-15): ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปแล้ว —
 * ระบบตรวจจากยอดในคอลัมน์ "VAT" โดยตรงเสมอเพียงอย่างเดียว (ดู parseVatCell ด้านบนสำหรับการแปลงค่าที่
 * ปลอดภัย): VAT มากกว่า 0 → "มี VAT" (claimable_vat, เข้าขั้นตอนรอรับใบกำกับภาษีเดิมทุกประการ) VAT
 * เป็นค่าว่าง/0/0.00/เครื่องหมาย "-" → "ไม่มี VAT" (no_vat, ไม่มีขั้นตอนรอรับใดๆ) ข้อสังเกต: ก่อนหน้านี้
 * VAT ว่างจะถูกเสนอ 7% อัตโนมัติให้ (ระบบเดิมสมมติว่าผู้ใช้แค่ลืมกรอก) — ตอนนี้เปลี่ยนพฤติกรรมตามที่ระบุ
 * มาโดยตรง: VAT ว่าง = ไม่มี VAT จริงๆ ไม่ใช่ลืมกรอกอีกต่อไป (ฟอร์มเพิ่มรายการด้วยตนเองยังคงเสนอ 7%
 * อัตโนมัติเหมือนเดิมทุกประการ ไม่ถูกกระทบ — เปลี่ยนเฉพาะเส้นทางนำเข้าจาก Excel เท่านั้น)
 *
 * ถ้าคอลัมน์ VAT อ่านค่าเป็นตัวเลขไม่ได้เลย (เช่น "abc") จะถือเป็น error บล็อกแถวนั้นไว้ ยังไม่สามารถ
 * จำแนกประเภทภาษีได้ (tax_type จะเป็น '' ชั่วคราว) จนกว่าจะแก้ไขค่าให้ถูกต้อง
 */
export function parseExcelRow(raw: Record<string, unknown>, rowNumber: number): ExcelImportRow | null {
  const vendor_name = cellToString(raw[EXCEL_HEADERS.vendor_name]);
  const transactionDateRaw = raw[EXCEL_HEADERS.transaction_date];
  const vendor_tax_id = cellToString(raw[EXCEL_HEADERS.vendor_tax_id]);
  const description = cellToString(raw[EXCEL_HEADERS.description]);
  const amountRaw = raw[EXCEL_HEADERS.amount_excl_vat];
  const vatRaw = raw[EXCEL_HEADERS.vat_amount];
  const totalRaw = raw[EXCEL_HEADERS.total_amount];
  const reference_no = cellToString(raw[EXCEL_HEADERS.reference_no]);
  const expectedDateRaw = raw[EXCEL_HEADERS.expected_date];
  const notes = cellToString(raw[EXCEL_HEADERS.notes]);

  const isRowEmpty =
    !vendor_name &&
    !transactionDateRaw &&
    !vendor_tax_id &&
    !description &&
    (amountRaw === undefined || amountRaw === null || amountRaw === '') &&
    (vatRaw === undefined || vatRaw === null || vatRaw === '') &&
    !reference_no &&
    !expectedDateRaw &&
    !notes;
  if (isRowEmpty) return null;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!vendor_name) errors.push('ไม่ได้กรอกผู้ขาย');

  const transaction_date = parseExcelDateCell(transactionDateRaw) ?? '';
  if (!transaction_date) errors.push('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');

  // เลขประจำตัวผู้เสียภาษีไม่บังคับกรอก แต่ถ้ากรอกมาต้องเป็นตัวเลข 13 หลักเท่านั้น (เหมือนฟอร์มเพิ่มรายการ)
  if (vendor_tax_id && !/^\d{13}$/.test(vendor_tax_id)) {
    errors.push('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  }

  const amount_excl_vat = cellToNumberString(amountRaw);
  const amountNum = parseFloat(amount_excl_vat);
  const amountValid = amount_excl_vat !== '' && Number.isFinite(amountNum) && amountNum > 0;
  if (!amountValid) errors.push('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');

  // จำแนกประเภทภาษีจากยอด VAT เพียงอย่างเดียวเสมอ (ดู parseVatCell) — ไม่มีทางอื่นให้ระบุอีกแล้ว
  const vatCell = parseVatCell(vatRaw);
  let vat_amount: string;
  let tax_type: TaxType | '';
  if (vatCell.kind === 'invalid') {
    errors.push(
      `VAT ไม่ถูกต้อง: "${vatCell.raw}" (ต้องเป็นตัวเลขที่ไม่ติดลบ เช่น 7, 70, 1,400.00 หรือเว้นว่าง/"-" ถ้าไม่มี VAT)`
    );
    vat_amount = cellToString(vatRaw); // เก็บค่าดิบไว้แสดงในหน้าตรวจสอบ ให้เห็นว่ากรอกอะไรมาผิด
    tax_type = ''; // ยังจำแนกไม่ได้ — แถวนี้ import ไม่ได้อยู่แล้วเพราะมี error ค้างอยู่
  } else {
    vat_amount = String(vatCell.amount);
    tax_type = vatCell.amount > 0 ? 'claimable_vat' : 'no_vat';
  }

  // ตรวจสอบยอดรวมที่ผู้ใช้กรอกมาในไฟล์ (ถ้ามี) เทียบกับผลรวมที่คำนวณได้จริง (ยอดก่อน VAT + VAT) — แค่
  // เตือนเฉยๆ ไม่ error และไม่มีทาง "เขียนทับ" อะไรอยู่แล้ว เพราะยอดรวมจริงในฐานข้อมูลเป็นคอลัมน์ที่
  // Supabase คำนวณอัตโนมัติเสมอ (generated column) ไม่เคยอ่านค่าจากคอลัมน์นี้ไปบันทึกตรงๆ
  const totalCellText = cellToString(totalRaw);
  if (totalCellText && amountValid && vatCell.kind === 'ok') {
    const totalNum = parseFloat(totalCellText.replace(/,/g, ''));
    if (Number.isFinite(totalNum)) {
      const computedTotal = round2(amountNum + vatCell.amount);
      if (Math.abs(totalNum - computedTotal) > 0.01) {
        warnings.push(
          `ยอดรวมที่กรอกมา (${totalNum.toFixed(2)}) ไม่ตรงกับยอดที่คำนวณได้ (${computedTotal.toFixed(2)} = ยอดก่อน VAT + VAT) — ระบบจะบันทึกยอดรวมตามที่คำนวณได้เสมอ`
        );
      }
    }
  }

  const isNoVat = tax_type === 'no_vat';
  const expected_date = isNoVat ? '' : parseExcelDateCell(expectedDateRaw) ?? '';
  const expectedDateProvided =
    !isNoVat && expectedDateRaw !== undefined && expectedDateRaw !== null && String(expectedDateRaw).trim() !== '';
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
    vendor_tax_id,
    description,
    amount_excl_vat,
    vat_amount,
    tax_type,
    reference_no,
    expected_date,
    notes,
    errors,
    warnings,
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

function dedupeKey(vendorName: string, transactionDate: string, referenceNo: string | null, totalAmount: number): string {
  return [vendorName.trim().toLowerCase(), transactionDate, (referenceNo ?? '').trim().toLowerCase(), totalAmount.toFixed(2)].join(
    '|'
  );
}

/** ตรวจหารายการที่ดูเหมือนจะซ้ำกับรายการที่มีอยู่แล้วในระบบ ก่อนนำเข้าจาก Excel — เทียบจาก
 * ผู้ขาย + วันที่ทำรายการ + เลขที่อ้างอิง + ยอดรวม ตรงกันทั้งหมด คืนค่าเป็นเซ็ตของ rowNumber ที่ซ้ำ
 * ไม่ block การนำเข้า (แค่เตือน) — ผู้ใช้เลือกรวมรายการนั้นเข้าไปได้เองในหน้าตรวจสอบถ้ามั่นใจว่าไม่ซ้ำจริง
 * ข้ามแถวที่มี errors อยู่แล้วเพราะยังไงก็ import ไม่ได้ ไม่ต้องเสียเวลาตรวจซ้ำ */
export function findDuplicateRowNumbers(rows: ExcelImportRow[], existingInvoices: PendingTaxInvoice[]): Set<number> {
  const existingKeys = new Set(
    existingInvoices.map((inv) => dedupeKey(inv.vendor_name, inv.transaction_date, inv.reference_no, inv.total_amount))
  );
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (row.errors.length > 0) continue;
    const amount = parseFloat(row.amount_excl_vat) || 0;
    const vat = parseFloat(row.vat_amount) || 0;
    const key = dedupeKey(row.vendor_name, row.transaction_date, row.reference_no, round2(amount + vat));
    if (existingKeys.has(key)) duplicates.add(row.rowNumber);
  }
  return duplicates;
}

/** แปลง ExcelImportRow ที่ผ่านการตรวจสอบและมีประเภทภาษีที่ชัดเจนแล้ว ให้เป็น payload สำหรับบันทึกลง
 * Supabase — สถานะ (pending/received) คำนวณอัตโนมัติตามประเภทภาษี (ดู deriveStatusForTaxType)
 * หมายเหตุ: ฟังก์ชันนี้ควรถูกเรียกเฉพาะแถวที่ tax_type ไม่ใช่ '' เท่านั้น (หน้าตรวจสอบกรองแถว error/
 * ยังจำแนกไม่ได้ออกไปก่อนแล้วเสมอ) ค่า default 'no_vat' ด้านล่างเป็นแค่ fallback ป้องกันไว้เฉยๆ ในทาง
 * ปฏิบัติไม่ควรถูกใช้จริง */
export function excelRowToWriteInput(row: ExcelImportRow): InvoiceWriteInput {
  const taxType: TaxType = row.tax_type || 'no_vat';
  const isNoVat = taxType === 'no_vat';
  return {
    vendor_name: row.vendor_name.trim(),
    transaction_date: row.transaction_date,
    description: row.description.trim() || null,
    amount_excl_vat: parseFloat(row.amount_excl_vat) || 0,
    vat_amount: isNoVat ? 0 : parseFloat(row.vat_amount) || 0,
    reference_no: row.reference_no.trim() || null,
    expected_date: isNoVat ? null : row.expected_date || null,
    notes: row.notes.trim() || null,
    vendor_tax_id: row.vendor_tax_id.trim() || null,
    tax_type: taxType,
    status: deriveStatusForTaxType(taxType),
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

/** สร้างไฟล์ Excel เทมเพลตพร้อมตัวอย่าง 2 แถว (มี VAT / ไม่มี VAT) คืนค่าเป็น Blob พร้อมดาวน์โหลด —
 * ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอกเองแล้ว ใส่ตัวอย่าง 2 แถวไว้แทนเพื่อให้เห็นชัดว่าระบบตรวจจากคอลัมน์
 * VAT เพียงอย่างเดียว: แถวแรกกรอก VAT มา (ตรวจพบว่า "มี VAT") แถวสองเว้นว่างคอลัมน์ VAT ไว้ (ตรวจพบว่า
 * "ไม่มี VAT") */
export function buildTemplateBlob(): Blob {
  const exampleRows: Record<string, unknown>[] = [
    {
      [EXCEL_HEADERS.vendor_name]: 'บริษัท ตัวอย่าง จำกัด',
      [EXCEL_HEADERS.transaction_date]: new Date(),
      [EXCEL_HEADERS.vendor_tax_id]: '',
      [EXCEL_HEADERS.description]: 'ค่าสินค้า/บริการ ตัวอย่างรายการมี VAT (ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
      [EXCEL_HEADERS.amount_excl_vat]: 1000,
      [EXCEL_HEADERS.vat_amount]: 70,
      [EXCEL_HEADERS.total_amount]: '(ไม่ต้องกรอก ระบบคำนวณให้อัตโนมัติ)',
      [EXCEL_HEADERS.reference_no]: 'PO-0001',
      [EXCEL_HEADERS.expected_date]: '',
      [EXCEL_HEADERS.notes]: '',
    },
    {
      [EXCEL_HEADERS.vendor_name]: 'ร้านค้า ตัวอย่าง 2',
      [EXCEL_HEADERS.transaction_date]: new Date(),
      [EXCEL_HEADERS.vendor_tax_id]: '',
      [EXCEL_HEADERS.description]: 'ตัวอย่างรายการไม่มี VAT — เว้นว่างช่อง VAT ไว้ (ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
      [EXCEL_HEADERS.amount_excl_vat]: 500,
      [EXCEL_HEADERS.vat_amount]: '',
      [EXCEL_HEADERS.total_amount]: '(ไม่ต้องกรอก ระบบคำนวณให้อัตโนมัติ)',
      [EXCEL_HEADERS.reference_no]: '',
      [EXCEL_HEADERS.expected_date]: '',
      [EXCEL_HEADERS.notes]: '',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(exampleRows, { header: EXCEL_HEADER_ORDER });
  worksheet['!cols'] = EXCEL_HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายการ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
