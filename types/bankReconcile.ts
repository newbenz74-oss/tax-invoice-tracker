/**
 * ประเภทข้อมูลของฟีเจอร์ "Bank Reconcile" เฟส 1 (อัปโหลด + เตรียมข้อมูล) — เพิ่มเข้ามา 2026-07-16
 *
 * เฟสนี้ยังไม่มีตาราง Supabase ใดๆ ทั้งสิ้น (ตามสเปกที่ระบุว่า "ยังไม่ต้องบันทึกลงฐานข้อมูล") ทุกอย่าง
 * เป็น client-side state ล้วนๆ อยู่ในหน่วยความจำของเบราว์เซอร์เท่านั้น ไม่มีการเรียก Supabase ที่นี่เลย
 *
 * หัวคอลัมน์ของไฟล์ Bank Statement / GL จากระบบ Express ไม่ตายตัว (ต่างจาก lib/excelImport.ts และ
 * lib/contactExcelImport.ts ที่ใช้เทมเพลตหัวคอลัมน์คงที่ของระบบเอง) เพราะเป็นไฟล์จริงจากธนาคาร/ระบบ
 * บัญชีต้นทางที่ผู้ใช้อัปโหลดเข้ามาตรงๆ จึงต้องอ่านเป็นตารางดิบแบบ array-of-arrays (RawFileTable) ก่อน
 * แล้วให้ผู้ใช้ "จับคู่คอลัมน์" เอง (ColumnMapping) แทนการอ่านเป็น object ตาม header คงที่
 */

/** ตารางดิบที่อ่านได้จากไฟล์ต้นฉบับ — แถวแรกสุดของไฟล์ถูกแยกออกมาเป็น headers เสมอ (ไม่ว่าจะมีเนื้อหา
 * จริงหรือไม่ก็ตาม) ส่วน rows คือแถวข้อมูลที่เหลือทั้งหมด (ยังไม่กรองแถวว่างออก — ดู isRowBlank ใน
 * lib/bankReconcileNormalize.ts) index ของแต่ละคอลัมน์ใน headers ตรงกับ index ของค่าที่ตำแหน่งเดียวกัน
 * ในแต่ละแถวของ rows เสมอ ใช้ index นี้เป็นค่าที่เก็บใน ColumnMapping ด้านล่าง */
export interface RawFileTable {
  headers: string[];
  rows: unknown[][];
}

/** ผลตรวจสอบไฟล์ระดับโครงสร้าง (ประเภทไฟล์ / ไฟล์ว่าง / มีหัวคอลัมน์ / มีแถวข้อมูล) — ไม่เกี่ยวกับการ
 * จับคู่คอลัมน์หรือค่าข้อมูลรายเซลล์ใดๆ (นั่นเป็นหน้าที่ของ normalize ที่ทำหลังจับคู่คอลัมน์แล้วเท่านั้น) */
export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

/** สถานะของไฟล์หนึ่งไฟล์ที่อัปโหลดเข้ามาในการ์ด (Bank Statement หรือ GL) — เก็บทั้งตารางดิบ ผลตรวจสอบ
 * และจำนวนแถวข้อมูล (ไม่นับแถวว่างล้วน) ไว้ด้วยกัน เพื่อให้ BankReconcilePage ใช้ตัดสินใจว่าจะเปิดปุ่ม
 * "ถัดไป: จับคู่คอลัมน์" ได้หรือยัง (valid ทั้งสองไฟล์) โดยไม่ต้อง parse ซ้ำ */
export interface UploadedFileState {
  fileName: string;
  table: RawFileTable;
  validation: FileValidationResult;
  rowCount: number;
}

/** ฟิลด์ที่ผู้ใช้ต้อง/สามารถจับคู่กับคอลัมน์ในไฟล์ Bank Statement — ตามลำดับที่ระบุในสเปกเป๊ะ
 * (วันที่รายการ, รายละเอียด, เงินเข้า, เงินออก, ยอดคงเหลือ) */
export type BankColumnKey = 'transactionDate' | 'description' | 'moneyIn' | 'moneyOut' | 'balance';

/** ฟิลด์ที่ผู้ใช้ต้อง/สามารถจับคู่กับคอลัมน์ในไฟล์ GL จากระบบ Express — ตามลำดับที่ระบุในสเปกเป๊ะ
 * (วันที่, เลขที่เอกสาร, รายละเอียด, เดบิต, เครดิต) */
export type GLColumnKey = 'date' | 'docNo' | 'description' | 'debit' | 'credit';

/** ค่า = index ของคอลัมน์ใน RawFileTable.headers/rows ที่ผู้ใช้เลือกจับคู่ไว้ null = ยังไม่ได้จับคู่
 * (ทุกฟิลด์เริ่มต้นเป็น null เสมอ — ระบบไม่เดา/auto-map ให้ ผู้ใช้ต้องเลือกเองทั้งหมดตามสเปก "Allow users
 * to map") ฟิลด์ที่ไม่ได้จับคู่ไม่ใช่ error เสมอไป (ดู isBankMappingComplete/isGLMappingComplete ใน
 * lib/bankReconcileValidation.ts — เลขที่เอกสาร/รายละเอียด/ยอดคงเหลือ ไม่บังคับ) */
export type BankColumnMapping = Record<BankColumnKey, number | null>;
export type GLColumnMapping = Record<GLColumnKey, number | null>;

/** แถว Bank Statement หลัง normalize แล้ว — signedAmount = moneyIn - moneyOut ตาม sign convention
 * หลักของทั้งฟีเจอร์ (เงินเข้า = บวก, เงินออก = ลบ) ใช้แสดงในตัวอย่างพรีวิว 10 แถวแรกเท่านั้นในเฟสนี้
 * (ยังไม่มีการจับคู่/เทียบกับ GL ใดๆ ทั้งสิ้น) */
export interface NormalizedBankRow {
  rowNumber: number; // เลขแถวจริงในไฟล์ต้นฉบับ (แถว 1 = header เสมอ เหมือนธรรมเนียมเดิมของ lib/excelImport.ts)
  transactionDate: string | null; // ISO YYYY-MM-DD หรือ null ถ้าคอลัมน์ไม่ได้จับคู่/แปลงวันที่ไม่ได้
  description: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  signedAmount: number;
}

/** แถว GL หลัง normalize แล้ว — signedAmount = debit - credit แปลงให้อยู่ใน sign convention เดียวกับ
 * Bank Statement แล้ว (บัญชีเงินสด/ธนาคารเป็นสินทรัพย์: เดบิตเพิ่ม = เงินเข้า, เครดิตลด = เงินออก) —
 * ดูที่มาของ formula นี้ใน lib/bankReconcileNormalize.ts (อ้างอิงบั๊กที่เคยแก้ในเครื่องมือกระทบยอด
 * ธนาคารรุ่นก่อนหน้า ดู claude/bank-reconciliation-tool.md) */
export interface NormalizedGLRow {
  rowNumber: number;
  date: string | null;
  docNo: string;
  description: string;
  debit: number;
  credit: number;
  signedAmount: number;
}
