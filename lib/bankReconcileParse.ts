import * as XLSX from 'xlsx';
import { parseExcelDateCell, readWorkbookRows } from './excelImport';
import type { BankTransaction, GLTransaction, ParsedTransactionFile, TransactionType } from '@/types/bankReconcile';

/**
 * ตัวอ่านไฟล์สำหรับโมดูล "กระทบยอด Bank Reconcile" เวอร์ชันใหม่ — รองรับ Excel / CSV / PDF ตามสเปก
 * ไม่มีขั้นตอนให้ผู้ใช้ map คอลัมน์เอง (STEP 1 ในสเปกมีแค่ปุ่มอัปโหลด 2 ปุ่ม + ปุ่ม "ตรวจสอบข้อมูล" เท่านั้น)
 * ดังนั้นการหาคอลัมน์ที่ต้องใช้ (วันที่ / รับ / จ่าย / เลขที่เอกสาร) ต้องทำแบบอัตโนมัติทั้งหมดผ่านการเทียบ
 * หัวคอลัมน์กับรายการคำที่ใช้เรียกกันทั่วไป (ทั้งไทยและอังกฤษ) ด้านล่างนี้
 *
 * โครงสร้างแถวที่รองรับ: แต่ละแถวมีคอลัมน์ "รับ" และ "จ่าย" แยกกัน (ตรงกับตัวอย่าง layout ในสเปกที่โชว์
 * Date/Receive/Payment เป็น 3 คอลัมน์แยกกันเสมอ) — 1 แถวควรมีค่าอยู่ในคอลัมน์ใดคอลัมน์หนึ่งเท่านั้น
 * (รับ > 0 xor จ่าย > 0) ถ้ามีทั้งคู่พร้อมกันหรือไม่มีเลยทั้งคู่ แถวนั้นจะถูกข้าม (ดู extractTypeAndAmount)
 */

// ---------- Header alias matching ----------

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

const DATE_ALIASES = [
  'วันที่',
  'วันที่ทำรายการ',
  'วันที่รายการ',
  'date',
  'transactiondate',
  'valuedate',
  'postingdate',
  'txndate',
  'docdate',
].map(normalizeHeader);

const RECEIVE_ALIASES = [
  'รับ',
  'เงินรับ',
  'เงินเข้า',
  'ฝาก',
  'ยอดรับ',
  'receive',
  'deposit',
  'depositamount',
  'credit',
  'cr',
].map(normalizeHeader);

const PAYMENT_ALIASES = [
  'จ่าย',
  'เงินจ่าย',
  'เงินออก',
  'ถอน',
  'ยอดจ่าย',
  'payment',
  'withdraw',
  'withdrawal',
  'withdrawalamount',
  'debit',
  'dr',
].map(normalizeHeader);

const DOC_NO_ALIASES = [
  'เลขที่เอกสาร',
  'เลขเอกสาร',
  'เลขที่บิล',
  'เลขที่อ้างอิง',
  'documentno',
  'docno',
  'voucherno',
  'refno',
  'referenceno',
].map(normalizeHeader);

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalizedMap = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const alias of aliases) {
    const hit = normalizedMap.get(alias);
    if (hit) return hit;
  }
  return null;
}

// ---------- Cell value helpers ----------

function cellToAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isRowBlank(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((v) => v === null || v === undefined || String(v).trim() === '');
}

interface DetectedColumns {
  dateCol: string;
  receiveCol: string;
  paymentCol: string;
  docNoCol?: string;
}

function detectRequiredColumns(
  rawRows: Record<string, unknown>[],
  includeDocNo: boolean
): { columns: DetectedColumns | null; error: string | null } {
  if (rawRows.length === 0) {
    return { columns: null, error: 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูลเลย)' };
  }
  const headers = Object.keys(rawRows[0]);
  const dateCol = findColumn(headers, DATE_ALIASES);
  const receiveCol = findColumn(headers, RECEIVE_ALIASES);
  const paymentCol = findColumn(headers, PAYMENT_ALIASES);

  const missing: string[] = [];
  if (!dateCol) missing.push('วันที่ (Date)');
  if (!receiveCol) missing.push('รับ (Receive)');
  if (!paymentCol) missing.push('จ่าย (Payment)');

  let docNoCol: string | undefined;
  if (includeDocNo) {
    docNoCol = findColumn(headers, DOC_NO_ALIASES) ?? undefined;
    if (!docNoCol) missing.push('เลขที่เอกสาร (Document No.)');
  }

  if (missing.length > 0) {
    return {
      columns: null,
      error: `ไม่พบคอลัมน์ที่จำเป็นในไฟล์: ${missing.join(', ')} — กรุณาตรวจสอบหัวคอลัมน์ในไฟล์ต้นฉบับ`,
    };
  }
  return { columns: { dateCol: dateCol!, receiveCol: receiveCol!, paymentCol: paymentCol!, docNoCol }, error: null };
}

