import { DEFAULT_BANK_REVIEW_FLAGS, DEFAULT_GL_REVIEW_FLAGS } from '@/types/bankReconcile';
import type { BankReviewFlags, BankRow, GLReviewFlags, GLRow } from '@/types/bankReconcile';
import type { BankTransactionDbRow, GLTransactionDbRow } from '@/types/bankReconcileSession';

/**
 * ฟังก์ชัน pure ล้วนๆ แปลง BankRow/GLRow + ธงตรวจสอบ ไปมาระหว่างรูปแบบในหน่วยความจำกับ payload/แถว
 * ฐานข้อมูล — เขียนใหม่ทั้งไฟล์ 2026-07-17 แทนที่ไฟล์เดิม (ที่มี regenerateAllIds/remapRecordKeys/
 * bankIdMap สำหรับโมเดล match group เดิม) ไม่มี logic remap id ใดๆ หลงเหลืออยู่เลย เพราะโมเดลใหม่ไม่มีตาราง
 * ลูกอื่นที่อ้างอิง id ของแถว Bank/GL ด้วย foreign key (ดูหมายเหตุยาวที่หัวไฟล์ types/bankReconcileSession.ts)
 *
 * แยกจาก lib/bankReconcileSessionApi.ts (ชั้นเรียก Supabase จริง) เพื่อให้ทดสอบด้วย unit test ธรรมดาได้โดย
 * ไม่ต้อง mock ฐานข้อมูล ตามธรรมเนียมเดียวกับ lib/bankReconcileKpi.ts
 */

/** แปลง BankRow หนึ่งแถว + ธงตรวจสอบของแถวนั้น เป็น payload หนึ่ง object พร้อมส่งเข้า
 * supabase.rpc('save_bank_reconcile_session', ...) เป็นสมาชิกของ array p_bank_transactions — id ที่ส่งไป
 * เป็นได้ทั้ง id ชั่วคราว ("bank-N") หรือ uuid ถาวรเดิม (ถ้าโหลดมาจากฐานข้อมูล) แต่ฟังก์ชันฝั่งฐานข้อมูล
 * (save_bank_reconcile_session) ไม่ใช้ค่านี้เลย — สร้าง uuid ใหม่ให้ทุกแถวเสมอผ่าน gen_random_uuid() default
 * ของคอลัมน์ (full-snapshot replace: ลบแถวเดิมทั้งหมดของ session แล้วแทรกใหม่ทุกครั้ง ดูหมายเหตุที่
 * supabase/migration_005_bank_reconcile.sql) ฟิลด์ id ในนี้จึงมีไว้เผื่ออนาคตเท่านั้น ไม่ถูกใช้งานจริงตอนนี้ */
export function buildBankTransactionPayload(row: BankRow, flags: BankReviewFlags | undefined) {
  const f = flags ?? DEFAULT_BANK_REVIEW_FLAGS;
  return {
    row_number: row.rowNumber,
    transaction_date: row.date,
    description: row.description,
    money_in: row.moneyInRaw,
    money_out: row.moneyOutRaw,
    direction: row.direction,
    amount: row.amount,
    balance: row.balance,
    account_no: row.accountNo,
    raw_row: row.rawRow,
    excluded: row.excluded,
    row_errors: row.errors,
    needs_gl_entry: f.needsGlEntry,
    reviewed: f.reviewed,
    review_note: f.reviewNote,
  };
}

export function buildGLTransactionPayload(row: GLRow, flags: GLReviewFlags | undefined) {
  const f = flags ?? DEFAULT_GL_REVIEW_FLAGS;
  return {
    row_number: row.rowNumber,
    transaction_date: row.date,
    description: row.description,
    money_in: row.moneyInRaw,
    money_out: row.moneyOutRaw,
    direction: row.direction,
    amount: row.amount,
    doc_no: row.docNo,
    account_code: row.accountCode,
    raw_row: row.rawRow,
    excluded: row.excluded,
    row_errors: row.errors,
    needs_gl_review: f.needsGlReview,
    reviewed: f.reviewed,
    review_note: f.reviewNote,
  };
}

/** แปลงแถวฐานข้อมูล (โหลดกลับมาแล้ว) เป็น BankRow ในหน่วยความจำ — ใช้ id ของแถวฐานข้อมูลจริง (uuid ถาวร)
 * เป็น BankRow.id ตรงๆ (ไม่ใช่ "bank-N" อีกต่อไป เพราะโหลดมาจากฐานข้อมูลแล้ว ไม่ใช่เพิ่งอัปโหลดสดๆ) */
export function mapDbRowToBankRow(row: BankTransactionDbRow): BankRow {
  return {
    id: row.id,
    rowNumber: row.row_number,
    date: row.transaction_date,
    description: row.description,
    moneyInRaw: row.money_in,
    moneyOutRaw: row.money_out,
    direction: row.direction,
    amount: row.amount,
    balance: row.balance,
    accountNo: row.account_no,
    rawRow: row.raw_row,
    excluded: row.excluded,
    errors: row.row_errors,
  };
}

export function mapDbRowToGLRow(row: GLTransactionDbRow): GLRow {
  return {
    id: row.id,
    rowNumber: row.row_number,
    date: row.transaction_date,
    description: row.description,
    moneyInRaw: row.money_in,
    moneyOutRaw: row.money_out,
    direction: row.direction,
    amount: row.amount,
    docNo: row.doc_no,
    accountCode: row.account_code,
    rawRow: row.raw_row,
    excluded: row.excluded,
    errors: row.row_errors,
  };
}

export function extractBankReviewFlags(row: BankTransactionDbRow): BankReviewFlags {
  return { needsGlEntry: row.needs_gl_entry, reviewed: row.reviewed, reviewNote: row.review_note };
}

export function extractGLReviewFlags(row: GLTransactionDbRow): GLReviewFlags {
  return { needsGlReview: row.needs_gl_review, reviewed: row.reviewed, reviewNote: row.review_note };
}

/** โหลดแถวฐานข้อมูลทั้งชุดของ session หนึ่งรอบ กลับมาเป็น bankRows/glRows/bankReviewFlags/glReviewFlags
 * ที่พร้อมใช้กับ useState lazy initializer ของ components/BankReconcileResults.tsx ตรงๆ — สร้างทั้งสี่ค่า
 * จากแถวฐานข้อมูลชุดเดียวกันในรอบเดียว (BankRow.id ที่ได้ = key ของ bankReviewFlags ที่ได้เสมอโดยธรรมชาติ
 * ไม่มีขั้นตอน remap แยกต่างหากเหมือนโมเดลเดิม) */
export function mapDbRowsToSessionCore(bankDbRows: BankTransactionDbRow[], glDbRows: GLTransactionDbRow[]) {
  const bankRows = bankDbRows.map(mapDbRowToBankRow).sort((a, b) => a.rowNumber - b.rowNumber);
  const glRows = glDbRows.map(mapDbRowToGLRow).sort((a, b) => a.rowNumber - b.rowNumber);

  const bankReviewFlags: Record<string, BankReviewFlags> = {};
  for (const row of bankDbRows) bankReviewFlags[row.id] = extractBankReviewFlags(row);

  const glReviewFlags: Record<string, GLReviewFlags> = {};
  for (const row of glDbRows) glReviewFlags[row.id] = extractGLReviewFlags(row);

  return { bankRows, glRows, bankReviewFlags, glReviewFlags };
}
