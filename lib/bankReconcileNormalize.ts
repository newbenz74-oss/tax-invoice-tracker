import type {
  BankColumnMapping,
  GLColumnMapping,
  NormalizedBankRow,
  NormalizedGLRow,
  RawFileTable,
} from '@/types/bankReconcile';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** แปลงเลข serial ของ Excel ให้เป็น Date — วันที่ 0 ของ Excel คือ 1899-12-30 (สูตรเดียวกับ
 * lib/excelImport.ts excelSerialToDate — คัดลอกมาเป็นฟังก์ชัน private ของไฟล์นี้เองตามธรรมเนียมเดิมของ
 * โปรเจกต์ที่ไม่ export helper ระดับเซลล์แบบนี้ข้ามไฟล์ เช่น round2 ที่มีสำเนาแยกอยู่หลายไฟล์แล้ว) */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ตรวจสอบว่า ปี/เดือน/วัน ที่ให้มาเป็นวันที่จริงที่มีอยู่จริง (เช่น เดือน 13 หรือวันที่ 30 กุมภาพันธ์ ไม่ผ่าน) */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * แปลงค่าจากเซลล์วันที่อย่างปลอดภัย ("Parse dates safely" + "Prevent NaN" ตามสเปก) — ไม่มีทางคืนค่าที่
 * เป็น "Invalid Date" ออกไปได้เลย คืน null เสมอถ้าแปลงไม่ได้ (ให้ UI แสดง "-" แทน)
 * รองรับ: Date object (ไฟล์ .xlsx/.xls ที่มีเซลล์รูปแบบวันที่จริง อ่านผ่าน cellDates:true),
 * เลข serial ของ Excel, string แบบ ISO YYYY-MM-DD, DD/MM/YYYY และ DD-MM-YYYY (ไฟล์ธนาคาร/CSV จริงมักใช้
 * เครื่องหมาย "-" คั่นวันที่แทน "/" จึงรองรับเพิ่มจาก lib/excelImport.ts ซึ่งรองรับเฉพาะ "/")
 * ตั้งใจไม่เดาปีพุทธศักราช (พ.ศ.) โดยอัตโนมัติ เพราะไฟล์ต้นทางไม่ได้ระบุมาตรงๆ ว่าใช้ปีแบบไหน การเดาผิด
 * จะทำให้ข้อมูลผิดเพี้ยนแบบเงียบๆ ซึ่งขัดกับหลักการของฟีเจอร์นี้โดยตรง — ถ้าปีดูไม่สมเหตุสมผล (เช่น
 * มากกว่า 2500 แต่ isRealDate ผ่าน) ก็ยังคงแปลงตามที่ระบุไว้ในไฟล์ตรงๆ ไม่ปรับแก้เอง
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
 * แปลงค่าจากเซลล์ตัวเลขอย่างปลอดภัยตามกฎ normalize ที่ระบุไว้เป๊ะ: ตัด comma คั่นหลักพันออก, trim ช่องว่าง,
 * ค่าว่าง = 0, เครื่องหมาย "-" = 0, ห้ามคืนค่า NaN เด็ดขาด (ถ้าอ่านเป็นตัวเลขไม่ได้เลยจะ fallback เป็น 0
 * แทนการปล่อยให้ NaN หลุดออกไป — ตรงตามสเปก "Prevent NaN" ตรงตัว ต่างจาก parseVatCell ใน
 * lib/excelImport.ts ที่คืนสถานะ "invalid" แยกไว้ เพราะที่นั่น VAT เป็นฟิลด์ที่ใช้ตัดสิน tax_type ทันที
 * ส่วนที่นี่เป็นแค่ตัวเลขพรีวิวเตรียมข้อมูลก่อนกระทบยอด (เฟส 1 ยังไม่มีการใช้ตัดสินใจอะไรเลย) จึง fallback
 * เป็น 0 ได้อย่างปลอดภัยตามที่สเปกระบุไว้ตรงๆ)
 */
