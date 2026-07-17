/**
 * ประเภทข้อมูลของฟีเจอร์ "Bank Reconcile" — เขียนใหม่ทั้งหมด 2026-07-17 ตามสเปก "REBUILD Bank Reconcile
 * module from scratch" แทนที่ระบบเดิม (เฟส 1-4 เดิม: match score, date tolerance, manual match groups,
 * one-to-many/many-to-one, ambiguous/pending_review ฯลฯ) ด้วยกติกาที่ง่ายกว่ามาก:
 *
 *   จับคู่รายการด้วย "ทิศทางธุรกรรม" (รับเงิน/จ่ายเงิน) + "จำนวนเงิน" เท่านั้น — ไม่มีวันที่/เลขที่อ้างอิง/
 *   รายละเอียดเป็นเงื่อนไข ไม่มีคะแนน ไม่มี tolerance ไม่มีการจับคู่ด้วยตนเองแบบกลุ่ม
 *
 * ไฟล์นี้แทนที่ types/bankReconcile.ts เดิมทั้งไฟล์ (ของเดิมมี MatchStatus 9 ค่า/MatchBankRow/MatchGLRow/
 * BankMatchResult/MatchGroup/ReviewFlag/RowNote/ReconcileRow ฯลฯ ทั้งหมดถูกลบทิ้ง ไม่ใช้ต่อ) — ดูเหตุผลและ
 * รายการไฟล์ที่ถูกลบทั้งหมดใน FINAL SUMMARY ที่ส่งมอบพร้อมงานนี้
 */

/* ============================== ทิศทางธุรกรรม ============================== */

/** ทิศทางธุรกรรมมีแค่ 2 ค่าตามสเปกเป๊ะ — income = รับเงิน (เงินเข้าฝั่ง Bank / ฝั่งรับเงินของ GL),
 * payment = จ่ายเงิน (เงินออกฝั่ง Bank / ฝั่งจ่ายเงินของ GL) ห้ามเทียบข้ามทิศทางกันเด็ดขาด */
export type TransactionDirection = 'income' | 'payment';

export const TRANSACTION_DIRECTION_LABELS: Record<TransactionDirection, string> = {
  income: 'รับเงิน',
  payment: 'จ่ายเงิน',
};

/** สี badge ของทิศทางธุรกรรม — ใช้ token สีเดิมของระบบ (ไม่เพิ่ม token สีใหม่) */
export const TRANSACTION_DIRECTION_BADGE_CLASS: Record<TransactionDirection, string> = {
  income: 'bg-success/15 text-success',
  payment: 'bg-primary/15 text-primary',
};

/* ============================== ไฟล์ต้นฉบับ ============================== */

/** ประเภทไฟล์ต้นฉบับที่รองรับ 3 แบบ — Excel(.xlsx/.xls)/CSV ใช้ตัวอ่านเดิม (lib/bankReconcileParse.ts,
 * ไลบรารี xlsx) PDF ใช้ตัวอ่านใหม่ (lib/bankReconcilePdfParse.ts, ไลบรารี pdfjs-dist) — ทั้งสามประเภทแปลง
 * เป็น RawFileTable รูปแบบเดียวกันเสมอก่อนเข้าสู่ขั้นตอนจับคู่คอลัมน์ (เพื่อให้ใช้ UI จับคู่คอลัมน์ชุดเดียวกัน
 * ได้กับทั้งสามประเภทไฟล์ ไม่ต้องแยกโค้ด) */
export type SourceFileType = 'excel' | 'csv' | 'pdf';

export const SOURCE_FILE_TYPE_LABELS: Record<SourceFileType, string> = {
  excel: 'Excel',
  csv: 'CSV',
  pdf: 'PDF',
};

