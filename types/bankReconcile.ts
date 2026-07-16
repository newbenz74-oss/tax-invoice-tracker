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

/* ============================== เฟส 2: เครื่องมือจับคู่รายการ (Matching Engine) ==============================
 * เพิ่มเข้ามา 2026-07-16 — ชนิดข้อมูลด้านล่างนี้เป็น "มุมมองสำหรับเครื่องมือจับคู่" เท่านั้น แปลงมาจาก
 * NormalizedBankRow/NormalizedGLRow ด้านบนผ่าน adapter (toMatchBankRows/toMatchGLRows ใน
 * lib/bankReconcileMatching.ts) ไม่ได้แก้ไข/rename ชนิดข้อมูลเดิมของเฟส 1 แม้แต่ฟิลด์เดียว
 * ชื่อฟิลด์ snake_case ด้านล่าง (bank_row_id, gl_date, ...) เป็นชื่อที่สเปกเฟส 2 ระบุไว้ตรงๆ
 * ("Bank Statement normalized fields: bank_row_id, bank_date, ...") จงใจให้ต่างจาก camelCase ของเฟส 1
 * เพื่อสะท้อนว่าเป็นคนละชั้นข้อมูลกัน — ไฟล์นี้มีแต่ type/interface ล้วนๆ ตามธรรมเนียมเดิมของไฟล์นี้ทั้งไฟล์
 * (ไม่มี LABELS/BADGE_CLASS/ฟังก์ชันใดๆ อยู่ที่นี่ — สิ่งเหล่านั้นอยู่ใน lib/bankReconcileMatchLogic.ts แทน
 * ตามธรรมเนียมเดิมของโปรเจกต์ เช่น OverdueAgingStatus + OVERDUE_AGING_LABELS ใน lib/overduePurchaseTaxLogic.ts) */

/** สถานะผลการจับคู่ทั้งหมด 6 ค่า — 5 ค่าแรกใช้กับแถว Bank (ดู BankRowMatchStatus ด้านล่าง) ค่าสุดท้าย
 * (not_found_in_bank) ใช้เฉพาะกับแถว GL ที่เหลือค้างในส่วน "รายการใน GL ที่ไม่พบใน Bank Statement" เท่านั้น
 * รวมไว้ใน union เดียวกันเพื่อให้ MATCH_STATUS_LABELS/MATCH_STATUS_BADGE_CLASS ใช้ map เดียวกันได้ทั้งสองฝั่ง */
export type MatchStatus =
  | 'matched_exact' // เรียบร้อย — ยอดเงินตรงเป๊ะ + วันที่ตรงเป๊ะ + มี GL ที่ยังไม่ถูกใช้ตรงเงื่อนไขพอดี 1 รายการ
  | 'matched_tolerance' // น่าจะตรงกัน — ยอดเงินตรงเป๊ะ + วันที่อยู่ในช่วง tolerance (ไม่ตรงเป๊ะ) + ผู้สมัครเดียว
  | 'ambiguous' // พบหลายรายการที่อาจตรงกัน — มี GL มากกว่า 1 รายการตรงเงื่อนไข (เป๊ะหรือใน tolerance) ห้ามเลือกอัตโนมัติ
  | 'pending_review' // รอตรวจสอบ — ยอดเงินตรงกันใน GL แต่ทุกวันที่ที่มีอยู่นอกช่วง tolerance
  | 'not_found_in_gl' // ไม่พบใน GL — ไม่มี GL ที่ยังไม่ถูกใช้ที่ยอดเงินตรงกันเลย
  | 'not_found_in_bank'; // ไม่พบใน Bank — เฉพาะแถว GL ที่เหลือค้างหลังจับคู่ (ไม่ปรากฏใน BankMatchResult)

/** สถานะที่ใช้กับแถว Bank เท่านั้น (ตัด not_found_in_bank ออก) — ใช้เป็นชนิดของ BankMatchResult.status และ
 * ReconcileFilters.status เพื่อให้คอมไพเลอร์ป้องกันไม่ให้ค่า 'not_found_in_bank' หลุดเข้าไปฝั่งแถว Bank ได้
 * (Segmented Control ของตารางหลักก็มีแค่ 5 สถานะนี้ + "ทั้งหมด" ตามสเปกตรงๆ ไม่มี "ไม่พบใน Bank" เป็นแท็บ) */
