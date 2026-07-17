import { mutate } from 'swr';
import { getSupabaseClient } from './supabaseClient';
import { runSimpleReconciliation } from './bankReconcileMatching';
import { computeReconcileSessionKpi } from './bankReconcileKpi';
import {
  buildBankTransactionPayload,
  buildGLTransactionPayload,
  mapDbRowsToSessionCore,
} from './bankReconcileSessionMapping';
import { buildReconcileSessionExcelBlob } from './bankReconcileSessionExport';
import type {
  BankTransactionDbRow,
  GLTransactionDbRow,
  LoadedSessionData,
  ReconcileSession,
  ReconcileSessionActor,
  SaveReconcileSessionInput,
  SaveReconcileSessionResult,
} from '@/types/bankReconcileSession';

/**
 * ชั้นเรียก Supabase จริงของฟีเจอร์ Bank Reconcile — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild
 * โมดูลทั้งโมดูล เป็นฟังก์ชัน async ธรรมดาล้วนๆ ไม่มี class ตามธรรมเนียมเดิมของ lib/invoiceApi.ts/
 * lib/contactApi.ts ทุกประการ (getSupabaseClient() -> .from().op() -> if (error) throw error -> return
 * data) ยกเว้นจุดเดียวที่ต่างออกไปตั้งใจ: saveReconcileSession() เรียกผ่าน
 * supabase.rpc('save_bank_reconcile_session', ...) แทน .from().insert()/.update() ธรรมดา เพราะการบันทึก
 * หนึ่งครั้งต้องเขียนพร้อมกันถึง 3 ตาราง (session + Bank txns + GL txns) แบบ all-or-nothing — ดูหมายเหตุเต็ม
 * ที่ supabase/migration_005_bank_reconcile.sql
 *
 * ไม่มี audit log/match group/tolerance ใดๆ ในไฟล์นี้อีกต่อไป (ตัดออกทั้งหมดตามสเปกใหม่ — ดู
 * types/bankReconcileSession.ts หัวไฟล์สำหรับเหตุผลเต็ม) ไม่มี exportReconcileSessionPdf อีกต่อไปเช่นกัน
 * (สเปกส่วน "19. EXPORT EXCEL" ขอแค่ Excel เท่านั้น ไม่มีส่วนไหนขอ PDF export เลย — jspdf/pdfThaiFont ยังคง
 * ใช้อยู่ในโมดูลอื่นของระบบ (VAT report) ไม่ได้ถูกลบทิ้ง แค่ไม่ถูกเรียกใช้จากไฟล์นี้อีกต่อไปเท่านั้น)
 */

const SESSIONS_TABLE = 'bank_reconcile_sessions';
const BANK_TXN_TABLE = 'bank_reconcile_bank_transactions';
const GL_TXN_TABLE = 'bank_reconcile_gl_transactions';

/** SWR cache key ของหน้ารายการ "ประวัติการกระทบยอดธนาคาร" */
export const RECONCILE_SESSIONS_SWR_KEY = SESSIONS_TABLE;

/* ============================== บันทึกรอบกระทบยอด ============================== */

