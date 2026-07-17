/**
 * ประเภทข้อมูลของฟีเจอร์ "Bank Reconcile" เฟส 4 (บันทึกรอบกระทบยอด + ประวัติ + Export) — เพิ่มเข้ามา 2026-07-16
 *
 * เฟสนี้เป็นเฟสแรกของ Bank Reconcile ที่เชื่อมต่อ Supabase จริง (เฟส 1-3 เป็น client-side ล้วนๆ ในหน่วยความจำ
 * เบราว์เซอร์เท่านั้น) — ดู lib/bankReconcileSessionApi.ts สำหรับฟังก์ชันที่เรียก Supabase จริง และ
 * supabase/migration_005_bank_reconcile.sql สำหรับโครงสร้างตาราง 6 ตารางใหม่ทั้งหมด
 *
 * หลักการสำคัญที่สุด: ชนิดข้อมูลของเฟส 1-3 (MatchBankRow, MatchGLRow, MatchGroup, ReviewFlag, RowNote,
 * ReconcileRow, ...) ใน types/bankReconcile.ts ไม่ถูกแก้ไขเลยแม้แต่ฟิลด์เดียวในเฟสนี้ — ไฟล์นี้เป็นชั้น
 * เพิ่มเติมสำหรับ "รอบกระทบยอด" (session) ที่ครอบข้อมูลเดิมไว้อีกที เพื่อบันทึก/โหลดกลับจากฐานข้อมูลเท่านั้น
 * ชนิดข้อมูลเดิมของเฟส 1-3 ยังคงเป็น "แหล่งความจริง" ของหน้าจอผลลัพธ์เหมือนเดิมทุกประการ
 */

import type {
  AmountToleranceOption,
  DateToleranceOption,
  MatchBankRow,
  MatchGLRow,
  MatchGroup,
  ReconcileRow,
  ReviewFlag,
  RowNote,
} from './bankReconcile';

/* ============================== สถานะรอบกระทบยอด (§1) ============================== */

/** สถานะของรอบกระทบยอด 5 ค่าตามสเปกเป๊ะ */
export type ReconcileSessionStatus = 'draft' | 'in_progress' | 'completed' | 'reopened' | 'cancelled';

export const RECONCILE_SESSION_STATUS_LABELS: Record<ReconcileSessionStatus, string> = {
  draft: 'แบบร่าง',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสมบูรณ์',
  reopened: 'เปิดใหม่',
  cancelled: 'ยกเลิก',
};

/** สี badge ของสถานะรอบกระทบยอด — ใช้ token สีเดิมของระบบทั้งหมด (ดูเหตุผลเดียวกับ MATCH_STATUS_BADGE_CLASS
 * ใน lib/bankReconcileMatchLogic.ts ที่เลือกไม่เพิ่ม token สีใหม่ใน globals.css) */
export const RECONCILE_SESSION_STATUS_BADGE_CLASS: Record<ReconcileSessionStatus, string> = {
  draft: 'bg-page-bg text-text-sub border border-border',
  in_progress: 'bg-primary/15 text-primary',
  completed: 'bg-success/15 text-success',
  reopened: 'bg-warning/15 text-warning',
  cancelled: 'bg-danger/15 text-danger',
};

/** แถวของตาราง public.bank_reconcile_sessions ในฐานข้อมูลจริง — ฟิลด์ตรงตามสเปกส่วน "1. RECONCILIATION
 * SESSION" ทุกตัว บวกฟิลด์เสริมที่จำเป็นสำหรับฟีเจอร์อื่นในสเปกเดียวกันแต่ไม่ได้อยู่ในลิสต์ฟิลด์หลัก (ระบุที่มา
 * ไว้ในคอมเมนต์ทุกฟิลด์เสริม): completion_note (บังคับกรอกตามเงื่อนไขในส่วน "9. COMPLETION"),
 * reopened_by/reopened_by_email/reopened_at/reopen_reason (ระบุตรงๆ ในส่วน "11. REOPEN" ว่าต้องเก็บ),
 * deleted_at (soft delete ตามที่ส่วน "6. SESSION LIST" ขอ "prefer soft delete" — แยกจาก status='cancelled'
 * โดยเจตนา เพราะ "ยกเลิก" กับ "ลบ" เป็นสองแอ็กชันที่ต่างกันตามสเปก) */
