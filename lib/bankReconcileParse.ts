import * as XLSX from 'xlsx';
import { parseExcelDateCell } from './excelImport';
import type { BankTransaction, GLTransaction, ParsedTransactionFile, TransactionType } from '@/types/bankReconcile';

/**
 * ตัวอ่านไฟล์สำหรับโมดูล "กระทบยอด Bank Reconcile" เวอร์ชันใหม่ — รองรับ Excel / CSV / PDF ตามสเปก
 * ไม่มีขั้นตอนให้ผู้ใช้ map คอลัมน์เอง (STEP 1 ในสเปกมีแค่ปุ่มอัปโหลด 2 ปุ่ม + ปุ่ม "ตรวจสอบข้อมูล" เท่านั้น)
 * ดังนั้นการหาคอลัมน์ที่ต้องใช้ (วันที่ / รับ / จ่าย / เลขที่เอกสาร) ต้องทำแบบอัตโนมัติทั้งหมดผ่านการเทียบ
 * หัวคอลัมน์กับรายการคำที่ใช้เรียกกันทั่วไป (ทั้งไทยและอังกฤษ) ด้านล่างนี้
 *
 * ⚠️ อัปเดต 2026-07-17 (หลังทดสอบกับไฟล์ GL จริงของผู้ใช้ — ไฟล์รายงานแยกประเภทจากโปรแกรมบัญชีไทย):
 * พบ 3 ปัญหาที่ทำให้ไฟล์จริงอ่านไม่ออก ทั้งที่ตรรกะเดิมผ่านเทสต์ครบ (เพราะเทสต์เดิมใช้ไฟล์ตัวอย่างที่เรียบ
 * ง่ายเกินไป ไม่ตรงกับความซับซ้อนของไฟล์จากโปรแกรมบัญชีจริง) แก้ไขแล้วทั้ง 3 จุด:
 * 1. ไฟล์ CSV จากโปรแกรมบัญชีไทยจำนวนมากเข้ารหัสแบบ Windows-874 (=TIS-620) ไม่ใช่ UTF-8 — decode เป็น
 *    UTF-8 ตรงๆ จะได้ตัวอักษรไทยเพี้ยน (mojibake) ทำให้เทียบหัวคอลัมน์ไม่ตรงเลยสักคอลัมน์ (ดู decodeCsvBuffer)
 * 2. รายงานจากโปรแกรมบัญชีมักมีแถวหัวรายงาน/ชื่อบริษัท/ช่วงวันที่ ก่อนแถวหัวคอลัมน์จริงหลายแถว (ไม่ใช่แถว
 *    แรกเสมอไปแบบที่สมมติไว้เดิม) — เปลี่ยนมาอ่านเป็น array-of-arrays ดิบๆ (header:1) แล้วสแกนหาแถวที่มี
 *    คอลัมน์ครบจริงๆ ในช่วง 20 แถวแรกแทน (ดู detectHeaderRow)
 * 3. งบบัญชีแยกประเภทของบัญชีธนาคาร (บัญชีสินทรัพย์) มักใช้คอลัมน์ "เดบิต"/"เครดิต" แทน "รับ"/"จ่าย" ตรงๆ
 *    — สำหรับบัญชีสินทรัพย์ เดบิต = เงินเข้า (รับ), เครดิต = เงินออก (จ่าย) ตามหลักบัญชีคู่มาตรฐาน (ยืนยัน
 *    จากข้อมูลจริงในไฟล์ตัวอย่างแล้วว่าตรงกับหลักนี้เป๊ะ) เพิ่ม "เดบิต"/"debit"/"dr" เข้า RECEIVE_ALIASES
 *    และ "เครดิต"/"credit"/"cr" เข้า PAYMENT_ALIASES (ของเดิมใส่สลับฝั่งกันไว้ผิด แก้ไขแล้ว)
 * นอกจากนี้เพิ่มการแปลงปี พ.ศ. → ค.ศ. อัตโนมัติด้วย (ดู parseDateCellWithEraConversion) เพราะไฟล์บัญชีไทย
 * มักใช้ปี พ.ศ. ในคอลัมน์วันที่ (เช่น 01/06/2569) ซึ่ง parseExcelDateCell เดิมไม่แปลงให้ — จงใจไม่แก้ไข
 * parseExcelDateCell ใน lib/excelImport.ts ตรงๆ เพราะฟังก์ชันนั้นใช้ร่วมกับฟีเจอร์นำเข้า Excel ใบกำกับภาษี
 * เดิมที่ทำงานถูกต้องอยู่แล้วด้วยปี ค.ศ. เสมอ ไม่อยากเสี่ยงกระทบฟีเจอร์อื่นที่ไม่เกี่ยวข้องกับ Bank Reconcile
 *
 * โครงสร้างแถวที่รองรับ: แต่ละแถวมีคอลัมน์ "รับ" และ "จ่าย" (หรือ "เดบิต"/"เครดิต") แยกกัน — 1 แถวควรมีค่า
 * อยู่ในคอลัมน์ใดคอลัมน์หนึ่งเท่านั้น (รับ > 0 xor จ่าย > 0) ถ้ามีทั้งคู่พร้อมกันหรือไม่มีเลยทั้งคู่ แถวนั้น
 * จะถูกข้าม (ดู extractTypeAndAmount)
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

// เดบิต/debit/dr อยู่ฝั่ง "รับ" เพราะไฟล์นี้คือ GL ของบัญชีธนาคาร (บัญชีสินทรัพย์) — เดบิตคือเงินเข้าบัญชี
// เสมอตามหลักบัญชีคู่มาตรฐาน (ยืนยันจากข้อมูลจริง: แถวรายได้ทุกแถวมีค่าอยู่ในคอลัมน์เดบิต)
const RECEIVE_ALIASES = [
  'รับ',
  'เงินรับ',
  'เงินเข้า',
  'ฝาก',
  'ยอดรับ',
  'เดบิต',
  'receive',
  'deposit',
  'depositamount',
  'debit',
  'dr',
].map(normalizeHeader);

// เครดิต/credit/cr อยู่ฝั่ง "จ่าย" ด้วยเหตุผลเดียวกัน (เครดิต = เงินออกจากบัญชีธนาคาร)
const PAYMENT_ALIASES = [
  'จ่าย',
  'เงินจ่าย',
  'เงินออก',
  'ถอน',
  'ยอดจ่าย',
  'เครดิต',
  'payment',
  'withdraw',
  'withdrawal',
  'withdrawalamount',
  'credit',
  'cr',
].map(normalizeHeader);

const DOC_NO_ALIASES = [
  'เลขที่เอกสาร',
  'เลขเอกสาร',
  'เลขที่บิล',
  'เลขที่อ้างอิง',
  'ใบสำคัญ',
  'documentno',
  'docno',
  'voucherno',
  'refno',
  'referenceno',
].map(normalizeHeader);

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

/** วันที่ ISO ที่ parseExcelDateCell คืนมาอาจเป็นปี พ.ศ. (ถ้าไฟล์ต้นฉบับเขียนปี พ.ศ. มาเป็นข้อความ เช่น
 * "01/06/2569") — ปี ค.ศ. ของข้อมูลบัญชีจริงไม่มีทางถึง 2400 และปี พ.ศ. ของข้อมูลยุคปัจจุบันก็อยู่แถว
 * 2560-2570 เสมอ ต่างกันมากพอที่จะใช้เกณฑ์ >= 2400 แยกสองกรณีได้อย่างปลอดภัย ไม่กระทบวันที่จาก Excel
 * serial/Date object ที่เป็นปี ค.ศ. อยู่แล้วเสมอ (เงื่อนไขจะไม่ถูกกระตุ้นเลยเพราะปีน้อยกว่า 2400 อยู่แล้ว) */
