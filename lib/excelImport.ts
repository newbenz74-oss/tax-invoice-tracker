import * as XLSX from 'xlsx';
import { deriveStatusForTaxType, suggestVatAmount } from './invoiceLogic';
import type { InvoiceWriteInput } from './invoiceApi';
import type { PendingTaxInvoice, TaxType } from '@/types/invoice';

/** หัวคอลัมน์ในไฟล์ Excel (ทั้งไฟล์เทมเพลตที่สร้างให้ และไฟล์ที่ผู้ใช้อัปโหลดกลับมา)
 * เพิ่ม vendor_tax_id/tax_type/total_amount เข้ามาพร้อมฟีเจอร์จำแนกประเภทภาษี — total_amount เป็น
 * คอลัมน์อ้างอิงเฉยๆ (ตรงกับ total_amount ที่ฐานข้อมูลคำนวณอัตโนมัติอยู่แล้ว) parseExcelRow() ไม่อ่าน
 * ค่าจากคอลัมน์นี้เลย จึงใส่อะไรมาก็ไม่มีผลต่อข้อมูลที่บันทึกจริง */
export const EXCEL_HEADERS = {
  vendor_name: 'ผู้ขาย',
  transaction_date: 'วันที่ทำรายการ',
  vendor_tax_id: 'เลขประจำตัวผู้เสียภาษี',
  description: 'รายละเอียด',
  amount_excl_vat: 'ยอดก่อน VAT',
  vat_amount: 'VAT',
  total_amount: 'ยอดรวม',
  tax_type: 'ประเภทภาษี',
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
  // '' หมายถึงคอลัมน์ "ประเภทภาษี" มีค่าที่ไม่รู้จัก (ดู errors) — ยังไม่เคยเป็น '' เพราะแค่ "ว่าง"
  // เฉยๆ เพราะกรณีว่างจะถูกอนุมานให้ค่าเสมอ (ดู taxTypeSource)
  tax_type: TaxType | '';
  // 'column' = อ่านมาจากคอลัมน์ประเภทภาษีตรงๆ (หรือผู้ใช้แก้ไขเองในหน้าตรวจสอบแล้ว)
  // 'inferred' = คอลัมน์ว่าง/ไม่มีคอลัมน์นี้ในไฟล์ ระบบอนุมานจากยอด VAT ให้ — ควรชวนผู้ใช้ตรวจสอบอีกที
  taxTypeSource: 'column' | 'inferred';
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

const TAX_TYPE_HINT =
  'ไม่มี VAT / มี VAT และใช้เครดิต VAT / มี VAT แต่ไม่ใช้เครดิต VAT (หรือรหัส no_vat / claimable_vat / non_claimable_vat)';

// เทียบแบบ exact match เท่านั้น (ไม่ใช่ substring) — ตั้งใจหลีกเลี่ยงปัญหาค่าที่สั้นกว่าไปจับคู่ผิดกับ
// ค่าที่ยาวกว่าโดยไม่ตั้งใจ (เช่น "มี vat" ต้องไม่ไปจับคู่ผิดกับ "มี vat แต่ไม่ใช้เครดิต vat")
// key ทุกตัวเขียนเป็นตัวพิมพ์เล็กอยู่แล้ว — ส่วนอักษรไทยไม่มีผลจาก .toLowerCase() (แปลงเฉพาะ ASCII)
const TAX_TYPE_ALIASES: Record<string, TaxType> = {
  no_vat: 'no_vat',
  claimable_vat: 'claimable_vat',
  non_claimable_vat: 'non_claimable_vat',
  'ไม่มี vat': 'no_vat',
  'มี vat และใช้เครดิต vat': 'claimable_vat',
  'มี vat': 'claimable_vat',
  'มี vat แต่ไม่ใช้เครดิต vat': 'non_claimable_vat',
  'มี vat ไม่ใช้เครดิต': 'non_claimable_vat',
  'มี vat ไม่ใช้เครดิต vat': 'non_claimable_vat',
};

type TaxTypeCellResult = { kind: 'value'; value: TaxType } | { kind: 'blank' } | { kind: 'invalid'; raw: string };

/** แปลงค่าจากคอลัมน์ "ประเภทภาษี" — รองรับทั้งป้ายภาษาไทย (ดู TAX_TYPE_ALIASES) และรหัสภาษาอังกฤษ
 * (no_vat/claimable_vat/non_claimable_vat) ไม่สนตัวพิมพ์เล็ก-ใหญ่ของอักษรอังกฤษ และตัดช่องว่างซ้ำ */
export function parseTaxTypeCell(value: unknown): TaxTypeCellResult {
  const raw = cellToString(value);
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!normalized) return { kind: 'blank' };
  const found = TAX_TYPE_ALIASES[normalized];
  if (found) return { kind: 'value', value: found };
  return { kind: 'invalid', raw };
}