/** ตารางดิบที่อ่านได้จากไฟล์ต้นฉบับ (Excel/CSV) หรือ "แปลงมาจาก" ไฟล์ PDF (แต่ละบรรทัดที่ตรวจพบในหน้ากลาย
 * เป็นหนึ่งแถว) — แถวแรกสุดถูกแยกออกมาเป็น headers เสมอ ส่วน rows คือแถวข้อมูลที่เหลือ (ยังไม่กรองแถวว่างออก)
 * PDF ที่ไม่มีหัวคอลัมน์ชัดเจนจะได้ headers เป็นสตริงว่างทั้งหมด ("(คอลัมน์ N)" ใน UI จับคู่คอลัมน์จะรับช่วง
 * แสดงแทนให้เอง — ดู components/BankReconcileColumnMapping.tsx ที่ไม่ต้องแก้ไขจุดนี้เลย) */
export interface RawFileTable {
  headers: string[];
  rows: unknown[][];
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

/** สถานะของไฟล์หนึ่งไฟล์ที่อัปโหลดเข้ามา (Bank Statement หรือ GL) */
export interface UploadedFileState {
  fileName: string;
  fileSizeBytes: number;
  sourceFileType: SourceFileType;
  table: RawFileTable;
  validation: FileValidationResult;
  rowCount: number;
  /** จำนวนหน้าของไฟล์ PDF เท่านั้น — null เสมอสำหรับ Excel/CSV */
  pageCount: number | null;
  /** true = ตรวจพบว่า PDF นี้เป็นเอกสารสแกน/ภาพล้วน (ไม่มี text layer ให้อ่าน) — แสดงคำเตือนตามสเปกเป๊ะ
   * (ดู lib/bankReconcilePdfParse.ts) false เสมอสำหรับ Excel/CSV และ PDF ที่มีข้อความให้เลือกได้ */
  isScannedPdf: boolean;
}

/* ============================== จับคู่คอลัมน์ ============================== */

/** ฟิลด์ที่ผู้ใช้จับคู่กับคอลัมน์ในไฟล์ Bank Statement — required: transactionDate/description/moneyIn/
 * moneyOut, optional: balance/accountNo (ตามสเปกส่วน "10. COLUMN MAPPING" เป๊ะ) */
export type BankColumnKey = 'transactionDate' | 'description' | 'moneyIn' | 'moneyOut' | 'balance' | 'accountNo';

/** ฟิลด์ที่ผู้ใช้จับคู่กับคอลัมน์ในไฟล์ GL จากระบบ Express — required: date/description/moneyIn/moneyOut,
 * optional: docNo/accountCode ตั้งใจใช้ชื่อคีย์ moneyIn/moneyOut ชุดเดียวกับ Bank (ไม่ใช้ debit/credit) เพราะ
 * ผู้ใช้เป็นผู้ระบุเองตรงๆ ว่าคอลัมน์ไหนคือ "ฝั่งรับเงิน" (=moneyIn) และ "ฝั่งจ่ายเงิน" (=moneyOut) ของ GL
 * ระบบไม่เดา/ไม่ตีความ debit/credit ทางบัญชีใดๆ ทั้งสิ้นตามสเปกที่ระบุไว้ตรงๆ ("Do not infer GL debit/credit
 * behavior without showing the mapping") การใช้ชื่อคีย์เดียวกับ Bank ยังทำให้ใช้ฟังก์ชัน normalize/resolve
 * ทิศทางตัวเดียวกันได้กับทั้งสองฝั่ง (ดู resolveDirectionAndAmount ใน lib/bankReconcileNormalize.ts) */
export type GLColumnKey = 'date' | 'description' | 'moneyIn' | 'moneyOut' | 'docNo' | 'accountCode';

/** ค่า = index ของคอลัมน์ใน RawFileTable.headers/rows ที่ผู้ใช้เลือกจับคู่ไว้ null = ยังไม่ได้จับคู่ (ทุกฟิลด์
 * เริ่มต้นเป็น null เสมอ ระบบไม่เดา/auto-map ให้) */
export type BankColumnMapping = Record<BankColumnKey, number | null>;
export type GLColumnMapping = Record<GLColumnKey, number | null>;

/* ============================== แถวข้อมูลหลัง normalize (ใช้ตั้งแต่ขั้นตอนพรีวิวไปจนถึงผลลัพธ์) ============================== */

/** สถานะข้อมูลของแถวหนึ่งแถวในขั้นตอนพรีวิว — valid = ผ่านการตรวจสอบ พร้อมกระทบยอด, invalid = มีปัญหาต้องแก้ไข
 * ก่อน (เช่น หาไม่ได้ว่าเป็นรับเงินหรือจ่ายเงิน, วันที่ผิดรูปแบบ), excluded = ผู้ใช้กดยกเว้นออกจากการกระทบยอด
 * ด้วยตนเอง (ไม่ใช่ error แต่เป็นการตัดสินใจของผู้ใช้ — กู้คืนได้เสมอ) */
export type RowDataStatus = 'valid' | 'invalid' | 'excluded';

export const ROW_DATA_STATUS_LABELS: Record<RowDataStatus, string> = {
  valid: 'ถูกต้อง',
  invalid: 'ไม่ถูกต้อง',
  excluded: 'ถูกยกเว้น',
};

export const ROW_DATA_STATUS_BADGE_CLASS: Record<RowDataStatus, string> = {
  valid: 'bg-success/15 text-success',
  invalid: 'bg-danger/15 text-danger',
  excluded: 'bg-page-bg text-text-sub border border-border',
};

/** แถว Bank Statement หลัง normalize แล้ว — ใช้ตัวเดียวกันตั้งแต่ขั้นตอนพรีวิว/แก้ไขไปจนถึงผลลัพธ์กระทบยอด
 * และการบันทึกลงฐานข้อมูล (ไม่มีชนิดข้อมูล "draft" แยกต่างหากอีกชั้นเหมือนโมเดลเดิม — เจตนาให้เรียบง่ายตามที่
 * สเปกต้องการ "Create a new and simpler reconciliation workflow") direction เป็น null ได้เฉพาะตอนที่ระบบหา
 * ทิศทางจากคอลัมน์ที่จับคู่ไว้ไม่ได้เท่านั้น (เช่น ทั้งเงินเข้า/เงินออกเป็น 0 พร้อมกัน หรือมีค่าทั้งคู่พร้อมกัน)
 * แถวแบบนี้จะถูกทำเครื่องหมาย errors ไม่ว่างเสมอ (status = invalid) — ดู isRowUsable() ท้ายไฟล์นี้ */
export interface BankRow {
  id: string; // `bank-${rowNumber}` เสมอตอนอัปโหลดสดๆ (เปลี่ยนเป็น uuid ถาวรตอนบันทึกลงฐานข้อมูลครั้งแรก)
  rowNumber: number; // เลขแถวจริงในไฟล์ต้นฉบับ (แถว 1 = header)
  date: string | null; // ISO YYYY-MM-DD
  description: string;
  /** ค่าที่ parse ได้จากคอลัมน์ "เงินเข้า" ที่จับคู่ไว้ตรงๆ (ขนาดเสมอ ไม่ติดลบ) — เก็บแยกจาก amount/direction
   * ที่ resolve แล้ว เพื่อให้ขั้นตอนพรีวิว (components/BankReconcilePreview.tsx) แสดงคอลัมน์ "รับเงิน"/"จ่ายเงิน"
   * ตามค่าที่อ่านได้จริงคู่กับผลลัพธ์ที่ระบบสรุปได้ — สำคัญมากสำหรับแถว invalid ที่มีค่าทั้งสองคอลัมน์พร้อมกัน
   * (ไม่มี direction/amount ที่ resolve ได้ ถ้าไม่เก็บสองค่านี้แยกไว้ ผู้ใช้จะไม่เห็นเลยว่าปัญหาอยู่ตรงไหน) */
  moneyInRaw: number;
  moneyOutRaw: number;
  direction: TransactionDirection | null;
  amount: number; // ค่าบวกเสมอ (ขนาดของธุรกรรม ไม่ใช่ค่าที่มีเครื่องหมาย)
  balance: number | null; // ยอดคงเหลือ — optional ตามสเปก
  accountNo: string; // เลขที่บัญชี — optional ตามสเปก ค่าเริ่มต้น ''
  rawRow: unknown[]; // แถวดิบต้นฉบับ เก็บไว้เสมอเพื่อการตรวจสอบย้อนหลัง (audit) ไม่เคยถูกแก้ไข
  excluded: boolean;
  errors: string[]; // ข้อความ error ภาษาไทย ว่างเปล่า = ไม่มีปัญหา
}

/** แถว GL หลัง normalize แล้ว — โครงสร้างขนานกับ BankRow ทุกประการ ต่างแค่ docNo/accountCode แทน
 * balance/accountNo (ตามฟิลด์ optional ของ GL ในสเปก) */
export interface GLRow {
  id: string; // `gl-${rowNumber}`
  rowNumber: number;
  date: string | null;
  description: string;
  /** ค่าที่ parse ได้จากคอลัมน์ "ฝั่งรับเงิน"/"ฝั่งจ่ายเงิน" ที่จับคู่ไว้ตรงๆ — ดูคำอธิบายเดียวกันที่
   * BankRow.moneyInRaw/moneyOutRaw ด้านบน (แนวคิดเดียวกันเป๊ะ) */
  moneyInRaw: number;
  moneyOutRaw: number;
  direction: TransactionDirection | null;
  amount: number;
  docNo: string; // เลขที่เอกสาร — optional
  accountCode: string; // รหัสบัญชี — optional
  rawRow: unknown[];
  excluded: boolean;
  errors: string[];
}

/** แถวพร้อมกระทบยอดหรือยัง — ต้องไม่ถูกยกเว้น, ไม่มี error ค้าง, และหาทิศทางได้แล้วเท่านั้น ใช้เป็นเกณฑ์เดียว
 * ทั้งตอนเปิดปุ่ม "เริ่มกระทบยอด" (ดู lib/bankReconcileValidation.ts) และตอนกรองแถวก่อนส่งเข้าเครื่องมือจับคู่
 * (ดู lib/bankReconcileMatching.ts) — เกณฑ์เดียวไม่ซ้ำซ้อนกัน ป้องกันไม่ให้สองที่ตัดสินไม่ตรงกัน */
export function isRowUsable(row: Pick<BankRow | GLRow, 'excluded' | 'errors' | 'direction'>): boolean {
  return !row.excluded && row.errors.length === 0 && row.direction !== null;
}

/* ============================== ผลการกระทบยอด ============================== */

/** สถานะผลกระทบยอดของแถว Bank — 2 ค่าเท่านั้นตามสเปกเป๊ะ (ต่างจากโมเดลเดิมที่มี 9 ค่า) */
export type BankMatchStatus = 'found_in_gl' | 'not_found_in_gl';

export const BANK_MATCH_STATUS_LABELS: Record<BankMatchStatus, string> = {
  found_in_gl: 'พบใน GL',
  not_found_in_gl: 'ไม่พบใน GL',
};

/** สีเขียว = พบ (found_in_gl), สีแดง = ไม่พบ (not_found_in_gl) ตามสเปกเป๊ะ */
export const BANK_MATCH_STATUS_BADGE_CLASS: Record<BankMatchStatus, string> = {
  found_in_gl: 'bg-success/15 text-success',
  not_found_in_gl: 'bg-danger/15 text-danger',
};

/** สถานะแถว GL ที่เหลือค้างหลังจับคู่ทั้งหมดแล้ว (ไม่เคยถูกเลือกเป็น matchedGL ของ Bank แถวใดเลย) — มีค่าเดียว
 * เก็บเป็น union สมาชิกเดียวไว้ (ไม่ใช่ boolean เฉยๆ) เพื่อให้ต่อยอด label/badge map แบบเดียวกับที่อื่นได้ */
export type GLOnlyStatus = 'not_found_in_bank';

export const GL_ONLY_STATUS_LABEL = 'มีใน GL แต่ไม่มีใน Bank';
/** สีส้ม/ม่วง ตามสเปกที่อนุญาตทั้งสองสี (Orange or Purple) — เลือกม่วงเพื่อแยกจากสีส้มที่ยังไม่ได้ใช้ในฟีเจอร์
 * นี้เลย ลดโอกาสสับสนกับสีเตือนอื่น (warning = ส้ม/เหลืองใช้อยู่แล้วในส่วนอื่นของระบบ) */
export const GL_ONLY_BADGE_CLASS = 'bg-purple-100 text-purple-700';

/** ผลการจับคู่ของแถว Bank หนึ่งแถว — หน่วยหลักที่ตารางผลลัพธ์ใช้แสดง ตารางเป็น Bank-based เสมอ ทุกแถว Bank ที่
 * ผ่านเข้าสู่การกระทบยอด (isRowUsable) ต้องมีผลลัพธ์ของตัวเองเสมอ 1 รายการ ไม่ว่าจะจับคู่ได้หรือไม่ก็ตาม
 * (ตามสเปก "Every Bank Statement transaction must remain visible in the result") */
export interface BankReconcileResultRow {
  bank: BankRow;
  status: BankMatchStatus;
  matchedGL: GLRow | null; // มีค่าเฉพาะ found_in_gl เท่านั้น
  /** ผลต่าง = bank.amount - (matchedGL?.amount ?? 0) — เท่ากับ 0.00 เสมอสำหรับแถว found_in_gl โดยธรรมชาติ
   * (เงื่อนไขจับคู่บังคับให้ยอดเงินตรงกันเป๊ะอยู่แล้ว ไม่มี tolerance) ยังคงคำนวณ+เก็บไว้แสดงในตารางตามสเปก
   * ส่วน "15. PRIMARY RESULT TABLE" ตรงๆ แทนที่จะ hardcode 0.00 ไว้เฉยๆ เผื่ออนาคตมีคนอยากรู้ค่าจริง */
  difference: number;
}

/** แถว GL ที่เหลือค้างหลังจับคู่ทั้งหมดแล้ว */
export interface GLOnlyRow {
  gl: GLRow;
  status: GLOnlyStatus;
}

/** ผลลัพธ์รวมจากการรันเครื่องมือจับคู่ครั้งหนึ่งๆ — bankResults ยาวเท่ากับจำนวนแถว Bank ที่ isRowUsable เสมอ
 * (เรียงลำดับเดิมตามไฟล์ต้นฉบับเป๊ะ ตามสเปกส่วน "7. MATCHING ORDER" ข้อสุดท้าย) glOnlyResults คือ GL ที่เหลือ
 * ใช้งานได้ (isRowUsable) แต่ไม่ถูกใช้เลย */
export interface ReconcileMatchOutput {
  bankResults: BankReconcileResultRow[];
  glOnlyResults: GLOnlyRow[];
}

/* ============================== หมายเหตุ/ทำเครื่องหมายตรวจสอบ (ส่วน "17. REVIEW WORKFLOW") ============================== */

/** การทำเครื่องหมายตรวจสอบของแถว Bank ที่ "ไม่พบใน GL" — ธงที่ผู้ใช้ตั้งเอง ไม่มีผลต่อผลกระทบยอดใดๆ ทั้งสิ้น
 * ตามสเปก "Do not allow these flags to change the reconciliation match result" ตรงๆ */
export interface BankReviewFlags {
  needsGlEntry: boolean; // ทำเครื่องหมายว่าต้องบันทึก GL เพิ่ม
  reviewed: boolean; // ทำเครื่องหมายว่าตรวจสอบแล้ว
  reviewNote: string; // หมายเหตุอิสระ ค่าเริ่มต้น ''
}

/** การทำเครื่องหมายตรวจสอบของแถว GL ที่ "มีใน GL แต่ไม่มีใน Bank" — ขนานกับ BankReviewFlags ต่างแค่ชื่อธงแรก */
export interface GLReviewFlags {
  needsGlReview: boolean; // ทำเครื่องหมายว่าต้องตรวจสอบ GL
  reviewed: boolean;
  reviewNote: string;
}

export const DEFAULT_BANK_REVIEW_FLAGS: BankReviewFlags = { needsGlEntry: false, reviewed: false, reviewNote: '' };
export const DEFAULT_GL_REVIEW_FLAGS: GLReviewFlags = { needsGlReview: false, reviewed: false, reviewNote: '' };