export function parseAmountCell(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const raw = String(value).trim();
  if (raw === '' || raw === '-') return 0;

  const cleaned = raw.replace(/,/g, '');
  // ต้องเป็นตัวเลขล้วนๆ ทั้งสตริง (รองรับเครื่องหมายลบนำหน้า) — กัน parseFloat("12abc") หลุดมาเป็น 12
  // แบบเงียบๆ เหมือนธรรมเนียมเดิมของ parseVatCell ใน lib/excelImport.ts
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return 0;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** แปลงค่าจากเซลล์ข้อความอย่างปลอดภัย (รายละเอียด/เลขที่เอกสาร) — ใช้แสดงผลเฉยๆ ไม่มีผลต่อการคำนวณ */
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

/** แถวว่างทั้งแถว (ทุกเซลล์ว่างเปล่า) — ต้องข้ามไปตามสเปก "Ignore fully blank rows" ใช้ทั้งใน
 * lib/bankReconcileValidation.ts (นับจำนวนแถวข้อมูลจริง) และในการ normalize ด้านล่างนี้ */
export function isRowBlank(row: unknown[]): boolean {
  return row.every(isCellBlank);
}

function mappedCell(row: unknown[], columnIndex: number | null): unknown {
  return columnIndex === null || columnIndex === undefined ? undefined : row[columnIndex];
}

/**
 * แปลงแถวดิบของ Bank Statement (ตามคอลัมน์ที่ผู้ใช้จับคู่ไว้) ให้เป็นแถวที่ normalize แล้ว — ข้ามแถวว่าง
 * ทั้งแถวไปอัตโนมัติ เลขแถว (rowNumber) อ้างอิงตำแหน่งจริงในไฟล์ต้นฉบับเสมอ (แถว 1 = header จึงแถวข้อมูล
 * แถวแรก = แถวที่ 2 ตามธรรมเนียมเดิมของ lib/excelImport.ts)
 *
 * Sign convention: เงินเข้า = บวก, เงินออก = ลบ (ตามสเปกตรงๆ) signedAmount = moneyIn - moneyOut
 */
export function normalizeBankRows(table: RawFileTable, mapping: BankColumnMapping): NormalizedBankRow[] {
  const result: NormalizedBankRow[] = [];
  table.rows.forEach((row, idx) => {
    if (isRowBlank(row)) return;
    const moneyIn = parseAmountCell(mappedCell(row, mapping.moneyIn));
    const moneyOut = parseAmountCell(mappedCell(row, mapping.moneyOut));
    result.push({
      rowNumber: idx + 2,
      transactionDate: parseDateCell(mappedCell(row, mapping.transactionDate)),
      description: cellToDisplayString(mappedCell(row, mapping.description)),
      moneyIn,
      moneyOut,
      balance: parseAmountCell(mappedCell(row, mapping.balance)),
      signedAmount: round2(moneyIn - moneyOut),
    });
  });
  return result;
}

/**
 * แปลงแถวดิบของ GL จากระบบ Express ให้เป็นแถวที่ normalize แล้ว — ข้ามแถวว่างทั้งแถวไปอัตโนมัติเหมือนกัน
 *
 * Sign convention (สำคัญ — จุดที่พลาดง่ายที่สุดของการกระทบยอดธนาคาร): บัญชีเงินสด/ธนาคารในทางบัญชีเป็น
 * บัญชีสินทรัพย์ (Asset) เดบิต (Debit) ทำให้ยอดเพิ่มขึ้น = เงินเข้า เครดิต (Credit) ทำให้ยอดลดลง = เงินออก
 * จึงต้องแปลง debit/credit ให้อยู่ใน sign convention เดียวกับ Bank Statement (เงินเข้า=บวก, เงินออก=ลบ)
 * ด้วยสูตร signedAmount = debit - credit เท่านั้น (ห้ามกลับด้าน) — นี่คือบั๊กที่เคยพบและแก้มาแล้วจริงใน
 * เครื่องมือกระทบยอดธนาคารรุ่นก่อนหน้า (ดู claude/bank-reconciliation-tool.md) นำ domain knowledge นี้มา
 * ใช้ตั้งแต่ต้นในเฟสนี้เลยเพื่อไม่ให้ต้องแก้บั๊กเดิมซ้ำอีกครั้งตอนสร้างขั้นตอนจับคู่รายการในเฟสถัดไป
 */
export function normalizeGLRows(table: RawFileTable, mapping: GLColumnMapping): NormalizedGLRow[] {
  const result: NormalizedGLRow[] = [];
  table.rows.forEach((row, idx) => {
    if (isRowBlank(row)) return;
    const debit = parseAmountCell(mappedCell(row, mapping.debit));
    const credit = parseAmountCell(mappedCell(row, mapping.credit));
    result.push({
      rowNumber: idx + 2,
      date: parseDateCell(mappedCell(row, mapping.date)),
      docNo: cellToDisplayString(mappedCell(row, mapping.docNo)),
      description: cellToDisplayString(mappedCell(row, mapping.description)),
      debit,
      credit,
      signedAmount: round2(debit - credit),
    });
  });
  return result;
}