function parseDateCellWithEraConversion(value: unknown): string | null {
  const iso = parseExcelDateCell(value);
  if (!iso) return null;
  const [yStr, m, d] = iso.split('-');
  const year = Number(yStr);
  if (year >= 2400) {
    return `${year - 543}-${m}-${d}`;
  }
  return iso;
}

function isRowBlank(row: unknown[]): boolean {
  return row.every((v) => v === null || v === undefined || String(v).trim() === '');
}

/** แปลงค่าดิบ 3 ช่อง (วันที่/รับ/จ่าย) ของ 1 แถว ให้เป็น {date, type, amount} — เป็น core logic ที่ใช้ร่วม
 * กันทั้งเส้นทาง Excel/CSV (ตาราง 2 มิติ) และ PDF (ตำแหน่งข้อความ) เพื่อไม่ให้กติกาการตรวจสอบแถว (ข้าม
 * แถวว่าง/ข้ามแถวที่มีทั้งรับ-จ่าย/แปลงปี พ.ศ.) ต่างกันระหว่างสองเส้นทางโดยไม่ตั้งใจ */
function buildTransaction(
  dateRaw: unknown,
  receiveRaw: unknown,
  paymentRaw: unknown,
  rowLabel: string,
  warnings: string[]
): { date: string; type: TransactionType; amount: number } | null {
  const dateIso = parseDateCellWithEraConversion(dateRaw);
  if (!dateIso) {
    warnings.push(`${rowLabel}: วันที่ไม่ถูกต้องหรือไม่ได้กรอก ข้ามแถวนี้`);
    return null;
  }
  const receiveAmount = cellToAmount(receiveRaw);
  const paymentAmount = cellToAmount(paymentRaw);
  const hasReceive = receiveAmount !== null && receiveAmount > 0;
  const hasPayment = paymentAmount !== null && paymentAmount > 0;

  if (hasReceive && hasPayment) {
    warnings.push(`${rowLabel}: มีค่าทั้งในคอลัมน์รับและจ่ายพร้อมกัน ข้ามแถวนี้ (ระบุประเภทไม่ได้ชัดเจน)`);
    return null;
  }
  if (!hasReceive && !hasPayment) {
    return null; // แถวไม่มีทั้งรับและจ่าย ข้ามแบบเงียบๆ (มักเป็นแถวยอดยกมา/แถวรวม/แถวหมายเหตุท้ายรายงาน)
  }
  return hasReceive
    ? { date: dateIso, type: 'receive', amount: round2(receiveAmount!) }
    : { date: dateIso, type: 'payment', amount: round2(paymentAmount!) };
}