export async function saveReconcileSession(input: SaveReconcileSessionInput): Promise<SaveReconcileSessionResult> {
  const supabase = getSupabaseClient();

  const matchOutput = runSimpleReconciliation(input.bankRows, input.glRows);
  const kpi = computeReconcileSessionKpi(matchOutput);

  const sessionPayload = {
    id: input.sessionId,
    session_name: input.sessionName,
    bank_file_name: input.bankFileName,
    gl_file_name: input.glFileName,
    bank_source_file_type: input.bankSourceFileType,
    gl_source_file_type: input.glSourceFileType,
    bank_row_count: kpi.bank_row_count,
    gl_row_count: kpi.gl_row_count,
    found_count: kpi.found_count,
    bank_not_found_count: kpi.bank_not_found_count,
    gl_not_found_count: kpi.gl_not_found_count,
    bank_income_total: kpi.bank_income_total,
    bank_payment_total: kpi.bank_payment_total,
    gl_income_total: kpi.gl_income_total,
    gl_payment_total: kpi.gl_payment_total,
    income_difference: kpi.income_difference,
    payment_difference: kpi.payment_difference,
    status: input.status,
    created_by: input.actor.id,
    created_by_email: input.actor.email,
    updated_by: input.actor.id,
    updated_by_email: input.actor.email,
  };

  const bankTransactionsPayload = input.bankRows.map((row) => buildBankTransactionPayload(row, input.bankReviewFlags[row.id]));
  const glTransactionsPayload = input.glRows.map((row) => buildGLTransactionPayload(row, input.glReviewFlags[row.id]));

  const { data, error } = await supabase.rpc('save_bank_reconcile_session', {
    p_session: sessionPayload,
    p_bank_transactions: bankTransactionsPayload,
    p_gl_transactions: glTransactionsPayload,
  });
  if (error) throw error;

  const session = data as ReconcileSession;

  // บันทึกสำเร็จแล้ว — โหลดกลับมาทันทีเพื่อให้ได้ id ถาวรของทุกแถว (ฟังก์ชันฝั่งฐานข้อมูลสร้าง uuid ใหม่ให้
  // ทุกแถวเสมอผ่าน full-snapshot replace — ดูหมายเหตุที่ migration_005_bank_reconcile.sql) ผู้เรียกต้อง
  // setState ทับด้วยผลลัพธ์นี้เสมอ ไม่เช่นนั้น id ที่ค้างอยู่ในหน่วยความจำ (เช่น "bank-1") จะไม่ตรงกับที่บันทึก
  // จริงตั้งแต่การบันทึกครั้งถัดไป
  const detail = await fetchSessionDetail(session.id);

  // แจ้ง SWR ให้ล้าง cache ของ "หน้ารายการ" ทันที (components/BankReconcileSessionList.tsx) แม้ตอนนี้จะไม่ได้
  // mount อยู่เลยก็ตาม (ผู้ใช้กำลังอยู่หน้าผลลัพธ์ ไม่ใช่หน้ารายการ) — จำเป็นเพราะ BankReconcileResults.tsx กับ
  // BankReconcileSessionList.tsx เป็นคนละ instance ของ useSWR กันคนละคีย์ ไม่มีการแชร์ mutate() ของ hook ตรงๆ
  // ถ้าไม่เรียกตรงนี้ ผู้ใช้ที่บันทึกเสร็จแล้วกด "กลับไปหน้ารายการ" ภายใน dedupingInterval ของ SWR (ค่าเริ่มต้น
  // 2 วินาที) จากตอนโหลดหน้ารายการครั้งแรก จะยังเห็นรายการเดิม (ไม่มีรอบที่เพิ่งบันทึก) เพราะ SWR ข้าม fetch ซ้ำ
  // ไปเงียบๆ — mutate(key) แบบไม่ใส่ data (revalidate เฉยๆ) จะลบตัวติดตาม dedupe ของคีย์นี้ทันทีเสมอไม่ว่าจะมี
  // ใคร mount อยู่หรือไม่ ทำให้ครั้งถัดไปที่หน้ารายการ mount ขึ้นมาใหม่บังคับ fetch สดจริงเสมอ (พบบั๊กนี้จาก
  // E2E test จริงที่ทำครบวงจร upload→map→preview→บันทึก→กลับไปหน้ารายการ ภายในเวลาไม่ถึง 2 วินาที)
  void mutate(RECONCILE_SESSIONS_SWR_KEY);

  return {
    session: detail.session,
    bankRows: detail.bankRows,
    glRows: detail.glRows,
    bankReviewFlags: detail.bankReviewFlags,
    glReviewFlags: detail.glReviewFlags,
  };
}

/* ============================== รายการ/รายละเอียดรอบกระทบยอด ============================== */

export async function fetchReconcileSessions(): Promise<ReconcileSession[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReconcileSession[];
}

/** โหลดรอบกระทบยอดหนึ่งรอบกลับมาครบชุด — ผลกระทบยอด (สถานะพบ/ไม่พบใน GL) ไม่ได้ถูกโหลดมาด้วย เพราะไม่ได้
 * ถูกบันทึกไว้แต่แรก ผู้เรียก (components/BankReconcileResults.tsx) ต้องเรียก runSimpleReconciliation()
 * กับ bankRows/glRows ที่ได้เองเสมอ (เป็นฟังก์ชัน pure ที่เร็วมาก ไม่ใช่ "การรันจับคู่อัตโนมัติซ้ำ" ที่มีผลข้าง
 * เคียงใดๆ ต่างจากโมเดลเดิมที่มี manual match ให้เสียหาย) */