export interface ReconcileSession {
  id: string;
  session_name: string;
  bank_account_no: string | null;
  bank_name: string | null;
  period_start: string | null; // ISO date (YYYY-MM-DD)
  period_end: string | null;
  bank_file_name: string;
  gl_file_name: string;
  bank_row_count: number;
  gl_row_count: number;
  matched_count: number;
  suggested_count: number;
  manual_match_count: number;
  review_count: number;
  unmatched_bank_count: number;
  unmatched_gl_count: number;
  bank_total: number;
  gl_total: number;
  matched_bank_total: number;
  matched_gl_total: number;
  unmatched_bank_total: number;
  unmatched_gl_total: number;
  net_difference: number;
  date_tolerance_days: number;
  amount_tolerance: number;
  status: ReconcileSessionStatus;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string; // ISO datetime
  updated_by: string | null;
  updated_by_email: string | null;
  updated_at: string;
  completed_by: string | null;
  completed_by_email: string | null;
  completed_at: string | null;
  completion_note: string | null;
  reopened_by: string | null;
  reopened_by_email: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  deleted_at: string | null;
}

/* ============================== ผลลัพธ์การโหลด/บันทึกรอบกระทบยอด ============================== */

/** ข้อมูลครบชุดของรอบกระทบยอดหนึ่งรอบ หลังโหลดจากฐานข้อมูล — แปลงกลับเป็นชนิดข้อมูลเดิมของเฟส 1-3 แล้วทุกตัว
 * (MatchBankRow[]/MatchGLRow[]/MatchGroup[]/ReviewFlag/RowNote) เพื่อให้ BankReconcileResults.tsx ใช้ต่อได้
 * ทันทีผ่าน useState lazy initializer โดยไม่ต้องรู้เลยว่าข้อมูลมาจากไฟล์อัปโหลดสดๆ หรือโหลดจากฐานข้อมูลเก่า
 * — ดู lib/bankReconcileSessionMapping.ts สำหรับฟังก์ชันแปลงไป-กลับทั้งหมด */
export interface LoadedSessionData {
  session: ReconcileSession;
  matchBankRows: MatchBankRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  reviewFlags: Record<string, ReviewFlag>;
  notes: Record<string, RowNote>;
  dateTolerance: DateToleranceOption;
  amountToleranceOption: AmountToleranceOption;
  customAmountTolerance: number;
}

/** ผู้กระทำ (ใช้แทน session.user จาก useAuth() เสมอ) — รูปแบบเดียวกับ createdBy ของ lib/invoiceApi.ts/
 * lib/contactApi.ts (id + email คู่กัน) เพื่อเก็บทั้ง uuid อ้างอิง auth.users และอีเมลสำรองไว้แสดงผลแม้ผู้ใช้
 * คนนั้นถูกลบบัญชีไปแล้วภายหลัง (created_by ... on delete set null แต่ _email ยังอยู่เสมอ) */
export interface ReconcileSessionActor {
  id: string | null;
  email: string | null;
}

/** payload ที่ใช้บันทึกรอบกระทบยอดหนึ่งครั้ง (ทั้งตอนสร้างใหม่ครั้งแรกและตอน auto-save/บันทึกซ้ำ) — ส่งเข้า
 * saveReconcileSession() ใน lib/bankReconcileSessionApi.ts ตรงๆ เป็น "ภาพรวมทั้งหมด ณ ขณะนั้น" เสมอ (full
 * snapshot save — ดูเหตุผลที่ header ของ lib/bankReconcileSessionApi.ts) sessionId เป็น null แปลว่ายังไม่เคย
 * บันทึกมาก่อนเลย (สร้างแถวใหม่) ไม่ใช่ null แปลว่าบันทึกทับรอบเดิม — reconcileRows ใช้ ReconcileRow[] (ผลลัพธ์
 * ที่ผสาน bank+status+reviewFlag+note ไว้แล้วจาก mergeManualMatches ของเฟส 3) แทนที่จะแยก matchBankRows/
 * reviewFlags/notes เป็นคนละฟิลด์ เพราะ components/BankReconcileResults.tsx มี mergedOutput.rows แบบนี้พร้อม
 * ใช้อยู่แล้วเสมอ ไม่ต้องประกอบขึ้นใหม่ */