function extractTypeAndAmount(
  raw: Record<string, unknown>,
  columns: DetectedColumns,
  rowNumber: number,
  warnings: string[]
): { type: TransactionType; amount: number } | null {
  const receiveAmount = cellToAmount(raw[columns.receiveCol]);
  const paymentAmount = cellToAmount(raw[columns.paymentCol]);
  const hasReceive = receiveAmount !== null && receiveAmount > 0;
  const hasPayment = paymentAmount !== null && paymentAmount > 0;

  if (hasReceive && hasPayment) {
    warnings.push(`แถวที่ ${rowNumber}: มีค่าทั้งในคอลัมน์รับและจ่ายพร้อมกัน ข้ามแถวนี้ (ระบุประเภทไม่ได้ชัดเจน)`);
    return null;
  }
  if (!hasReceive && !hasPayment) {
    return null; // แถวว่าง ไม่มีทั้งรับและจ่าย ข้ามแบบเงียบๆ (มักเป็นแถวว่างท้ายไฟล์ หรือแถวผลรวม)
  }
  return hasReceive
    ? { type: 'receive', amount: round2(receiveAmount!) }
    : { type: 'payment', amount: round2(paymentAmount!) };
}

// ---------- Public: raw rows → typed transactions ----------

export function parseBankRows(rawRows: Record<string, unknown>[]): ParsedTransactionFile<BankTransaction> {
  const { columns, error } = detectRequiredColumns(rawRows, false);
  if (!columns) return { rows: [], errors: [error!], warnings: [] };

  const rows: BankTransaction[] = [];
  const warnings: string[] = [];
  rawRows.forEach((raw, idx) => {
    if (isRowBlank(raw)) return;
    const rowNumber = idx + 2; // แถว 1 = header เสมอ
    const dateIso = parseExcelDateCell(raw[columns.dateCol]);
    if (!dateIso) {
      warnings.push(`แถวที่ ${rowNumber}: วันที่ไม่ถูกต้องหรือไม่ได้กรอก ข้ามแถวนี้`);
      return;
    }
    const typeAndAmount = extractTypeAndAmount(raw, columns, rowNumber, warnings);
    if (!typeAndAmount) return;
    rows.push({ id: `bank-${idx}`, date: dateIso, type: typeAndAmount.type, amount: typeAndAmount.amount });
  });

  return { rows, errors: [], warnings };
}

export function parseGLRows(rawRows: Record<string, unknown>[]): ParsedTransactionFile<GLTransaction> {
  const { columns, error } = detectRequiredColumns(rawRows, true);
  if (!columns) return { rows: [], errors: [error!], warnings: [] };

  const rows: GLTransaction[] = [];
  const warnings: string[] = [];
  rawRows.forEach((raw, idx) => {
    if (isRowBlank(raw)) return;
    const rowNumber = idx + 2;
    const dateIso = parseExcelDateCell(raw[columns.dateCol]);
    if (!dateIso) {
      warnings.push(`แถวที่ ${rowNumber}: วันที่ไม่ถูกต้องหรือไม่ได้กรอก ข้ามแถวนี้`);
      return;
    }
    const typeAndAmount = extractTypeAndAmount(raw, columns, rowNumber, warnings);
    if (!typeAndAmount) return;
    const documentNo = columns.docNoCol ? String(raw[columns.docNoCol] ?? '').trim() : '';
    rows.push({
      id: `gl-${idx}`,
      documentNo,
      date: dateIso,
      type: typeAndAmount.type,
      amount: typeAndAmount.amount,
    });
  });

  return { rows, errors: [], warnings };
}