export async function fetchSessionDetail(sessionId: string): Promise<LoadedSessionData> {
  const supabase = getSupabaseClient();
  const [sessionRes, bankRes, glRes] = await Promise.all([
    supabase.from(SESSIONS_TABLE).select('*').eq('id', sessionId).single(),
    supabase.from(BANK_TXN_TABLE).select('*').eq('session_id', sessionId),
    supabase.from(GL_TXN_TABLE).select('*').eq('session_id', sessionId),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (bankRes.error) throw bankRes.error;
  if (glRes.error) throw glRes.error;

  const session = sessionRes.data as ReconcileSession;
  const core = mapDbRowsToSessionCore((bankRes.data ?? []) as BankTransactionDbRow[], (glRes.data ?? []) as GLTransactionDbRow[]);

  return { session, ...core };
}

/* ============================== การจัดการรอบกระทบยอด ============================== */

export async function renameReconcileSession(sessionId: string, newName: string): Promise<ReconcileSession> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .update({ session_name: newName })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data as ReconcileSession;
}

/** ลบแบบ soft delete เท่านั้น (ตั้ง deleted_at) — ไม่ลบแถวจริง ไม่ลบข้อมูลลูกใดๆ ป้องกันการลบข้อมูลบัญชีโดย
 * ไม่ตั้งใจ (หน้ารายการกรอง deleted_at is null ออกไปเองที่ fetchReconcileSessions) */
export async function softDeleteReconcileSession(sessionId: string, actor: ReconcileSessionActor): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(SESSIONS_TABLE)
    .update({ deleted_at: new Date().toISOString(), updated_by: actor.id, updated_by_email: actor.email })
    .eq('id', sessionId);
  if (error) throw error;
}

/** เปลี่ยนสถานะรอบกระทบยอด (ทำเครื่องหมายว่าเสร็จสมบูรณ์ / เปิดกลับมาแก้ไข) — เป็นแค่ป้ายกำกับล้วนๆ ไม่ล็อก
 * การแก้ไขใดๆ (ต่างจากโมเดลเดิมที่ completeReconcileSession/reopenReconcileSession แยกฟังก์ชันกันเพราะต้อง
 * บังคับกรอกหมายเหตุ/เหตุผลคนละแบบ) รวมเป็นฟังก์ชันเดียวที่นี่เพราะทั้งสองทิศทางทำแค่ update คอลัมน์เดียวกัน
 * ชุดเดียวกัน — เก็บ completed_by/completed_by_email/completed_at เดิมไว้เสมอเมื่อเปิดกลับมาแก้ไข (ไม่เขียนทับ
 * ประวัติการปิดรอบล่าสุด ตามเจตนาเดียวกับโมเดลเดิม แม้จะไม่มีกลไกล็อกแล้วก็ตาม) */
export async function updateReconcileSessionStatus(
  sessionId: string,
  status: 'in_progress' | 'completed',
  actor: ReconcileSessionActor
): Promise<ReconcileSession> {
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = { status, updated_by: actor.id, updated_by_email: actor.email };
  if (status === 'completed') {
    patch.completed_by = actor.id;
    patch.completed_by_email = actor.email;
    patch.completed_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from(SESSIONS_TABLE).update(patch).eq('id', sessionId).select().single();
  if (error) throw error;
  // แจ้ง SWR ให้ล้าง cache ของหน้ารายการเช่นเดียวกับ saveReconcileSession() ด้านบน (badge สถานะ/นับจำนวนในหน้า
  // รายการต้องอัปเดตทันทีที่กลับไปดู แม้เปลี่ยนสถานะจากหน้าผลลัพธ์ที่หน้ารายการไม่ได้ mount อยู่ก็ตาม)
  void mutate(RECONCILE_SESSIONS_SWR_KEY);
  return data as ReconcileSession;
}

/* ============================== Export Excel ============================== */

/** โหลดรอบกระทบยอดสดๆ จากฐานข้อมูล คำนวณผลกระทบยอดใหม่ แล้วสร้างไฟล์ Excel — ไม่เชื่อ state บนจอเลยแม้ตอน
 * export จาก session ที่เปิดอยู่และมีการแก้ไขที่ยังไม่ได้บันทึก (ตามสเปกส่วน "19. EXPORT EXCEL" โดยนัย — export
 * คือข้อมูลที่บันทึกแล้วจริง ไม่ใช่ข้อมูลบนจอที่อาจยังไม่ได้บันทึก) */
export async function exportReconcileSessionExcel(sessionId: string): Promise<Blob> {
  const loaded = await fetchSessionDetail(sessionId);
  const matchOutput = runSimpleReconciliation(loaded.bankRows, loaded.glRows);
  return buildReconcileSessionExcelBlob(loaded.session, matchOutput, loaded.bankReviewFlags, loaded.glReviewFlags);
}