/**
 * แปลง 1 แถวดิบจาก Excel (object ที่ key ตรงกับหัวคอลัมน์ EXCEL_HEADERS) ให้เป็น ExcelImportRow
 * พร้อมตรวจสอบความถูกต้อง — ถ้า VAT ไม่ได้กรอกจะเสนอ 7% อัตโนมัติจากยอดก่อน VAT
 * แถวที่ว่างทั้งแถว (เช่นแถวว่างท้ายไฟล์) จะคืนค่า null เพื่อข้ามไปได้
 *
 * ลำดับการอ่านประเภทภาษี: อ่านจากคอลัมน์ "ประเภทภาษี" ก่อนเสมอถ้ามีค่า — ถ้าระบุ "ไม่มี VAT" มาชัดเจน
 * จะบังคับ VAT เป็น 0 ทันที (เหมือนพฤติกรรมฟอร์มเพิ่มรายการด้วยตนเอง) ถ้าคอลัมน์นี้ว่างหรือไม่มีในไฟล์
 * จะปล่อยให้ VAT ผ่านการเสนอ 7% อัตโนมัติตามปกติก่อน แล้วค่อยอนุมานประเภทภาษีจากผลลัพธ์ VAT สุดท้าย
 * (VAT > 0 → มี VAT และใช้เครดิตได้, VAT = 0 → ไม่มี VAT) ซึ่งตรงกับพฤติกรรมเดิมของไฟล์นำเข้าก่อนมี
 * ฟีเจอร์นี้ทุกประการ (แถวที่ไม่กรอก VAT มาจะถูกเสนอ 7% แล้วกลายเป็นรายการที่รอรับใบกำกับภาษีตามเดิม)
 */
export function parseExcelRow(raw: Record<string, unknown>, rowNumber: number): ExcelImportRow | null {
  const vendor_name = cellToString(raw[EXCEL_HEADERS.vendor_name]);
  const transactionDateRaw = raw[EXCEL_HEADERS.transaction_date];
  const vendor_tax_id = cellToString(raw[EXCEL_HEADERS.vendor_tax_id]);
  const description = cellToString(raw[EXCEL_HEADERS.description]);
  const amountRaw = raw[EXCEL_HEADERS.amount_excl_vat];
  const vatRaw = raw[EXCEL_HEADERS.vat_amount];
  const taxTypeRaw = raw[EXCEL_HEADERS.tax_type];
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
    !cellToString(taxTypeRaw) &&
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

  const taxTypeCell = parseTaxTypeCell(taxTypeRaw);
  let tax_type: TaxType | '' = '';
  let taxTypeSource: 'column' | 'inferred' = 'column';
  if (taxTypeCell.kind === 'invalid') {
    errors.push(`ประเภทภาษีไม่ถูกต้อง: "${taxTypeCell.raw}" (ต้องเป็น ${TAX_TYPE_HINT})`);
  } else if (taxTypeCell.kind === 'value') {
    tax_type = taxTypeCell.value;
  } else {
    taxTypeSource = 'inferred';
  }

  let vat_amount = cellToNumberString(vatRaw);
  if (tax_type === 'no_vat') {
    if (vat_amount !== '' && parseFloat(vat_amount) > 0) {
      warnings.push('ประเภทเป็น "ไม่มี VAT" แต่ระบุยอด VAT มากกว่า 0 — ระบบปรับเป็น 0 ให้อัตโนมัติ');
    }
    vat_amount = '0';
  } else if (vat_amount === '') {
    vat_amount = amountValid ? String(suggestVatAmount(amountNum)) : '';
  } else {
    const vatNum = parseFloat(vat_amount);
    if (Number.isNaN(vatNum) || vatNum < 0) errors.push('VAT ไม่ถูกต้อง');
  }

  if (taxTypeSource === 'inferred') {
    const vatNum = parseFloat(vat_amount);
    tax_type = Number.isFinite(vatNum) && vatNum > 0 ? 'claimable_vat' : 'no_vat';
  }

  if (tax_type === 'claimable_vat') {
    const vatNum = parseFloat(vat_amount);
    if (!Number.isFinite(vatNum) || vatNum <= 0) {
      warnings.push('ประเภทมี VAT และใช้เครดิตได้ แต่ยอด VAT เป็น 0 — ตรวจสอบยอด VAT อีกครั้ง');
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
    taxTypeSource,
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
 * Supabase — สถานะ (pending/received) คำนวณอัตโนมัติตามประเภทภาษี (ดู deriveStatusForTaxType) */
export function excelRowToWriteInput(row: ExcelImportRow): InvoiceWriteInput {
  const taxType: TaxType = row.tax_type || 'claimable_vat';
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

/** สร้างไฟล์ Excel เทมเพลตพร้อมตัวอย่าง 1 แถว คืนค่าเป็น Blob พร้อมดาวน์โหลด */
export function buildTemplateBlob(): Blob {
  const exampleRow: Record<string, unknown> = {
    [EXCEL_HEADERS.vendor_name]: 'บริษัท ตัวอย่าง จำกัด',
    [EXCEL_HEADERS.transaction_date]: new Date(),
    [EXCEL_HEADERS.vendor_tax_id]: '',
    [EXCEL_HEADERS.description]: 'ค่าสินค้า/บริการ (ตัวอย่าง — ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
    [EXCEL_HEADERS.amount_excl_vat]: 1000,
    [EXCEL_HEADERS.vat_amount]: '',
    [EXCEL_HEADERS.total_amount]: '(ไม่ต้องกรอก ระบบคำนวณให้อัตโนมัติ)',
    [EXCEL_HEADERS.tax_type]: 'มี VAT และใช้เครดิต VAT',
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
