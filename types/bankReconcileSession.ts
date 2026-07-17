/**
 * ประเภทข้อมูลของ "รอบกระทบยอด" (การบันทึก/ประวัติ) — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild
 * โมดูล Bank Reconcile ทั้งโมดูลตามสเปก "REBUILD Bank Reconcile module from scratch"
 *
 * ต่างจากไฟล์เดิม (เฟส 4 เก่า) มาก เพราะโมเดลการจับคู่ใหม่เรียบง่ายกว่ามาก (ดู types/bankReconcile.ts):
 *   - ไม่มี MatchGroup/MatchGroupItem — การจับคู่คำนวณสดใหม่ทุกครั้งจาก bankRows+glRows ผ่าน
 *     runSimpleReconciliation() (lib/bankReconcileMatching.ts) เป็นฟังก์ชัน pure ที่เร็วมาก ไม่ต้อง cache/
 *     บันทึกผลจับคู่ลงฐานข้อมูลแยกต่างหากเลย — "ผลกระทบยอด" ไม่ใช่ข้อมูลที่ถูกบันทึก แต่เป็นข้อมูลที่ถูก
 *     "คำนวณ" จาก bankRows/glRows ที่บันทึกไว้เสมอ (ไม่มีความเสี่ยงข้อมูลล้าสมัย/ไม่ตรงกันแบบโมเดลเดิม)
 *   - ไม่มี audit log — สเปกใหม่ไม่ได้ร้องขอ audit log ที่ใดเลยทั้ง 24 ส่วน (ต่างจากสเปกเฟส 4 เดิมที่มีส่วน
 *     "12. AUDIT LOG" ชัดเจน) จึงตัดออกทั้งหมดเพื่อความเรียบง่ายตามที่สเปกต้องการ "a new and simpler
 *     reconciliation workflow" ตรงๆ
 *   - ไม่มี match score/date tolerance/amount tolerance — ไม่มีแนวคิดค่าคลาดเคลื่อนใดๆ ในโมเดลใหม่เลย
 *   - ไม่ต้องมีการ "remap id" ของแถวหลังบันทึกครั้งแรก (ต่างจากโมเดลเดิมที่ bankIdMap/remapRecordKeys ต้องมี
 *     เพราะ match_group_items อ้างอิง uuid ของแถวด้วย foreign key) — โมเดลใหม่ไม่มีตารางลูกที่อ้างอิง id ของ
 *     แถว Bank/GL เลย ธงตรวจสอบ (BankReviewFlags/GLReviewFlags) ถูกเก็บเป็นคอลัมน์ตรงบนแถวเดียวกันเลย ไม่ใช่
 *     Record แยกที่ผูกกับ id — จึง build ทั้ง BankRow[]/GLRow[] และ Record ของธงตรวจสอบจากแถวฐานข้อมูลชุด
 *     เดียวกันในรอบเดียวได้เลยตอนโหลด ไม่มีปัญหา id ไม่ตรงกันให้ต้องแก้เหมือนเดิม
 *
 * สถานะรอบกระทบยอดเหลือแค่ 2 ค่า (in_progress/completed) เป็น "ป้ายกำกับ" ล้วนๆ ไม่ใช่กลไกล็อกการแก้ไข — กด
 * "ทำเครื่องหมายว่าเสร็จสมบูรณ์"/"เปิดกลับมาแก้ไข" ได้อิสระโดยไม่ต้องกรอกเหตุผล/ผ่านการตรวจสอบเงื่อนไขใดๆ
 * (ตัดกลไก validateSessionCompletion + CompleteDialog/ReopenDialog แบบมีเงื่อนไขบังคับของโมเดลเดิมทิ้งทั้งหมด
 * เพราะสเปกใหม่ไม่ได้ร้องขอการล็อกรอบ/การตรวจสอบก่อนปิดรอบเลย — ดู FINAL SUMMARY ตอนส่งมอบสำหรับเหตุผลเต็ม)
 */

import type { BankReviewFlags, BankRow, GLReviewFlags, GLRow, SourceFileType } from './bankReconcile';