// ---------- Table-based (Excel / CSV) parsing: header row position is NOT assumed to be row 1 ----------

interface DetectedTableColumns {
  headerRowIndex: number;
  dateIdx: number;
  receiveIdx: number;
  paymentIdx: number;
  docNoIdx: number | null;
}

/** สแกนหาแถวหัวตารางจริงในช่วง 20 แถวแรกของไฟล์ — รายงานจากโปรแกรมบัญชีมักมีแถวชื่อบริษัท/หัวรายงาน/
 * ช่วงวันที่ก่อนแถวหัวคอลัมน์จริงหลายแถว จึง "ไม่ควรสมมติว่าแถวแรกคือหัวคอลัมน์เสมอ" (บทเรียนจากไฟล์ GL
 * จริงของผู้ใช้ 2026-07-17) ต้องเจอคอลัมน์ที่จำเป็นครบทุกคอลัมน์ในแถวเดียวกันถึงจะถือว่าเป็นแถวหัวตาราง */
function detectHeaderRow(rows: unknown[][], includeDocNo: boolean): { columns: DetectedTableColumns | null; error: string | null } {
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] ?? [];
    const normalized = row.map((c) => normalizeHeader(c === null || c === undefined ? '' : String(c)));
    const dateIdx = normalized.findIndex((h) => DATE_ALIASES.includes(h));
    const receiveIdx = normalized.findIndex((h) => RECEIVE_ALIASES.includes(h));
    const paymentIdx = normalized.findIndex((h) => PAYMENT_ALIASES.includes(h));
    const docNoIdx = normalized.findIndex((h) => DOC_NO_ALIASES.includes(h));
    const requiredFound = dateIdx !== -1 && receiveIdx !== -1 && paymentIdx !== -1 && (!includeDocNo || docNoIdx !== -1);
    if (requiredFound) {
      return { columns: { headerRowIndex: i, dateIdx, receiveIdx, paymentIdx, docNoIdx: includeDocNo ? docNoIdx : null }, error: null };
    }
  }
  const missing = ['วันที่ (Date)', 'รับ (Receive)', 'จ่าย (Payment)', ...(includeDocNo ? ['เลขที่เอกสาร (Document No.)'] : [])];
  return {
    columns: null,
    error: `ไม่พบแถวหัวตารางที่มีคอลัมน์ครบ: ${missing.join(', ')} ในช่วง ${scanLimit} แถวแรกของไฟล์ — กรุณาตรวจสอบหัวคอลัมน์ในไฟล์ต้นฉบับ`,
  };
}

