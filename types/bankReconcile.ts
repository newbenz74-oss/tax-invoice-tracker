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

/** สถานะผลการจับคู่ทั้งหมด 9 ค่า — 8 ค่าแรกใช้กับแถว Bank (ดู BankRowMatchStatus ด้านล่าง) ค่าสุดท้าย
 * (not_found_in_bank) ใช้เฉพาะกับแถว GL ที่เหลือค้างในส่วน "รายการใน GL ที่ไม่พบใน Bank Statement" เท่านั้น
 * รวมไว้ใน union เดียวกันเพื่อให้ MATCH_STATUS_LABELS/MATCH_STATUS_BADGE_CLASS ใช้ map เดียวกันได้ทั้งสองฝั่ง
 * — 3 ค่าสุดท้ายก่อน not_found_in_bank (confirmed_manual/confirmed_tolerance/confirmed_variance) เพิ่มเข้ามา
 * ในเฟส 3 (เครื่องมือจับคู่ด้วยตนเอง) ต่อท้าย union เดิมของเฟส 2 เท่านั้น ไม่แก้ไข/ลบ/เรียงลำดับ 6 ค่าเดิมใหม่
 * เลยแม้แต่ค่าเดียว (ดู lib/bankReconcileManualMatch.ts สำหรับตรรกะที่ผลิตค่าทั้งสามนี้) */
export type MatchStatus =
  | 'matched_exact' // เรียบร้อย — ยอดเงินตรงเป๊ะ + วันที่ตรงเป๊ะ + มี GL ที่ยังไม่ถูกใช้ตรงเงื่อนไขพอดี 1 รายการ
  | 'matched_tolerance' // น่าจะตรงกัน — ยอดเงินตรงเป๊ะ + วันที่อยู่ในช่วง tolerance (ไม่ตรงเป๊ะ) + ผู้สมัครเดียว
  | 'ambiguous' // พบหลายรายการที่อาจตรงกัน — มี GL มากกว่า 1 รายการตรงเงื่อนไข (เป๊ะหรือใน tolerance) ห้ามเลือกอัตโนมัติ
  | 'pending_review' // รอตรวจสอบ — ยอดเงินตรงกันใน GL แต่ทุกวันที่ที่มีอยู่นอกช่วง tolerance (สถานะที่คำนวณอัตโนมัติ
  // ต่างจาก ReviewFlag.review_required ด้านล่างซึ่งเป็นการทำเครื่องหมายด้วยตนเอง คนละแกนกัน — ดูหมายเหตุที่ ReviewFlag)
  | 'not_found_in_gl' // ไม่พบใน GL — ไม่มี GL ที่ยังไม่ถูกใช้ที่ยอดเงินตรงกันเลย
  | 'confirmed_manual' // ยืนยันด้วยตนเอง (เฟส 3) — ผู้ใช้ยืนยันการจับคู่เอง และผลต่างยอดเงิน = 0.00 พอดี
  | 'confirmed_tolerance' // ตรงกันภายในค่าคลาดเคลื่อน (เฟส 3) — ยืนยันเองแล้ว ผลต่างยอดเงิน > 0 แต่อยู่ในค่าคลาดเคลื่อนที่ตั้งไว้
  | 'confirmed_variance' // ยืนยันแบบมีผลต่าง (เฟส 3) — ยืนยันเองแบบ override ผลต่างยอดเงินเกินค่าคลาดเคลื่อน (บังคับมีหมายเหตุ)
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

/* ============================== เฟส 3: เครื่องมือจับคู่รายการด้วยตนเอง (Manual Reconciliation) ==============================
 * เพิ่มเข้ามา 2026-07-16 — ต่อยอดจากเฟส 2 โดยตรง ไม่แก้ไข type ใดๆ ของเฟส 1/2 ด้านบนแม้แต่ฟิลด์เดียว (ยกเว้น
 * การ "เพิ่มค่าใหม่ต่อท้าย" ใน MatchStatus union เท่านั้น) หลักการสำคัญที่สุดของเฟสนี้คือ "ห้ามแก้ไขค่าที่นำ
 * เข้ามาต้นฉบับ (Bank/GL) เด็ดขาด — เก็บความสัมพันธ์การจับคู่ด้วยตนเองแยกต่างหากเสมอ" (สเปก "Manual matching
 * must never modify the original imported values. Store matching relationships separately") ดังนั้นชนิดข้อมูล
 * ด้านล่างนี้ทั้งหมดเป็น "ชั้นทับซ้อน" (overlay) เก็บแยกจาก MatchBankRow/MatchGLRow โดยสิ้นเชิง อ้างอิงกันแค่
 * ผ่าน id (bank_row_id/gl_row_id) เท่านั้น ไม่มี field ใดของ MatchBankRow/MatchGLRow ถูกเปลี่ยนค่าเลย */