export interface SaveReconcileSessionInput {
  sessionId: string | null;
  sessionName: string;
  bankAccountNo: string | null;
  bankName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  bankFileName: string;
  glFileName: string;
  reconcileRows: ReconcileRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  dateToleranceDays: number;
  amountTolerance: number;
  status: ReconcileSessionStatus;
  actor: ReconcileSessionActor;
}

/** ผลลัพธ์การบันทึก — คืน session ล่าสุด + matchBankRows/matchGLRows/matchGroups ที่ผ่านการกำหนด id ถาวรแล้ว
 * (แถวใหม่ที่เพิ่งอัปโหลดจะได้ uuid ถาวรครั้งแรกตอนบันทึกนี้เอง — ดูหมายเหตุ "เสถียรภาพของ id" ใน
 * lib/bankReconcileSessionMapping.ts) ผู้เรียกต้อง setState ทับทั้งสามค่านี้ด้วยผลลัพธ์ที่ได้กลับมาเสมอ
 * ไม่เช่นนั้น id จะไม่ตรงกับที่บันทึกจริงตั้งแต่การบันทึกครั้งถัดไป */
export interface SaveReconcileSessionResult {
  session: ReconcileSession;
  matchBankRows: MatchBankRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  /** id เดิม ("bank-N") -> uuid ถาวรใหม่ ของแถว Bank ที่เพิ่งได้ uuid ถาวรครั้งแรกในการบันทึกนี้เท่านั้น
   * (ว่างเปล่าถ้าทุกแถวมี uuid ถาวรอยู่แล้วก่อนบันทึก) — ผู้เรียกต้องใช้ค่านี้รีแมป key ของ reviewFlags/notes
   * (Record ที่ key เป็น bank_row_id) ทันทีหลังบันทึกสำเร็จด้วย remapRecordKeys() จาก
   * lib/bankReconcileSessionMapping.ts เสมอ ไม่เช่นนั้นรายการตรวจสอบ/หมายเหตุที่เพิ่มไว้ก่อนบันทึกครั้งแรกจะ
   * หา row ของตัวเองไม่เจอเงียบๆ (ดูหมายเหตุยาวที่ BuildSessionSavePayloadResult.bankIdMap ในไฟล์เดียวกัน) */
  bankIdMap: Map<string, string>;
}

/* ============================== Audit Log (§12) ============================== */

/** ประเภทเหตุการณ์ที่บันทึกลง audit log — ครบ 15 ประเภทตามสเปกส่วน "12. AUDIT LOG" เป๊ะ ไม่ตัด/เพิ่ม
 * เก็บเป็น text ธรรมดาในฐานข้อมูล (ไม่ใช้ check constraint) เพื่อให้เพิ่มประเภทใหม่ในอนาคตได้โดยไม่ต้อง migrate
 * schema — บังคับชนิดที่ชั้น TypeScript นี้แทน */
export type ReconcileAuditActionType =
  | 'session_created'
  | 'file_uploaded'
  | 'mapping_saved'
  | 'auto_matching_completed'
  | 'manual_match_confirmed'
  | 'match_undone'
  | 'group_match_created'
  | 'note_added'
  | 'review_status_changed'
  | 'tolerance_changed'
  | 'session_completed'
  | 'session_reopened'
  | 'export_created'
  | 'session_cancelled'
  | 'session_deleted';