export function parseBankRows(rows: unknown[][]): ParsedTransactionFile<BankTransaction> {
  const { columns, error } = detectHeaderRow(rows, false);
  if (!columns) return { rows: [], errors: [error!], warnings: [] };

  const result: BankTransaction[] = [];
  const warnings: string[] = [];
  for (let i = columns.headerRowIndex + 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    if (isRowBlank(raw)) continue;
    const tx = buildTransaction(raw[columns.dateIdx], raw[columns.receiveIdx], raw[columns.paymentIdx], `แถวที่ ${i + 1}`, warnings);
    if (!tx) continue;
    result.push({ id: `bank-${i}`, date: tx.date, type: tx.type, amount: tx.amount });
  }
  return { rows: result, errors: [], warnings };
}

export function parseGLRows(rows: unknown[][]): ParsedTransactionFile<GLTransaction> {
  const { columns, error } = detectHeaderRow(rows, true);
  if (!columns) return { rows: [], errors: [error!], warnings: [] };

  const result: GLTransaction[] = [];
  const warnings: string[] = [];
  for (let i = columns.headerRowIndex + 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    if (isRowBlank(raw)) continue;
    const tx = buildTransaction(raw[columns.dateIdx], raw[columns.receiveIdx], raw[columns.paymentIdx], `แถวที่ ${i + 1}`, warnings);
    if (!tx) continue;
    const documentNo = columns.docNoIdx !== null ? String(raw[columns.docNoIdx] ?? '').trim() : '';
    result.push({ id: `gl-${i}`, documentNo, date: tx.date, type: tx.type, amount: tx.amount });
  }
  return { rows: result, errors: [], warnings };
}

// ---------- File reading dispatch (Excel / CSV / PDF) ----------

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** decode CSV เป็นข้อความ — ลอง UTF-8 แบบเข้มงวดก่อน (fatal: true = throw ถ้าเจอ byte sequence ที่ไม่ใช่
 * UTF-8 ที่ถูกต้อง) ถ้าไม่ผ่านค่อย fallback ไปใช้ Windows-874 (=TIS-620) ซึ่งเป็น encoding ที่โปรแกรมบัญชี
 * ไทยจำนวนมากยังใช้ส่งออกไฟล์ CSV อยู่ (ยืนยันจากไฟล์ GL จริงของผู้ใช้ 2026-07-17) — ทำอัตโนมัติ ผู้ใช้ไม่
 * ต้องเลือก encoding เอง */
function decodeCsvBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-874').decode(buffer);
  }
}