/** ประเภทการจับคู่ด้วยตนเอง 4 แบบตามที่สเปกแนะนำไว้ตรงๆ — คำนวณอัตโนมัติจากจำนวนแถว Bank/GL ที่อยู่ในกลุ่มตอน
 * ยืนยัน ไม่ใช่ค่าที่ผู้ใช้เลือกเอง (ดู deriveMatchType ใน lib/bankReconcileManualMatch.ts) */
export type MatchType = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'manual_override';

/** สถานะผลการยืนยันด้วยตนเอง 3 แบบ (สับเซตของ MatchStatus ด้านบน) — คำนวณครั้งเดียว ณ ตอนยืนยัน แล้ว "แช่แข็ง"
 * เก็บไว้ใน MatchGroup.status ถาวร (ไม่คำนวณใหม่ตาม Amount Tolerance ที่อาจถูกปรับเปลี่ยนภายหลัง) ต่างจาก Date
 * Tolerance ของเฟส 2 ที่ทำให้ผลอัตโนมัติ "รีเฟรชสด" ทุกครั้งที่เปลี่ยนค่าโดยเจตนา — เพราะที่นี่เป็นการตัดสินใจ
 * ของมนุษย์ที่ยืนยันไปแล้ว ไม่ควรเปลี่ยนความหมายย้อนหลังเองแค่เพราะมีคนปรับตัวเลื่อนค่าคลาดเคลื่อนส่วนกลางทีหลัง
 * (ต้องกดยกเลิกแล้วจับคู่ใหม่เท่านั้นถึงจะได้ค่าจัดประเภทใหม่) เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล */
export type ManualConfirmStatus = 'confirmed_manual' | 'confirmed_tolerance' | 'confirmed_variance';

/** กลุ่มการจับคู่ด้วยตนเองหนึ่งกลุ่ม — หน่วยเดียวที่ใช้แทนทั้ง "ยืนยันรายการที่แนะนำ" (1 Bank : 1 GL),
 * "1 Bank ต่อหลาย GL", และ "หลาย Bank ต่อ 1 GL" (bank_transaction_ids/gl_transaction_ids มีสมาชิกกี่ตัวก็ได้
 * ตั้งแต่ 1 ตัวขึ้นไปทั้งคู่ — match_type แค่บอกความหมายให้ผู้ใช้อ่านง่าย ไม่ใช่ตัวจำกัดรูปร่างข้อมูล)
 * date_difference_days มีความหมายชัดเจนเฉพาะกลุ่ม 1:1 เท่านั้น (null เสมอถ้ามีมากกว่า 1 ฝั่งใดฝั่งหนึ่ง เพราะ
 * "วันที่ต่างกัน" ระหว่างหลายคู่ไม่มีนิยามเดียวที่ชัดเจน — ดูรายละเอียดรายแถวได้ใน Group Detail Drawer แทน) */
export interface MatchGroup {
  match_group_id: string;
  match_type: MatchType;
  status: ManualConfirmStatus;
  bank_transaction_ids: string[];
  gl_transaction_ids: string[];
  bank_total: number;
  gl_total: number;
  amount_difference: number;
  date_difference_days: number | null;
  manual_match: true;
  matched_by: string;
  matched_at: string; // ISO datetime (เก็บเป็น string เสมอ ไม่ใช่ Date object — สอดคล้องกับ transactionDate/date ของเฟส 1 ที่เก็บเป็น ISO string ทั้งหมด)
  note: string;
  /** คะแนน/เหตุผลจากเครื่องมือจับคู่อัตโนมัติ ณ ตอนที่ยืนยัน — เก็บไว้แสดงคู่กับผลยืนยันเสมอตามสเปก "Preserve
   * the original automatic score and reason" — null เมื่อยืนยันจากแถวที่ไม่เคยมีข้อเสนออัตโนมัติมาก่อนเลย
   * (เช่น not_found_in_gl ที่เลือก GL เองทั้งหมด หรือกลุ่ม one_to_many/many_to_one ที่ไม่มี "คะแนนอัตโนมัติ"
   * เดี่ยวๆ ให้อ้างอิงตั้งแต่แรก) */
  auto_match_score: number | null;
  auto_match_reason: string | null;
}