export type BankRowMatchStatus = Exclude<MatchStatus, 'not_found_in_bank'>;

/** ตัวเลือก Date Tolerance ที่ผู้ใช้ปรับได้ (ค่าเริ่มต้น ±3 วันตามสเปก) — ดู DATE_TOLERANCE_DAYS ใน
 * lib/bankReconcileMatchLogic.ts สำหรับค่าตัวเลขวันที่แต่ละตัวเลือกแทน */
export type DateToleranceOption = 'same_day' | '1_day' | '3_days' | '7_days';

/** แถว Bank Statement ในมุมมองของเครื่องมือจับคู่ — raw_bank_row เก็บแถวดิบต้นฉบับแยกไว้ต่างหากเสมอ
 * (ไม่ปนกับค่าที่ normalize/คำนวณแล้ว ตามสเปก "Keep raw rows and normalized rows separate") */
export interface MatchBankRow {
  bank_row_id: string;
  bank_date: string | null;
  bank_description: string;
  bank_money_in: number;
  bank_money_out: number;
  bank_amount: number; // = signedAmount เดิมจากเฟส 1 (เงินเข้า = บวก, เงินออก = ลบ)
  bank_balance: number;
  raw_bank_row: unknown[];
}

/** แถว GL ในมุมมองของเครื่องมือจับคู่ */
export interface MatchGLRow {
  gl_row_id: string;
  gl_date: string | null;
  gl_document_no: string;
  gl_description: string;
  gl_debit: number;
  gl_credit: number;
  gl_amount: number; // = signedAmount เดิมจากเฟส 1 (debit - credit แปลงเป็น sign convention เดียวกับ Bank แล้ว)
  raw_gl_row: unknown[];
}

/** ผลการจับคู่ของแถว Bank หนึ่งแถว — หน่วยหลักที่ตารางผลลัพธ์ใช้แสดง (ตารางเป็น Bank-based เสมอ ทุกแถว Bank
 * ต้องมี BankMatchResult ของตัวเองเสมอ 1 รายการ ไม่ว่าจะจับคู่ได้หรือไม่ก็ตาม)
 * candidates = ผู้สมัครทั้งหมดที่ยอดเงินตรงกัน (ไม่ว่าวันที่จะตรง/อยู่ใน tolerance/เกิน tolerance หรือไม่ก็ตาม)
 * ณ ขณะที่ประมวลผลแถวนี้ — เก็บไว้ให้ Modal "ดูรายการที่อาจตรงกัน" ใช้แสดงได้เสมอทุกสถานะ (ไม่ใช่แค่ ambiguous) */
export interface BankMatchResult {
  bank: MatchBankRow;
  status: BankRowMatchStatus;
  matchedGL: MatchGLRow | null; // มีค่าเฉพาะ matched_exact/matched_tolerance เท่านั้น (จับคู่แน่นอนแล้ว)
  candidates: MatchGLRow[];
  matchScore: number | null; // null เฉพาะ not_found_in_gl และ ambiguous (ไม่มี "คู่ที่เลือก" ให้คิดคะแนน)
  amountDifference: number | null;
  dateDifferenceDays: number | null;
  matchReason: string;
}

/** แถว GL ที่เหลือค้างหลังจับคู่ทั้งหมดแล้ว (ไม่เคยถูกเลือกเป็น matchedGL ของ Bank แถวใดเลย) */
export interface GLOnlyResult {
  gl: MatchGLRow;
  status: 'not_found_in_bank';
}

/** ผลลัพธ์รวมจากการรันเครื่องมือจับคู่ครั้งหนึ่งๆ — bankResults ยาวเท่ากับจำนวนแถว Bank เสมอ (ทุกแถวต้อง
 * ปรากฏตามสเปก "Every Bank Statement row must remain visible") glOnlyResults คือ GL ที่เหลือหลังจับคู่ */
export interface ReconcileMatchOutput {
  bankResults: BankMatchResult[];
  glOnlyResults: GLOnlyResult[];
}
