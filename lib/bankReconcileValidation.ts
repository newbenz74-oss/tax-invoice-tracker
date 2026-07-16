import { isAcceptedBankReconcileFileType } from './bankReconcileParse';
import { isRowBlank } from './bankReconcileNormalize';
import type { BankColumnMapping, FileValidationResult, GLColumnMapping, RawFileTable } from '@/types/bankReconcile';

/** ตรวจสอบประเภทไฟล์จากนามสกุล (ก่อนอ่านเนื้อไฟล์ด้วยซ้ำ) — คืนข้อความแจ้งเตือนภาษาไทย หรือ null ถ้าผ่าน */
export function validateFileType(fileName: string): string | null {
  return isAcceptedBankReconcileFileType(fileName)
    ? null
    : 'ไฟล์ต้องเป็นนามสกุล .xlsx, .xls หรือ .csv เท่านั้น';
}

/**
 * ตรวจสอบไฟล์ที่อ่านเป็นตารางดิบแล้ว (ยังไม่จับคู่คอลัมน์) ตามเงื่อนไขที่สเปกระบุไว้ตรงๆ ทั้งหมด: ไฟล์ต้อง
 * ไม่ว่างเปล่า, ต้องมีแถวหัวคอลัมน์, ต้องมีแถวข้อมูลอย่างน้อย 1 แถว — ไม่ยอมรับไฟล์ที่ขาดเงื่อนไขเหล่านี้
 * แบบเงียบๆ เด็ดขาด (ตามสเปก "Do not silently accept invalid rows") ทุก error ที่พบจะถูกสะสมไว้ทั้งหมด
 * (ไม่ return ทันทีที่เจอข้อแรก) เพื่อให้ผู้ใช้เห็นปัญหาทั้งหมดในครั้งเดียว ยกเว้นกรณีไฟล์ว่างเปล่าสนิท
 * (ไม่มีอะไรให้ตรวจต่อแล้วจริงๆ)
 */
export function validateParsedTable(table: RawFileTable): FileValidationResult {
  const errors: string[] = [];

  const isCompletelyEmpty = table.headers.length === 0 && table.rows.length === 0;
  if (isCompletelyEmpty) {
    return { valid: false, errors: ['ไฟล์นี้ว่างเปล่า ไม่มีข้อมูลใดๆ'] };
  }

  const hasHeaderRow = table.headers.some((h) => h.trim() !== '');
  if (!hasHeaderRow) {
    errors.push('ไม่พบแถวหัวคอลัมน์ในไฟล์นี้ กรุณาตรวจสอบว่าแถวแรกของไฟล์เป็นชื่อคอลัมน์');
  }

  const hasDataRow = table.rows.some((row) => !isRowBlank(row));
  if (!hasDataRow) {
    errors.push('ไม่พบแถวข้อมูลในไฟล์นี้ กรุณาตรวจสอบว่ามีข้อมูลอย่างน้อย 1 แถวใต้หัวคอลัมน์');
  }

  return { valid: errors.length === 0, errors };
}

/** นับจำนวนแถวข้อมูลจริง (ไม่รวมแถวว่างล้วน) — ใช้แสดง "จำนวนแถว" ในการ์ดอัปโหลดตามสเปก */
export function countDataRows(table: RawFileTable): number {
  return table.rows.filter((row) => !isRowBlank(row)).length;
}

/** เงื่อนไข "จับคู่คอลัมน์ครบพอที่จะไปขั้นตอนถัดไปได้" ของ Bank Statement — ต้องมีวันที่รายการเสมอ
 * (ไม่มีวันที่ กระทบยอดไม่ได้แน่นอน) และต้องมีอย่างน้อยคอลัมน์เงินเข้าหรือเงินออกคอลัมน์ใดคอลัมน์หนึ่ง
 * (ไม่บังคับทั้งคู่ เพราะไฟล์ธนาคารบางแบบอาจแยกเป็นคอลัมน์เดียว "จำนวนเงิน" ที่ผู้ใช้จะ map มาแค่ช่องเดียว)
 * ยอดคงเหลือและรายละเอียดไม่บังคับตามสเปก ("Do not require reference number/description for matching,
 * but keep description available for display") */
export function isBankMappingComplete(mapping: BankColumnMapping): boolean {
  return mapping.transactionDate !== null && (mapping.moneyIn !== null || mapping.moneyOut !== null);
}

/** เงื่อนไขเดียวกันฝั่ง GL — ต้องมีวันที่ และอย่างน้อยเดบิตหรือเครดิตคอลัมน์ใดคอลัมน์หนึ่ง เลขที่เอกสารและ
 * รายละเอียดไม่บังคับตามสเปกที่ระบุไว้ตรงๆ ("Do not require reference number") */
export function isGLMappingComplete(mapping: GLColumnMapping): boolean {
  return mapping.date !== null && (mapping.debit !== null || mapping.credit !== null);
}
