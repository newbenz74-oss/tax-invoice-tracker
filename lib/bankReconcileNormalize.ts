import type { BankColumnMapping, BankRow, GLColumnMapping, GLRow, RawFileTable, TransactionDirection } from '@/types/bankReconcile';

/**
 * การแปลงข้อมูลดิบ (RawFileTable + ColumnMapping) ให้เป็น BankRow[]/GLRow[] ที่ normalize แล้ว — เขียนใหม่ทั้ง
 * ไฟล์ 2026-07-17 สำหรับ Bank Reconcile เวอร์ชันใหม่ (จับคู่ด้วยทิศทาง+จำนวนเงินเท่านั้น) แทนที่ไฟล์เดิมที่ผลิต
 * NormalizedBankRow/NormalizedGLRow (มี moneyIn/moneyOut แยกแกนเป็นตัวเลขบวกทั้งคู่ ไม่มี "ทิศทาง" ชัดเจน)
 *
 * หัวใจของไฟล์นี้คือ resolveDirectionAndAmount() — ใช้ตัวเดียวกันทั้ง Bank และ GL เพราะทั้งสองฝั่งมีโครงสร้าง
 * การจับคู่คอลัมน์เหมือนกันเป๊ะหลัง mapping แล้ว (ผู้ใช้ระบุเองว่าคอลัมน์ไหนคือ "ฝั่งรับเงิน" คอลัมน์ไหนคือ
 * "ฝั่งจ่ายเงิน" — ดูคอมเมนต์ที่ GLColumnKey ใน types/bankReconcile.ts) ระบบไม่ต้องรู้/ไม่ต้องเดาความหมายทาง
 * บัญชีของ debit/credit เลยแม้แต่น้อย
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * แปลงค่าจากเซลล์วันที่อย่างปลอดภัย ("Parse dates safely" ตามสเปก) — ไม่มีทางคืน "Invalid Date" ออกไปได้เลย
 * คืน null เสมอถ้าแปลงไม่ได้ รองรับ: Date object, เลข serial ของ Excel, string แบบ ISO YYYY-MM-DD, DD/MM/YYYY,
 * DD-MM-YYYY — สเปกฉบับ rebuild นี้ไม่ได้ขอให้แปลงปีพุทธศักราชอัตโนมัติ (ต่างจากสเปก PDF-only รอบก่อนหน้าที่ถูก
 * ยกเลิกไปแล้ว) จึงไม่ทำ เพื่อไม่ให้เดาข้อมูลผิดแบบเงียบๆ เกินขอบเขตที่ขอจริง
 */
export function parseDateCell(value: unknown): string | null {
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
    if (!trimmed || trimmed === '-') return null;

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, y, mo, d] = isoMatch;
      return isRealDate(Number(y), Number(mo), Number(d)) ? trimmed : null;
    }

    const dmySlash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmySlash) {
      const [, d, mo, y] = dmySlash;
      if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const dmyDash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyDash) {
      const [, d, mo, y] = dmyDash;
      if (!isRealDate(Number(y), Number(mo), Number(d))) return null;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    return null;
  }
  return null;
}

/**
 * แปลงค่าจากเซลล์จำนวนเงินเป็น "ขนาด" (magnitude) ที่ไม่ติดลบเสมอ ตามกฎ normalize ของสเปกส่วน "11. DATA
 * NORMALIZATION" ครบทุกข้อ: ตัด comma คั่นหลักพันออก, trim ช่องว่าง, ตัดสัญลักษณ์สกุลเงินออก (฿, $, บาท),
 * ค่าว่าง = 0, เครื่องหมาย "-" เดี่ยวๆ = 0, วงเล็บถือเป็นค่าติดลบได้ (เช่น "(1,234.56)") — แต่เนื่องจากฟังก์ชัน
 * นี้คืนค่า "ขนาด" เสมอ (ไม่ใช่ค่าที่มีเครื่องหมาย) เครื่องหมายลบ/วงเล็บจึงแค่ถูกตัดทิ้งหลังตรวจพบ ไม่ทำให้ผลลัพธ์
 * ติดลบ — ทิศทางธุรกรรม (รับเงิน/จ่ายเงิน) มาจาก "คอลัมน์ไหนที่มีค่า" ไม่ใช่จากเครื่องหมายในเซลล์ (ดู
 * resolveDirectionAndAmount ด้านล่าง) ห้ามคืนค่า NaN เด็ดขาด (Prevent NaN) ปัดเป็นทศนิยม 2 ตำแหน่งเสมอ
 */