// ---------- File reading dispatch (Excel / CSV / PDF) ----------

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** อ่าน CSV จาก ArrayBuffer โดย decode เป็นข้อความก่อนเสมอ แล้วส่งให้ XLSX.read แบบ type: 'string' อ่าน
 * (ไม่พึ่งการ auto-detect ของ XLSX.read แบบ type: 'array' เพราะอยากมั่นใจว่าไฟล์ .csv ถูกอ่านเป็นข้อความ
 * เสมอ ไม่ใช่พยายามตีความเป็นไฟล์ไบนารีของ Excel) ใช้ตัวอ่านเดียวกับ Excel (XLSX.utils.sheet_to_json)
 * เพื่อให้ผลลัพธ์เป็น Record<string, unknown>[] รูปแบบเดียวกันทุกประเภทไฟล์ */
function readCsvRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  const text = new TextDecoder('utf-8').decode(buffer);
  const workbook = XLSX.read(text, { type: 'string', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
}

async function readRowsFromFile(file: File): Promise<Record<string, unknown>[]> {
  const ext = getExtension(file.name);
  const buffer = await file.arrayBuffer();

  if (ext === 'csv') return readCsvRows(buffer);
  if (ext === 'pdf') return readRowsFromPdf(buffer);
  // ค่าเริ่มต้น (.xlsx / .xls / นามสกุลอื่นที่ไม่รู้จัก): ใช้ตัวอ่าน Excel เดิมของระบบ (readWorkbookRows
  // จาก lib/excelImport.ts) เพื่อไม่มี logic อ่านไฟล์ Excel ซ้ำซ้อนกันสองที่ในระบบ
  return readWorkbookRows(buffer);
}

const FILE_READ_ERROR = 'อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์ไม่เสียหาย และเป็นไฟล์ประเภท .xlsx, .xls, .csv หรือ .pdf';

export async function parseBankFile(file: File): Promise<ParsedTransactionFile<BankTransaction>> {
  try {
    const rawRows = await readRowsFromFile(file);
    return parseBankRows(rawRows);
  } catch (err) {
    return { rows: [], errors: [err instanceof Error && err.message ? err.message : FILE_READ_ERROR], warnings: [] };
  }
}

export async function parseGLFile(file: File): Promise<ParsedTransactionFile<GLTransaction>> {
  try {
    const rawRows = await readRowsFromFile(file);
    return parseGLRows(rawRows);
  } catch (err) {
    return { rows: [], errors: [err instanceof Error && err.message ? err.message : FILE_READ_ERROR], warnings: [] };
  }
}

// ---------- PDF: best-effort text-position table extraction ----------
//
// PDF ไม่มีโครงสร้างตาราง/คอลัมน์จริงๆ ให้อ่านเหมือน Excel/CSV — มีแค่ "ข้อความ + ตำแหน่ง x/y" ของตัวอักษร
// แต่ละกลุ่มบนหน้ากระดาษเท่านั้น วิธีด้านล่างนี้เป็น heuristic แบบ best-effort: จัดกลุ่มข้อความที่อยู่
// แนวเดียวกัน (y ใกล้เคียงกัน) ให้เป็น "บรรทัด" เรียงจากบนลงล่าง แล้วหาบรรทัดที่น่าจะเป็น "หัวตาราง" (มีคำ
// ที่ตรงกับ alias ของคอลัมน์ที่ต้องใช้อย่างน้อย 2 ใน 3) ใช้ตำแหน่ง x ของหัวคอลัมน์เหล่านั้นเป็นตัวช่วยแบ่ง
// ข้อความในบรรทัดถัดๆ ไปเข้าคอลัมน์ที่ใกล้ที่สุด
//
// ข้อจำกัดที่ทราบอยู่แล้ว (ไม่รับประกันความถูกต้อง 100% กับ PDF ทุกรูปแบบ):
// - PDF ที่สแกนมาเป็นรูปภาพล้วนๆ (ไม่มี text layer) จะไม่มีข้อความให้อ่านเลย — จะได้ error แจ้งผู้ใช้ให้ใช้
//   ไฟล์ Excel/CSV แทน ไม่ใช่ผลลัพธ์ว่างเปล่าแบบเงียบๆ
// - ตารางที่มีคอลัมน์ชิดกันมาก หรือมีข้อความหลายบรรทัดในเซลล์เดียว อาจแยกคอลัมน์ผิดพลาดได้
// - รองรับเฉพาะ PDF ที่มีบรรทัดหัวตาราง (วันที่/รับ/จ่าย) อยู่ในหน้าเดียวกับข้อมูลเท่านั้น

interface TextItemPos {
  text: string;
  x: number;
  y: number;
}

async function extractTextItemsByPage(buffer: ArrayBuffer): Promise<TextItemPos[][]> {
  const pdfjsLib = await import('pdfjs-dist');
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }

  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: TextItemPos[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: TextItemPos[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str || !item.str.trim()) continue;
      items.push({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] });
    }
    pages.push(items);
  }
  return pages;
}