export const RECONCILE_AUDIT_ACTION_LABELS: Record<ReconcileAuditActionType, string> = {
  session_created: 'สร้างรอบกระทบยอด',
  file_uploaded: 'อัปโหลดไฟล์',
  mapping_saved: 'บันทึกการจับคู่คอลัมน์',
  auto_matching_completed: 'จับคู่รายการอัตโนมัติเสร็จสิ้น',
  manual_match_confirmed: 'ยืนยันการจับคู่ด้วยตนเอง',
  match_undone: 'ยกเลิกการจับคู่',
  group_match_created: 'สร้างกลุ่มจับคู่ใหม่',
  note_added: 'เพิ่ม/แก้ไขหมายเหตุ',
  review_status_changed: 'เปลี่ยนสถานะการตรวจสอบ',
  tolerance_changed: 'เปลี่ยนค่าคลาดเคลื่อน',
  session_completed: 'ปิดรอบกระทบยอด',
  session_reopened: 'เปิดรอบใหม่เพื่อแก้ไข',
  export_created: 'ส่งออกไฟล์',
  session_cancelled: 'ยกเลิกรอบกระทบยอด',
  session_deleted: 'ลบรอบกระทบยอด',
};

/** แถวของตาราง public.bank_reconcile_audit_logs — old_value/new_value เป็น snapshot ข้อมูลที่มีความหมายใน
 * ตัวเอง (เช่น {bank_description, bank_amount, source_row_number}) ไม่ใช่แค่ id อ้างอิงดิบๆ โดยเจตนา เพราะ
 * bank_transaction_id/gl_transaction_id ที่แท้จริงอาจเปลี่ยนไปทุกครั้งที่บันทึกทับ (full snapshot save
 * สร้าง uuid ใหม่ให้แถวที่ยังไม่เคยมี uuid ถาวรมาก่อนเท่านั้น — ดู lib/bankReconcileSessionMapping.ts) จึงต้อง
 * ให้ entity_id เป็นข้อมูล "อ้างอิงเพื่อการอ่าน" เท่านั้น ไม่ใช่ FK คุมความถูกต้องเชิงอ้างอิงจริง */
export interface ReconcileAuditLogEntry {
  id: string;
  session_id: string;
  action_type: ReconcileAuditActionType;
  entity_type: string | null;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
  action_note: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  performed_at: string;
}

/** input สร้างรายการ audit log ใหม่หนึ่งแถว — session_id/performed_at เติมให้อัตโนมัติใน
 * lib/bankReconcileSessionApi.ts เสมอ ผู้เรียกไม่ต้องส่งมา */
export interface AppendAuditLogInput {
  actionType: ReconcileAuditActionType;
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  actionNote?: string | null;
  actor: ReconcileSessionActor;
}

/* ============================== คำนวณใหม่ (§8) ============================== */

export type RecalculateMode = 'unmatched_only' | 'all_keep_manual' | 'clear_and_recalculate_all';

export const RECALCULATE_MODE_LABELS: Record<RecalculateMode, string> = {
  unmatched_only: 'คำนวณเฉพาะรายการที่ยังไม่จับคู่',
  all_keep_manual: 'คำนวณใหม่ทั้งหมดและเก็บ Manual Match',
  clear_and_recalculate_all: 'ล้างผลเดิมและคำนวณใหม่ทั้งหมด',
};

/* ============================== สถานะบันทึกอัตโนมัติ (§4) ============================== */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'กำลังบันทึก...',
  saved: 'บันทึกแล้ว',
  error: 'บันทึกไม่สำเร็จ',
};

/* ============================== Export (§13/§14) ============================== */

export type PdfReportMode = 'summary' | 'full';

export const PDF_REPORT_MODE_LABELS: Record<PdfReportMode, string> = {
  summary: 'รายงานสรุป',
  full: 'รายงานฉบับเต็ม',
};

/* ============================== การตรวจสอบก่อนปิดรอบ (§9) ============================== */