/* ============================== สถานะรอบกระทบยอด ============================== */

export type ReconcileSessionStatus = 'in_progress' | 'completed';

export const RECONCILE_SESSION_STATUS_LABELS: Record<ReconcileSessionStatus, string> = {
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสมบูรณ์',
};

export const RECONCILE_SESSION_STATUS_BADGE_CLASS: Record<ReconcileSessionStatus, string> = {
  in_progress: 'bg-primary/15 text-primary',
  completed: 'bg-success/15 text-success',
};

/** แถวของตาราง public.bank_reconcile_sessions — ฟิลด์ตรงตามสเปกส่วน "20. SAVE RECONCILIATION RUN" ทุกตัว
 * (session name, bank/gl file name, source file types, bank/gl row counts, found_count,
 * bank_not_found_count, gl_not_found_count, bank_income_total, bank_payment_total, gl_income_total,
 * gl_payment_total, income_difference, payment_difference, status, created_by, created_at, updated_at)
 * บวก completed_by/completed_by_email/completed_at (จำเป็นสำหรับแสดงประวัติการปิดรอบเมื่อกด "เปิดกลับมาแก้ไข"
 * — ไม่เขียนทับ/ลบทิ้งเมื่อเปิดรอบใหม่) และ deleted_at (soft delete สำหรับปุ่ม "ลบ" ในหน้ารายการ — เก็บ
 * ข้อมูลไว้เสมอ ไม่ลบจริง ป้องกันการลบข้อมูลบัญชีโดยไม่ตั้งใจ) */
export interface ReconcileSession {
  id: string;
  session_name: string;
  bank_file_name: string;
  gl_file_name: string;
  bank_source_file_type: SourceFileType;
  gl_source_file_type: SourceFileType;
  bank_row_count: number;
  gl_row_count: number;
  found_count: number;
  bank_not_found_count: number;
  gl_not_found_count: number;
  bank_income_total: number;
  bank_payment_total: number;
  gl_income_total: number;
  gl_payment_total: number;
  income_difference: number;
  payment_difference: number;
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
  deleted_at: string | null;
}

export interface ReconcileSessionActor {
  id: string | null;
  email: string | null;
}

/** ข้อมูลครบชุดของรอบกระทบยอดหนึ่งรอบหลังโหลดจากฐานข้อมูล — bankRows/glRows พร้อมส่งเข้า
 * runSimpleReconciliation() ตรงๆ ทันที (ไม่มีผลจับคู่ที่บันทึกไว้ให้โหลด เพราะคำนวณสดเสมอ) ธงตรวจสอบเป็น
 * Record คีย์ด้วย BankRow.id/GLRow.id ของชุดที่เพิ่งโหลดมานี้เอง (id จากฐานข้อมูลจริงเสมอตอนโหลด ไม่ใช่ id
 * ชั่วคราวแบบ "bank-N" — ดูหมายเหตุที่ mapDbRowToBankRow ใน lib/bankReconcileSessionMapping.ts) */
export interface LoadedSessionData {
  session: ReconcileSession;
  bankRows: BankRow[];
  glRows: GLRow[];
  bankReviewFlags: Record<string, BankReviewFlags>;
  glReviewFlags: Record<string, GLReviewFlags>;
}

/** payload บันทึกรอบกระทบยอดหนึ่งครั้ง (ทั้งสร้างใหม่ครั้งแรกและบันทึกทับ/auto-save ครั้งถัดไป) — เป็น
 * "ภาพรวมทั้งหมด ณ ขณะนั้น" เสมอ (full-snapshot save เหมือนโมเดลเดิม) sessionId เป็น null แปลว่ายังไม่เคย
 * บันทึกมาก่อน (สร้างแถวใหม่) */
export interface SaveReconcileSessionInput {
  sessionId: string | null;
  sessionName: string;
  bankFileName: string;
  glFileName: string;
  bankSourceFileType: SourceFileType;
  glSourceFileType: SourceFileType;
  bankRows: BankRow[];
  glRows: GLRow[];
  bankReviewFlags: Record<string, BankReviewFlags>;
  glReviewFlags: Record<string, GLReviewFlags>;
  status: ReconcileSessionStatus;
  actor: ReconcileSessionActor;
}