/** จัดกลุ่ม text items ในหน้าเดียวกันเป็น "บรรทัด" ตามตำแหน่ง y ที่ใกล้เคียงกัน (yTolerance หน่วยเป็น
 * PDF point) เรียงบรรทัดจากบนลงล่าง (y มากไปน้อย เพราะระบบพิกัดของ PDF นับจากมุมล่างซ้าย) และเรียงคำใน
 * แต่ละบรรทัดจากซ้ายไปขวาด้วย x */
function groupIntoLines(items: TextItemPos[], yTolerance = 3): TextItemPos[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItemPos[][] = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= yTolerance);
    if (line) line.push(item);
    else lines.push([item]);
  }
  lines.forEach((l) => l.sort((a, b) => a.x - b.x));
  return lines;
}

function findHeaderLine(lines: TextItemPos[][]): { line: TextItemPos[]; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].map((it) => normalizeHeader(it.text));
    const hasDate = normalized.some((t) => DATE_ALIASES.includes(t));
    const hasReceive = normalized.some((t) => RECEIVE_ALIASES.includes(t));
    const hasPayment = normalized.some((t) => PAYMENT_ALIASES.includes(t));
    const score = [hasDate, hasReceive, hasPayment].filter(Boolean).length;
    if (score >= 2) return { line: lines[i], index: i };
  }
  return null;
}

/** แปลงบรรทัดข้อมูล (บรรทัดที่อยู่ถัดจากบรรทัดหัวตาราง) ให้เป็น object แถว โดยเทียบตำแหน่ง x ของแต่ละคำกับ
 * ตำแหน่ง x ของหัวคอลัมน์ที่ใกล้ที่สุด แล้วต่อข้อความรวมกันถ้ามีมากกว่า 1 คำในคอลัมน์เดียวกัน */
function linesToRows(lines: TextItemPos[][], headerLine: TextItemPos[], headerIndex: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const row: Record<string, unknown> = {};
    for (const item of line) {
      let closest = headerLine[0];
      let minDist = Math.abs(closest.x - item.x);
      for (const h of headerLine) {
        const dist = Math.abs(h.x - item.x);
        if (dist < minDist) {
          minDist = dist;
          closest = h;
        }
      }
      row[closest.text] = row[closest.text] ? `${row[closest.text]} ${item.text}` : item.text;
    }
    rows.push(row);
  }
  return rows;
}

async function readRowsFromPdf(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const pages = await extractTextItemsByPage(buffer);
  const allRows: Record<string, unknown>[] = [];
  for (const pageItems of pages) {
    if (pageItems.length === 0) continue;
    const lines = groupIntoLines(pageItems);
    const header = findHeaderLine(lines);
    if (!header) continue; // หน้านี้ไม่พบบรรทัดหัวตาราง (อาจเป็นหน้าปก/หน้าสรุป) ข้ามไปหน้าอื่น
    allRows.push(...linesToRows(lines, header.line, header.index));
  }
  if (allRows.length === 0) {
    throw new Error(
      'ไม่สามารถอ่านโครงสร้างตารางจากไฟล์ PDF นี้ได้ (อาจเป็น PDF ที่สแกนเป็นรูปภาพ หรือไม่พบหัวคอลัมน์ วันที่/รับ/จ่าย) กรุณาใช้ไฟล์ Excel หรือ CSV แทน'
    );
  }
  return allRows;
}