/** อ่านไฟล์ Excel/CSV เป็น array-of-arrays ดิบๆ (แถวแรกไม่ถูกตีความเป็น header อัตโนมัติ) เพราะตำแหน่งแถว
 * หัวตารางจริงไม่รู้ล่วงหน้า (ดูคอมเมนต์ detectHeaderRow) — ใช้ XLSX.read ตัวเดียวกันทั้ง Excel และ CSV
 * (CSV ผ่าน type:'string' หลัง decode ด้วย decodeCsvBuffer, Excel ผ่าน type:'array' ตรงๆ) */
function readRowsAsTable(buffer: ArrayBuffer, ext: string): unknown[][] {
  const workbook =
    ext === 'csv' ? XLSX.read(decodeCsvBuffer(buffer), { type: 'string', raw: true }) : XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
}

const FILE_READ_ERROR = 'อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์ไม่เสียหาย และเป็นไฟล์ประเภท .xlsx, .xls, .csv หรือ .pdf';

export async function parseBankFile(file: File): Promise<ParsedTransactionFile<BankTransaction>> {
  try {
    const ext = getExtension(file.name);
    const buffer = await file.arrayBuffer();
    if (ext === 'pdf') return parseBankRowsFromPdf(buffer);
    return parseBankRows(readRowsAsTable(buffer, ext));
  } catch (err) {
    return { rows: [], errors: [err instanceof Error && err.message ? err.message : FILE_READ_ERROR], warnings: [] };
  }
}

export async function parseGLFile(file: File): Promise<ParsedTransactionFile<GLTransaction>> {
  try {
    const ext = getExtension(file.name);
    const buffer = await file.arrayBuffer();
    if (ext === 'pdf') return parseGLRowsFromPdf(buffer);
    return parseGLRows(readRowsAsTable(buffer, ext));
  } catch (err) {
    return { rows: [], errors: [err instanceof Error && err.message ? err.message : FILE_READ_ERROR], warnings: [] };
  }
}

// ---------- PDF: best-effort text-position table extraction ----------
//
// PDF ไม่มีโครงสร้างตาราง/คอลัมน์จริงให้อ่านเหมือน Excel/CSV — มีแค่ "ข้อความ + ตำแหน่ง x/y" ของตัวอักษร
// แต่ละกลุ่มบนหน้ากระดาษเท่านั้น วิธีด้านล่างนี้เป็น heuristic แบบ best-effort: จัดกลุ่มข้อความที่อยู่
// แนวเดียวกัน (y ใกล้เคียงกัน) ให้เป็น "บรรทัด" เรียงจากบนลงล่าง แล้วหาบรรทัดที่น่าจะเป็น "หัวตาราง" (มีคำ
// ที่ตรงกับ alias ของคอลัมน์ที่ต้องใช้ครบ) ใช้ตำแหน่ง x ของหัวคอลัมน์เหล่านั้นแบ่งข้อความในบรรทัดถัดๆ ไป
// เข้าคอลัมน์ที่ใกล้ที่สุด แล้วส่งต่อให้ buildTransaction (core logic เดียวกับเส้นทาง Excel/CSV) แปลงผล
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

interface PdfHeaderMatch {
  lineIndex: number;
  dateX: number;
  receiveX: number;
  paymentX: number;
  docNoX: number | null;
}

function findHeaderLine(lines: TextItemPos[][], includeDocNo: boolean): PdfHeaderMatch | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalized = line.map((it) => normalizeHeader(it.text));
    const dateIdx = normalized.findIndex((t) => DATE_ALIASES.includes(t));
    const receiveIdx = normalized.findIndex((t) => RECEIVE_ALIASES.includes(t));
    const paymentIdx = normalized.findIndex((t) => PAYMENT_ALIASES.includes(t));
    const docNoIdx = normalized.findIndex((t) => DOC_NO_ALIASES.includes(t));
    if (dateIdx !== -1 && receiveIdx !== -1 && paymentIdx !== -1 && (!includeDocNo || docNoIdx !== -1)) {
      return {
        lineIndex: i,
        dateX: line[dateIdx].x,
        receiveX: line[receiveIdx].x,
        paymentX: line[paymentIdx].x,
        docNoX: includeDocNo ? line[docNoIdx].x : null,
      };
    }
  }
  return null;
}