export function parseAmountMagnitude(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? round2(Math.abs(value)) : 0;

  let raw = String(value).trim();
  if (raw === '' || raw === '-') return 0;

  // วงเล็บ = ค่าติดลบตามธรรมเนียมบัญชี — ถอดวงเล็บออกก่อน (ผลลัพธ์เป็นขนาดอยู่แล้วจึงไม่ต้องใส่เครื่องหมายลบคืน)
  const parenMatch = raw.match(/^\((.*)\)$/);
  if (parenMatch) raw = parenMatch[1].trim();

  // ตัดสัญลักษณ์สกุลเงินที่พบได้บ่อย + comma + ช่องว่างภายในตัวเลข (เช่น "฿ 1,234.56", "1 234.56")
  const cleaned = raw
    .replace(/[฿$]/g, '')
    .replace(/บาท/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return 0;

  // ต้องเป็นตัวเลขล้วนๆ ทั้งสตริง (รองรับเครื่องหมายลบนำหน้าที่อาจเหลืออยู่) กัน parseFloat("12abc") หลุดมาเป็น 12
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return 0;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? round2(Math.abs(parsed)) : 0;
}

/** แปลงค่าจากเซลล์ข้อความอย่างปลอดภัย (รายละเอียด/เลขที่เอกสาร/เลขที่บัญชี/รหัสบัญชี) */
function cellToDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('th-TH');
  return String(value).trim();
}

function isCellBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** แถวว่างทั้งแถว (ทุกเซลล์ว่างเปล่า) — ต้องข้ามไปเสมอตามสเปก "Ignore blank rows" ไม่สร้าง BankRow/GLRow ให้เลย
 * (ต่างจากแถวที่มีข้อมูลบางส่วนแต่หาทิศทางไม่ได้ ซึ่งจะกลายเป็นแถว status=invalid ให้ผู้ใช้เห็นและแก้ไข/ยกเว้นเอง) */
export function isRowBlank(row: unknown[]): boolean {
  return row.every(isCellBlank);
}

function mappedCell(row: unknown[], columnIndex: number | null): unknown {
  return columnIndex === null || columnIndex === undefined ? undefined : row[columnIndex];
}

export interface ResolvedDirection {
  direction: TransactionDirection | null;
  amount: number;
  moneyIn: number;
  moneyOut: number;
  errors: string[];
}

/**
 * หัวใจของการ normalize ทั้งไฟล์ — ใช้ร่วมกันทั้ง Bank (เงินเข้า/เงินออก) และ GL (ฝั่งรับเงิน/ฝั่งจ่ายเงิน) เพราะ
 * เป็นแนวคิดเดียวกันเป๊ะหลัง column mapping แล้ว: มีคอลัมน์ "moneyIn" (รับเงิน) กับคอลัมน์ "moneyOut" (จ่ายเงิน)
 * ให้ผู้ใช้จับคู่เอง — ทิศทางมาจาก "คอลัมน์ไหนมีค่าไม่เป็นศูนย์" ไม่ใช่จากเครื่องหมายในเซลล์ (amount ที่ parse
 * ได้เป็นขนาดที่ไม่ติดลบอยู่แล้วเสมอจาก parseAmountMagnitude) ตามตัวอย่างสเปกเป๊ะ: "-5,000.00 payment" ต้อง
 * กลายเป็น direction=payment, amount=5,000.00 — ในระบบนี้ค่า -5,000.00 ที่อยู่ในคอลัมน์ "เงินออก"/"ฝั่งจ่ายเงิน"
 * จะให้ผลเดียวกันเป๊ะกับค่า 5,000.00 ธรรมดา (เพราะ parseAmountMagnitude ตัดเครื่องหมายทิ้งเป็นขนาดอยู่แล้ว)
 *
 * เงื่อนไข error สองแบบ (ตามสเปกส่วน "5. MATCHING RULE" ที่บอกว่าแต่ละแถวต้องมีทิศทางชัดเจนหนึ่งเดียว):
 *   - ทั้งสองคอลัมน์มีค่า (>0) พร้อมกัน → หาทิศทางเดียวไม่ได้ → error ต้องให้ผู้ใช้แก้ไขเอง
 *   - ทั้งสองคอลัมน์เป็น 0 พร้อมกัน (แต่แถวไม่ได้ว่างทั้งแถว — ถ้าว่างทั้งแถวจะถูกข้ามไปตั้งแต่ isRowBlank แล้ว)
 *     → ไม่มีจำนวนเงินให้กระทบยอดเลย → error เช่นกัน
 */