/** ผลตรวจสอบก่อนอนุญาตให้ปิดรอบกระทบยอด — blockingErrors ต้องว่างเปล่าเท่านั้นถึงจะกดปิดรอบได้ (ตรงข้ามกับ
 * warnings ที่อนุญาตให้ปิดได้แต่ต้องกดยืนยันซ้ำ) requiresNote บอกว่าต้องกรอกหมายเหตุการปิดรอบก่อนหรือไม่ */
export interface CompletionValidationResult {
  canComplete: boolean;
  blockingErrors: string[];
  warnings: string[];
  requiresNote: boolean;
}

/* ============================== แถวฐานข้อมูลดิบ (ใช้ภายใน lib/bankReconcileSessionMapping.ts เท่านั้น) ============================== */

/** โครงสร้าง normalized_data ของแถว Bank ในฐานข้อมูล — ตรงกับทุกฟิลด์ของ MatchBankRow ยกเว้น bank_row_id
 * (ใช้ id ของแถวฐานข้อมูลเองแทน) และ raw_bank_row (แยกเก็บในคอลัมน์ raw_data ต่างหากเสมอตามสเปก "Never
 * overwrite original imported values — store both raw_data and normalized_data") */
export type BankTransactionNormalizedData = Omit<MatchBankRow, 'bank_row_id' | 'raw_bank_row'>;

export interface BankTransactionDbRow {
  id: string;
  session_id: string;
  source_row_number: number;
  bank_transaction_date: string | null;
  bank_description: string;
  bank_money_in: number;
  bank_money_out: number;
  bank_amount: number;
  bank_balance: number;
  raw_data: unknown[];
  normalized_data: BankTransactionNormalizedData;
  reconcile_status: string;
  review_required: boolean;
  review_note: string | null;
  note_updated_by: string | null;
  note_updated_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type GLTransactionNormalizedData = Omit<MatchGLRow, 'gl_row_id' | 'raw_gl_row'>;

export interface GLTransactionDbRow {
  id: string;
  session_id: string;
  source_row_number: number;
  gl_date: string | null;
  gl_document_no: string;
  gl_description: string;
  gl_debit: number;
  gl_credit: number;
  gl_amount: number;
  raw_data: unknown[];
  normalized_data: GLTransactionNormalizedData;
  is_used: boolean;
  created_at: string;
}

export interface MatchGroupDbRow {
  id: string;
  session_id: string;
  match_type: MatchGroup['match_type'];
  bank_total: number;
  gl_total: number;
  amount_difference: number;
  match_score: number | null;
  match_reason: string | null;
  manual_match: boolean;
  status: MatchGroup['status'];
  note: string;
  matched_by: string;
  matched_at: string;
  created_at: string;
  updated_at: string;
}

export interface MatchGroupItemDbRow {
  id: string;
  session_id: string;
  match_group_id: string;
  transaction_type: 'bank' | 'gl';
  bank_transaction_id: string | null;
  gl_transaction_id: string | null;
  created_at: string;
}

/* ============================== KPI ที่คำนวณใหม่จากข้อมูลที่บันทึกจริง (§15) ============================== */

/** ผลการคำนวณ KPI/ผลต่างสุทธิใหม่ทั้งหมดจากข้อมูลรายการ/กลุ่มจับคู่โดยตรง (ไม่ใช้ค่าที่แคชไว้) — ดู
 * lib/bankReconcileKpi.ts สำหรับสูตรและฟังก์ชันคำนวณ ใช้ทั้งตอนบันทึก (เติมลง ReconcileSession) ตอนตรวจสอบ
 * ก่อนปิดรอบ (เทียบว่าค่าที่แสดงบนจอตรงกับที่คำนวณใหม่หรือไม่) และตอน export */
export interface ReconcileSessionKpi {
  bank_row_count: number;
  gl_row_count: number;
  matched_count: number;
  suggested_count: number;
  manual_match_count: number;
  review_count: number;
  unmatched_bank_count: number;
  unmatched_gl_count: number;
  bank_total: number;
  gl_total: number;
  matched_bank_total: number;
  matched_gl_total: number;
  unmatched_bank_total: number;
  unmatched_gl_total: number;
  net_difference: number;
}