/** การทำเครื่องหมาย "ต้องตรวจสอบ" ด้วยตนเอง — คนละแกนกับสถานะอัตโนมัติ pending_review โดยเจตนา (แถวสถานะใดก็
 * ทำเครื่องหมายนี้ได้ทั้งหมด ไม่ใช่แค่ pending_review) ข้อความหมายเหตุของการตรวจสอบใช้ร่วมกับ RowNote ของแถว
 * เดียวกันเสมอ (ไม่แยกฟิลด์ review_note ต่างหาก) เพื่อไม่ให้มีหมายเหตุสองช่องที่อาจไม่ตรงกันของแถวเดียวกัน —
 * ดูเหตุผลเต็มในหมายเหตุของ getRowNote ใน lib/bankReconcileManualMatch.ts */
export interface ReviewFlag {
  review_required: true;
  reviewed_by: string;
  reviewed_at: string; // ISO datetime
}

/** หมายเหตุอิสระของแถว Bank หนึ่งแถว (แถวที่ยังไม่ได้จับคู่ด้วยตนเอง) — แถวที่กลายเป็นส่วนหนึ่งของ MatchGroup
 * แล้วให้ใช้ MatchGroup.note แทน (ดู getRowNote) ไม่ใช้ทั้งสองพร้อมกัน */
export interface RowNote {
  note: string;
  updated_by: string;
  updated_at: string; // ISO datetime
}

/** ตัวเลือกค่าคลาดเคลื่อนของยอดเงินที่ยอมรับได้ตอนยืนยันจับคู่ด้วยตนเอง (แยกจาก DateToleranceOption ของเฟส 2
 * โดยสิ้นเชิง — คนละมิติ: อันนี้ควบคุม "ผลต่างยอดเงินที่ยอมให้ยืนยันได้โดยไม่ต้อง override" ส่วน Date Tolerance
 * ควบคุมเฉพาะการจับคู่อัตโนมัติเท่านั้น) ดู AMOUNT_TOLERANCE_VALUES ใน lib/bankReconcileManualMatchLogic.ts
 * สำหรับค่าตัวเลขจริงของแต่ละตัวเลือก และ DEFAULT_AMOUNT_TOLERANCE = 'zero' ตามสเปกตรงๆ ("Default: 0.00") */
export type AmountToleranceOption = 'zero' | 'small' | 'one' | 'custom';

/** แถวผลลัพธ์ตัวเต็มที่ UI ของเฟส 3 ใช้แสดงจริง — ทับซ้อน BankMatchResult ของเฟส 2 ด้วยข้อมูลจับคู่ด้วยตนเอง
 * (matchGroup/reviewFlag/note) โดยตั้งใจให้ทุกฟิลด์ที่ชื่อ/ชนิดตรงกับ BankMatchResult ทุกประการ (bank, status,
 * matchedGL, candidates, matchScore, amountDifference, dateDifferenceDays, matchReason) เพื่อให้ ReconcileRow
 * หนึ่งค่ายังส่งเข้า component เดิมของเฟส 2 ที่รับ props ชนิด BankMatchResult ได้ตรงๆ ผ่าน structural typing
 * โดยไม่ต้องแก้ไข component เดิมเหล่านั้นเลย (เช่น BankReconcileCandidatesModal) — matchedGLRows คือฟิลด์ใหม่
 * เดียวที่เพิ่มเข้ามาสำหรับกรณีจับคู่แบบกลุ่ม (matchedGL เดี่ยวไม่พอสื่อความหมายเมื่อมี GL มากกว่า 1 แถว) */
export interface ReconcileRow {
  bank: MatchBankRow;
  status: BankRowMatchStatus;
  matchedGL: MatchGLRow | null;
  matchedGLRows: MatchGLRow[];
  candidates: MatchGLRow[];
  matchScore: number | null;
  amountDifference: number | null;
  dateDifferenceDays: number | null;
  matchReason: string;
  matchGroup: MatchGroup | null;
  reviewFlag: ReviewFlag | null;
  note: RowNote | null;
}