export function resolveDirectionAndAmount(moneyInRaw: unknown, moneyOutRaw: unknown): ResolvedDirection {
  const moneyIn = parseAmountMagnitude(moneyInRaw);
  const moneyOut = parseAmountMagnitude(moneyOutRaw);

  if (moneyIn > 0 && moneyOut > 0) {
    return { direction: null, amount: 0, moneyIn, moneyOut, errors: ['พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ'] };
  }
  if (moneyIn > 0) {
    return { direction: 'income', amount: moneyIn, moneyIn, moneyOut, errors: [] };
  }
  if (moneyOut > 0) {
    return { direction: 'payment', amount: moneyOut, moneyIn, moneyOut, errors: [] };
  }
  return { direction: null, amount: 0, moneyIn, moneyOut, errors: ['ไม่พบจำนวนเงินเข้าหรือเงินออกในแถวนี้'] };
}

/** แปลงตาราง Bank Statement ดิบทั้งตารางเป็น BankRow[] ตาม mapping ที่ผู้ใช้เลือกไว้ — ข้ามแถวว่างทั้งแถวไป
 * อัตโนมัติ เลขแถว (rowNumber) อ้างอิงตำแหน่งจริงในไฟล์ต้นฉบับเสมอ (แถว 1 = header) */
export function buildBankRows(table: RawFileTable, mapping: BankColumnMapping): BankRow[] {
  const result: BankRow[] = [];
  table.rows.forEach((row, idx) => {
    if (isRowBlank(row)) return;

    const moneyInCell = mappedCell(row, mapping.moneyIn);
    const moneyOutCell = mappedCell(row, mapping.moneyOut);
    const {
      direction,
      amount,
      moneyIn: moneyInRaw,
      moneyOut: moneyOutRaw,
      errors: directionErrors,
    } = resolveDirectionAndAmount(moneyInCell, moneyOutCell);

    const dateRaw = mappedCell(row, mapping.transactionDate);
    const date = parseDateCell(dateRaw);

    result.push({
      id: `bank-${idx + 2}`,
      rowNumber: idx + 2,
      date,
      description: cellToDisplayString(mappedCell(row, mapping.description)),
      moneyInRaw,
      moneyOutRaw,
      direction,
      amount,
      balance: mapping.balance === null ? null : parseAmountMagnitude(mappedCell(row, mapping.balance)),
      accountNo: cellToDisplayString(mappedCell(row, mapping.accountNo)),
      rawRow: row,
      excluded: false,
      // หมายเหตุ: ไม่ตรวจสอบรูปแบบวันที่เป็นเงื่อนไขบล็อก isRowUsable ตามสเปกส่วน "8. DATE DISPLAY" ที่ระบุ
      // ตรงๆ ว่า "dates are not required for matching" — วันที่ที่แปลงไม่ได้จะแสดงเป็น "-" เฉยๆ ในตาราง ไม่ถือ
      // เป็นข้อผิดพลาดที่ต้องแก้ก่อนกระทบยอด (ต่างจากทิศทาง/จำนวนเงินที่จำเป็นต่อการจับคู่โดยตรง)
      errors: [...directionErrors],
    });
  });
  return result;
}

/** แปลงตาราง GL ดิบทั้งตารางเป็น GLRow[] ตาม mapping ที่ผู้ใช้เลือกไว้ — โครงสร้างขนานกับ buildBankRows ทุก
 * ประการ ต่างแค่ docNo/accountCode แทน balance/accountNo */
export function buildGLRows(table: RawFileTable, mapping: GLColumnMapping): GLRow[] {
  const result: GLRow[] = [];
  table.rows.forEach((row, idx) => {
    if (isRowBlank(row)) return;

    const moneyInCell = mappedCell(row, mapping.moneyIn);
    const moneyOutCell = mappedCell(row, mapping.moneyOut);
    const {
      direction,
      amount,
      moneyIn: moneyInRaw,
      moneyOut: moneyOutRaw,
      errors: directionErrors,
    } = resolveDirectionAndAmount(moneyInCell, moneyOutCell);

    const dateRaw = mappedCell(row, mapping.date);
    const date = parseDateCell(dateRaw);

    result.push({
      id: `gl-${idx + 2}`,
      rowNumber: idx + 2,
      date,
      description: cellToDisplayString(mappedCell(row, mapping.description)),
      moneyInRaw,
      moneyOutRaw,
      direction,
      amount,
      docNo: cellToDisplayString(mappedCell(row, mapping.docNo)),
      accountCode: cellToDisplayString(mappedCell(row, mapping.accountCode)),
      rawRow: row,
      excluded: false,
      errors: [...directionErrors], // ดูหมายเหตุเดียวกับ buildBankRows ด้านบน — วันที่ไม่บล็อกความ "ใช้งานได้" ของแถว
    });
  });
  return result;
}