/** ผลลัพธ์การบันทึก — bankRows/glRows/ธงตรวจสอบที่คืนมาใช้ id ถาวร (uuid จริงจากฐานข้อมูล) แทน id ชั่วคราว
 * ที่ส่งเข้าไปเสมอ ผู้เรียกต้อง setState ทับด้วยค่านี้เพื่อให้การแก้ไข/บันทึกครั้งถัดไปอ้างอิง id ที่ถูกต้อง
 * (ไม่มี "bankIdMap" แยกต่างหากแบบโมเดลเดิม เพราะไม่มีตารางลูกอื่นที่ต้อง remap ตาม — ดูหมายเหตุหัวไฟล์) */
export interface SaveReconcileSessionResult {
  session: ReconcileSession;
  bankRows: BankRow[];
  glRows: GLRow[];
  bankReviewFlags: Record<string, BankReviewFlags>;
  glReviewFlags: Record<string, GLReviewFlags>;
}

/* ============================== สถานะบันทึกอัตโนมัติ ============================== */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'กำลังบันทึก...',
  saved: 'บันทึกแล้ว',
  error: 'บันทึกไม่สำเร็จ',
};

/* ============================== แถวฐานข้อมูลดิบ (ใช้ภายใน lib/bankReconcileSessionMapping.ts เท่านั้น) ============================== */

/** แถวของตาราง public.bank_reconcile_bank_transactions — รวม BankRow ที่ normalize แล้วทุกฟิลด์ +
 * BankReviewFlags เป็นคอลัมน์ตรงบนแถวเดียวกันเลย (ไม่แยก Record ต่างหาก — ดูเหตุผลที่หมายเหตุหัวไฟล์) */
export interface BankTransactionDbRow {
  id: string;
  session_id: string;
  row_number: number;
  transaction_date: string | null;
  description: string;
  money_in: number;
  money_out: number;
  direction: 'income' | 'payment' | null;
  amount: number;
  balance: number | null;
  account_no: string;
  raw_row: unknown[];
  excluded: boolean;
  row_errors: string[];
  needs_gl_entry: boolean;
  reviewed: boolean;
  review_note: string;
  created_at: string;
}

/** แถวของตาราง public.bank_reconcile_gl_transactions — ขนานกับ BankTransactionDbRow ทุกประการ ต่างแค่
 * doc_no/account_code แทน balance/account_no และ needs_gl_review แทน needs_gl_entry */
export interface GLTransactionDbRow {
  id: string;
  session_id: string;
  row_number: number;
  transaction_date: string | null;
  description: string;
  money_in: number;
  money_out: number;
  direction: 'income' | 'payment' | null;
  amount: number;
  doc_no: string;
  account_code: string;
  raw_row: unknown[];
  excluded: boolean;
  row_errors: string[];
  needs_gl_review: boolean;
  reviewed: boolean;
  review_note: string;
  created_at: string;
}

/* ============================== KPI ของรอบกระทบยอด (ส่วน "13. RECONCILIATION SUMMARY") ============================== */

/** 9 KPI ตามสเปกเป๊ะ — คำนวณจาก ReconcileMatchOutput (ผลจาก runSimpleReconciliation) เสมอ ไม่เคยอ่านค่าที่
 * cache ไว้ในฐานข้อมูลมาแสดงบนจอโดยตรง (ค่าที่บันทึกลง ReconcileSession เป็นแค่ snapshot ตอนบันทึกไว้ให้หน้า
 * รายการแสดงแบบเร็วๆ ได้โดยไม่ต้องโหลด+คำนวณใหม่ทั้งชุดเท่านั้น) — ดู lib/bankReconcileKpi.ts */
export interface ReconcileSessionKpi {
  bank_row_count: number;
  gl_row_count: number;
  found_count: number;
  bank_not_found_count: number;
  gl_not_found_count: number;
  bank_income_total: number;
  bank_payment_total: number;
  gl_income_total: number;
  gl_payment_total: number;
  income_difference: number;
  payment_difference: number;
}
