/**
 * ประเภทข้อมูลสำหรับโมดูล "กระทบยอด Bank Reconcile" เวอร์ชันใหม่ (ออกแบบใหม่ทั้งหมด 2026-07-17)
 *
 * โมดูลนี้เป็น "รายงานเปรียบเทียบ" ระหว่าง Bank Statement กับ GL เท่านั้น ไม่มีการแก้ไข/บันทึกข้อมูล
 * บัญชีใดๆ ทั้งสิ้น — ดังนั้น type ทั้งหมดในไฟล์นี้เป็นข้อมูลที่อยู่ใน memory ของ browser ชั่วคราวระหว่าง
 * ที่ผู้ใช้เปิดหน้านี้อยู่เท่านั้น ไม่มีการบันทึกลงฐานข้อมูล ไม่มีตาราง Supabase คู่กับ type เหล่านี้
 */

/** รับ (เงินเข้า) หรือ จ่าย (เงินออก) — ใช้ทั้งฝั่ง Bank Statement และฝั่ง GL เพื่อให้กติกา "รับจับคู่กับรับ
 * เท่านั้น จ่ายจับคู่กับจ่ายเท่านั้น" เทียบกันได้ตรงๆ */
export type TransactionType = 'receive' | 'payment';

/** ตัวเลือกช่วงวันที่ที่ยอมรับได้เมื่อหาคู่ที่ตรงกันแบบไม่ตรงวันที่เป๊ะ (ดูกติกาข้อ 4 ในสเปก) */
export type DateTolerance = 1 | 3;

/** 1 แถวจากไฟล์ Bank Statement หลัง parse แล้ว — id เป็น id สังเคราะห์ที่สร้างขึ้นตอน parse (อิงตำแหน่ง
 * แถวในไฟล์ต้นฉบับ) ใช้แค่ภายในหน้านี้เพื่ออ้างอิง React key และผลการจับคู่ ไม่ใช่ id จากฐานข้อมูลใดๆ */
export interface BankTransaction {
  id: string;
  date: string; // ISO YYYY-MM-DD เสมอ (แปลงจากค่าดิบในไฟล์ตอน parse)
  type: TransactionType;
  amount: number; // ปัดเศษ 2 ตำแหน่งเสมอ เป็นค่าบวกเสมอ (ประเภทรับ/จ่ายบ่งบอกทิศทางอยู่แล้วในฟิลด์ type)
}

/** 1 แถวจากไฟล์ GL หลัง parse แล้ว — เหมือน BankTransaction ทุกประการ บวกเลขที่เอกสาร (แสดงเฉพาะใน
 * ตารางกระทบยอดสำเร็จเท่านั้น ตามสเปก — ส่วนตาราง "GL ไม่สำเร็จ" ไม่แสดงคอลัมน์นี้) */
export interface GLTransaction {
  id: string;
  documentNo: string;
  date: string;
  type: TransactionType;
  amount: number;
}

/** 1 คู่ที่กระทบยอดสำเร็จ — Bank 1 แถว ต่อ GL 1 แถว เท่านั้น (1:1 เท่านั้นตามกติกาข้อ 7) */
export interface MatchedPair {
  bank: BankTransaction;
  gl: GLTransaction;
}

export interface ReconcileSummary {
  bankCount: number;
  glCount: number;
  matchedCount: number;
  bankUnmatchedCount: number;
  glUnmatchedCount: number;
}

/** ผลลัพธ์เต็มของการกระทบยอด 1 ครั้ง (1 ครั้งที่กดปุ่ม "ตรวจสอบข้อมูล") — ไม่มีการบันทึกค้างไว้ข้าม
 * session ใดๆ กดปุ่มใหม่ = คำนวณใหม่ทั้งหมดจากไฟล์ที่อัปโหลดไว้ ณ ขณะนั้นเสมอ */
export interface ReconcileResult {
  matched: MatchedPair[];
  bankUnmatched: BankTransaction[];
  glUnmatched: GLTransaction[];
  summary: ReconcileSummary;
}

/** ผลลัพธ์การอ่านไฟล์ 1 ไฟล์ (ไม่ว่าจะเป็น Bank หรือ GL, ไม่ว่าไฟล์จะเป็น Excel/CSV/PDF)
 * - errors: ปัญหาระดับไฟล์ที่ทำให้ใช้ไฟล์นี้ไม่ได้เลย (เช่น หาคอลัมน์ที่จำเป็นไม่เจอ, อ่านไฟล์ไม่ออก) —
 *   ถ้ามี errors แปลว่า rows จะเป็น [] เสมอ
 * - warnings: ปัญหาระดับแถว ที่ทำให้ "ข้ามเฉพาะแถวนั้น" ไป (เช่น วันที่อ่านไม่ออก, แถวมีทั้งรับและจ่าย
 *   พร้อมกันจนระบุประเภทไม่ได้) ไม่ทำให้ทั้งไฟล์ใช้ไม่ได้ — ไฟล์ยังใช้งานต่อได้ด้วยแถวที่เหลือ
 */
export interface ParsedTransactionFile<T> {
  rows: T[];
  errors: string[];
  warnings: string[];
}