/** รวมข้อความทุกชิ้นในบรรทัดที่อยู่ใกล้ตำแหน่ง x เป้าหมายที่สุด (ใกล้กว่าตำแหน่ง x เป้าหมายอื่นๆ ที่ระบุมา
 * ทั้งหมด) — ใช้แยกว่าข้อความชิ้นไหนควรเป็นค่าของคอลัมน์ไหนในบรรทัดข้อมูล 1 บรรทัด */
function nearestColumnText(line: TextItemPos[], targetX: number, otherTargets: number[]): string {
  const parts: string[] = [];
  for (const item of line) {
    const distToTarget = Math.abs(item.x - targetX);
    const isClosestToTarget = otherTargets.every((other) => Math.abs(item.x - other) >= distToTarget);
    if (isClosestToTarget) parts.push(item.text);
  }
  return parts.join(' ');
}

async function parseRowsFromPdf(buffer: ArrayBuffer, includeDocNo: boolean): Promise<{ rows: Array<{ date: string; type: TransactionType; amount: number; documentNo: string }>; warnings: string[] }> {
  const pages = await extractTextItemsByPage(buffer);
  const results: Array<{ date: string; type: TransactionType; amount: number; documentNo: string }> = [];
  const warnings: string[] = [];
  let anyHeaderFound = false;

  pages.forEach((pageItems, pageIdx) => {
    if (pageItems.length === 0) return;
    const lines = groupIntoLines(pageItems);
    const header = findHeaderLine(lines, includeDocNo);
    if (!header) return; // หน้านี้ไม่พบบรรทัดหัวตาราง (อาจเป็นหน้าปก/หน้าสรุป) ข้ามไปหน้าอื่น
    anyHeaderFound = true;
    const targets = [header.dateX, header.receiveX, header.paymentX, ...(header.docNoX !== null ? [header.docNoX] : [])];

    for (let i = header.lineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      const dateText = nearestColumnText(line, header.dateX, targets.filter((t) => t !== header.dateX));
      const receiveText = nearestColumnText(line, header.receiveX, targets.filter((t) => t !== header.receiveX));
      const paymentText = nearestColumnText(line, header.paymentX, targets.filter((t) => t !== header.paymentX));
      const docNoText = header.docNoX !== null ? nearestColumnText(line, header.docNoX, targets.filter((t) => t !== header.docNoX)) : '';
      const tx = buildTransaction(dateText, receiveText, paymentText, `หน้า ${pageIdx + 1} แถวที่ ${i + 1}`, warnings);
      if (!tx) continue;
      results.push({ ...tx, documentNo: docNoText.trim() });
    }
  });

  if (!anyHeaderFound) {
    throw new Error(
      'ไม่สามารถอ่านโครงสร้างตารางจากไฟล์ PDF นี้ได้ (อาจเป็น PDF ที่สแกนเป็นรูปภาพ หรือไม่พบหัวคอลัมน์ วันที่/รับ/จ่าย) กรุณาใช้ไฟล์ Excel หรือ CSV แทน'
    );
  }
  return { rows: results, warnings };
}

async function parseBankRowsFromPdf(buffer: ArrayBuffer): Promise<ParsedTransactionFile<BankTransaction>> {
  const { rows, warnings } = await parseRowsFromPdf(buffer, false);
  return { rows: rows.map((r, idx) => ({ id: `bank-pdf-${idx}`, date: r.date, type: r.type, amount: r.amount })), errors: [], warnings };
}

async function parseGLRowsFromPdf(buffer: ArrayBuffer): Promise<ParsedTransactionFile<GLTransaction>> {
  const { rows, warnings } = await parseRowsFromPdf(buffer, true);
  return {
    rows: rows.map((r, idx) => ({ id: `gl-pdf-${idx}`, documentNo: r.documentNo, date: r.date, type: r.type, amount: r.amount })),
    errors: [],
    warnings,
  };
}
