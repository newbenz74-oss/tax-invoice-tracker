import type { BankColumnMapping, BankRow, FileValidationResult, GLColumnMapping, GLRow, RawFileTable } from '@/types/bankReconcile';
import { isRowUsable } from '@/types/bankReconcile';
import { isRowBlank } from './bankReconcileNormalize';

/**
 * การตรวจสอบไฟล์/การจับคู่คอลัมน์/แถวข้อมูล — เขียนใหม่ 2026-07-17 คู่กับโมเดลกระทบยอดใหม่ (ทิศทาง+จำนวนเงิน)
 * ไฟล์นี้แทนที่ lib/bankReconcileValidation.ts เดิมทั้งไฟล์
 */

/** นามสกุลไฟล์ที่รองรับ — เพิ่ม .pdf เข้ามาตามสเปกส่วน "9. SUPPORTED FILES" (เดิมรองรับแค่ .xlsx/.xls/.csv) */
export const ACCEPTED_BANK_RECONCILE_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.pdf'] as const;

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

export function isAcceptedBankReconcileFileType(fileName: string): boolean {
  return (ACCEPTED_BANK_RECONCILE_EXTENSIONS as readonly string[]).includes(getFileExtension(fileName));
}

/** ตรวจสอบประเภทไฟล์จากนามสกุล (ก่อนอ่านเนื้อไฟล์ด้วยซ้ำ) — คืนข้อความแจ้งเตือนภาษาไทย หรือ null ถ้าผ่าน */
export function validateFileType(fileName: string): string | null {
  return isAcceptedBankReconcileFileType(fileName) ? null : 'ไฟล์ต้องเป็นนามสกุล .xlsx, .xls, .csv หรือ .pdf เท่านั้น';
}

/** ตรวจสอบไฟล์ที่อ่านเป็นตารางดิบแล้ว (ยังไม่จับคู่คอลัมน์) — ไฟล์ต้องไม่ว่างเปล่า, ต้องมีแถวหัวคอลัมน์ (หรืออย่าง
 * น้อยมีคอลัมน์ให้จับคู่ — ไฟล์ PDF ที่แปลงมาอาจไม่มี header แถวจริงๆ header จะเป็นสตริงว่างล้วนแต่ยังนับว่า "มี
 * โครงตาราง" ได้ถ้ามีความกว้างคอลัมน์ ≥ 1 อยู่แล้ว จึงตรวจจาก headers.length แทนการตรวจว่ามีข้อความจริงหรือไม่),
 * ต้องมีแถวข้อมูลอย่างน้อย 1 แถว */
export function validateParsedTable(table: RawFileTable): FileValidationResult {
  const errors: string[] = [];

  const isCompletelyEmpty = table.headers.length === 0 && table.rows.length === 0;
  if (isCompletelyEmpty) {
    return { valid: false, errors: ['ไฟล์นี้ว่างเปล่า ไม่มีข้อมูลใดๆ'] };
  }

  if (table.headers.length === 0) {
    errors.push('ไม่พบโครงสร้างคอลัมน์ในไฟล์นี้ กรุณาตรวจสอบไฟล์');
  }

  const hasDataRow = table.rows.some((row) => !isRowBlank(row));
  if (!hasDataRow) {
    errors.push('ไม่พบแถวข้อมูลในไฟล์นี้ กรุณาตรวจสอบว่ามีข้อมูลอย่างน้อย 1 แถว');
  }

  return { valid: errors.length === 0, errors };
}

/** นับจำนวนแถวข้อมูลจริง (ไม่รวมแถวว่างล้วน) — ใช้แสดง "จำนวนแถว" ในการ์ดอัปโหลด */
export function countDataRows(table: RawFileTable): number {
  return table.rows.filter((row) => !isRowBlank(row)).length;
}

/** เงื่อนไข "จับคู่คอลัมน์ครบพอที่จะไปขั้นตอนถัดไปได้" ของ Bank Statement — ต้องระบุครบทั้ง 4 ฟิลด์ที่บังคับ
 * ตามสเปกส่วน "10. COLUMN MAPPING" เป๊ะ (วันที่รายการ, รายละเอียด, เงินเข้า, เงินออก — ทั้งสี่ฟิลด์ ไม่ใช่แค่
 * อย่างใดอย่างหนึ่งของเงินเข้า/เงินออกเหมือนโมเดลเดิม) ยอดคงเหลือและเลขที่บัญชีไม่บังคับ */
export function isBankMappingComplete(mapping: BankColumnMapping): boolean {
  return (
    mapping.transactionDate !== null &&
    mapping.description !== null &&
    mapping.moneyIn !== null &&
    mapping.moneyOut !== null
  );
}

/** เงื่อนไขเดียวกันฝั่ง GL — ต้องระบุครบวันที่/รายละเอียด/ฝั่งรับเงิน/ฝั่งจ่ายเงิน เลขที่เอกสารและรหัสบัญชี
 * ไม่บังคับ */
export function isGLMappingComplete(mapping: GLColumnMapping): boolean {
  return mapping.date !== null && mapping.description !== null && mapping.moneyIn !== null && mapping.moneyOut !== null;
}

/** แถวทั้งหมด "พร้อมกระทบยอด" หรือยัง — ทุกแถวต้อง isRowUsable (ไม่มี error ค้าง) หรือถูกยกเว้นไปแล้วโดยผู้ใช้
 * เท่านั้น ใช้เปิด/ปิดปุ่ม "เริ่มกระทบยอด" ในขั้นตอนพรีวิว ตามสเปก "Do not start reconciliation until all
 * included rows are valid" ตรงๆ — แถวที่ถูกยกเว้น (excluded) ไม่นับเป็นตัวกั้นเพราะผู้ใช้ตัดสินใจแล้วว่าจะไม่นำ
 * แถวนั้นเข้ากระทบยอด */
export function allRowsReadyForReconciliation(rows: Array<BankRow | GLRow>): boolean {
  return rows.every((row) => row.excluded || isRowUsable(row));
}
