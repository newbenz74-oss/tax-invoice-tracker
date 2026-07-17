import { getSupabaseClient } from './supabaseClient';
import { computeReconcileSessionKpi } from './bankReconcileKpi';
import { mergeManualMatches } from './bankReconcileManualMatch';
import {
  buildSessionSavePayload,
  mapDbRowsToSessionCore,
  regenerateAllIds,
  remapRecordKeys,
  daysToDateToleranceOption,
  amountToleranceValueToOption,
} from './bankReconcileSessionMapping';
import { buildReconcileSessionExcelBlob, buildReconcileSessionPdfBlob } from './bankReconcileSessionExport';
import type {
  AppendAuditLogInput,
  LoadedSessionData,
  PdfReportMode,
  ReconcileAuditLogEntry,
  ReconcileSession,
  ReconcileSessionActor,
  SaveReconcileSessionInput,
  SaveReconcileSessionResult,
} from '@/types/bankReconcileSession';
import type {
  BankTransactionDbRow,
  GLTransactionDbRow,
  MatchGroupDbRow,
  MatchGroupItemDbRow,
} from '@/types/bankReconcileSession';

/**
 * ชั้นเรียก Supabase จริงของฟีเจอร์ Bank Reconcile เฟส 4 — เพิ่มเข้ามา 2026-07-16 เป็นฟังก์ชัน async ธรรมดา
 * ล้วนๆ ไม่มี class ตามธรรมเนียมเดิมของ lib/invoiceApi.ts/lib/contactApi.ts ทุกประการ (getSupabaseClient() ->
 * .from().op() -> if (error) throw error -> return data) ยกเว้นจุดเดียวที่ต่างออกไปตั้งใจ: saveReconcileSession()
 * เรียกผ่าน supabase.rpc('save_bank_reconcile_session', ...) แทน .from().insert()/.update() ธรรมดา เพราะการ
 * บันทึกหนึ่งครั้งต้องเขียนพร้อมกันถึง 4 ตาราง (session + Bank txns + GL txns + match groups + match group
 * items) แบบ all-or-nothing (สเปกส่วน "3. DATABASE SAFETY" — "roll back entirely on any critical failure, no
 * partial saves") ซึ่ง PostgREST/.from() ธรรมดาทำไม่ได้ (แต่ละ .from() เป็นคนละ HTTP request/transaction) — ดู
 * หมายเหตุเต็มที่ header ของ supabase/migration_005_bank_reconcile.sql
 */

const SESSIONS_TABLE = 'bank_reconcile_sessions';
const BANK_TXN_TABLE = 'bank_reconcile_bank_transactions';
const GL_TXN_TABLE = 'bank_reconcile_gl_transactions';
const MATCH_GROUPS_TABLE = 'bank_reconcile_match_groups';
const MATCH_GROUP_ITEMS_TABLE = 'bank_reconcile_match_group_items';
const AUDIT_LOGS_TABLE = 'bank_reconcile_audit_logs';

/** SWR cache key ของหน้ารายการ "ประวัติการกระทบยอดธนาคาร" — แยกจาก key ของฟีเจอร์อื่นทั้งหมด (ธรรมเนียมเดียวกับ
 * CONTACTS_SWR_KEY ใน lib/contactApi.ts) */
export const RECONCILE_SESSIONS_SWR_KEY = SESSIONS_TABLE;

/* ============================== บันทึกรอบกระทบยอด (§3/§4) ============================== */

export async function saveReconcileSession(input: SaveReconcileSessionInput): Promise<SaveReconcileSessionResult> {
  const supabase = getSupabaseClient();
  const isFirstSave = input.sessionId === null;

  const kpi = computeReconcileSessionKpi(input.reconcileRows, input.matchGLRows, input.matchGroups);
  const payload = buildSessionSavePayload({
    reconcileRows: input.reconcileRows,
    matchGLRows: input.matchGLRows,
    matchGroups: input.matchGroups,
  });

  const sessionPayload = {
    id: input.sessionId,
    session_name: input.sessionName,
    bank_account_no: input.bankAccountNo,
    bank_name: input.bankName,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    bank_file_name: input.bankFileName,
    gl_file_name: input.glFileName,
    bank_row_count: kpi.bank_row_count,
    gl_row_count: kpi.gl_row_count,
    matched_count: kpi.matched_count,
    suggested_count: kpi.suggested_count,
    manual_match_count: kpi.manual_match_count,
    review_count: kpi.review_count,
    unmatched_bank_count: kpi.unmatched_bank_count,
    unmatched_gl_count: kpi.unmatched_gl_count,
    bank_total: kpi.bank_total,
    gl_total: kpi.gl_total,
    matched_bank_total: kpi.matched_bank_total,
    matched_gl_total: kpi.matched_gl_total,
    unmatched_bank_total: kpi.unmatched_bank_total,
    unmatched_gl_total: kpi.unmatched_gl_total,
    net_difference: kpi.net_difference,
    date_tolerance_days: input.dateToleranceDays,
    amount_tolerance: input.amountTolerance,
    status: input.status,
    created_by: input.actor.id,
    created_by_email: input.actor.email,
    updated_by: input.actor.id,
    updated_by_email: input.actor.email,
  };

  const { data, error } = await supabase.rpc('save_bank_reconcile_session', {
    p_session: sessionPayload,
    p_bank_transactions: payload.bankTransactionsPayload,
    p_gl_transactions: payload.glTransactionsPayload,
    p_match_groups: payload.matchGroupsPayload,
    p_match_group_items: payload.matchGroupItemsPayload,
  });
  if (error) throw error;

  const session = data as ReconcileSession;

  // บันทึกครั้งแรกของ session นี้เท่านั้น — เติม audit log 4 รายการที่เกิดขึ้น "ก่อนมี session_id" ไม่ได้
  // (อัปโหลดไฟล์/จับคู่คอลัมน์/จับคู่รายการอัตโนมัติ ล้วนเป็น client-side ล้วนๆ ของเฟส 1-3 ก่อนมีการบันทึกครั้ง
  // แรกเสมอ ตามข้อจำกัด "ห้าม rebuild เฟส 1/2/3" จึงไม่มี session_id ให้ผูกไว้ตั้งแต่ตอนนั้นจริงๆ) บันทึกไว้
  // ณ เวลาบันทึกครั้งแรกแทน พร้อมหมายเหตุอธิบายไว้ชัดเจนในแต่ละรายการ
  if (isFirstSave) {
    await appendAuditLogEntries(session.id, [
      { actionType: 'session_created', actor: input.actor, newValue: { session_name: session.session_name } },
      {
        actionType: 'file_uploaded',
        actor: input.actor,
        actionNote: `Bank: ${session.bank_file_name} / GL: ${session.gl_file_name}`,
      },
      { actionType: 'mapping_saved', actor: input.actor },
      {
        actionType: 'auto_matching_completed',
        actor: input.actor,
        newValue: { matched_count: kpi.matched_count, suggested_count: kpi.suggested_count },
      },
    ]);
  }

  return {
    session,
    matchBankRows: payload.remappedMatchBankRows,
    matchGLRows: payload.remappedMatchGLRows,
    matchGroups: payload.remappedMatchGroups,
    bankIdMap: payload.bankIdMap,
  };
}

/* ============================== รายการ/รายละเอียดรอบกระทบยอด (§6/§8) ============================== */

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

/** โหลดรอบกระทบยอดหนึ่งรอบกลับมาครบชุด (ไม่รันจับคู่อัตโนมัติซ้ำ ตามสเปกส่วน "8. OPEN EXISTING SESSION" —
 * "Do NOT rerun automatic matching automatically if saved results already exist") — คืนค่าพร้อมใช้กับ
 * useState lazy initializer ของ components/BankReconcileResults.tsx ตรงๆ */
export async function fetchSessionDetail(sessionId: string): Promise<LoadedSessionData> {
  const supabase = getSupabaseClient();
  const [sessionRes, bankRes, glRes, groupRes, itemRes] = await Promise.all([
    supabase.from(SESSIONS_TABLE).select('*').eq('id', sessionId).single(),
    supabase.from(BANK_TXN_TABLE).select('*').eq('session_id', sessionId),
    supabase.from(GL_TXN_TABLE).select('*').eq('session_id', sessionId),
    supabase.from(MATCH_GROUPS_TABLE).select('*').eq('session_id', sessionId),
    supabase.from(MATCH_GROUP_ITEMS_TABLE).select('*').eq('session_id', sessionId),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (bankRes.error) throw bankRes.error;
  if (glRes.error) throw glRes.error;
  if (groupRes.error) throw groupRes.error;
  if (itemRes.error) throw itemRes.error;

  const session = sessionRes.data as ReconcileSession;
  const core = mapDbRowsToSessionCore(
    (bankRes.data ?? []) as BankTransactionDbRow[],
    (glRes.data ?? []) as GLTransactionDbRow[],
    (groupRes.data ?? []) as MatchGroupDbRow[],
    (itemRes.data ?? []) as MatchGroupItemDbRow[]
  );
  const { option: amountToleranceOption, custom: customAmountTolerance } = amountToleranceValueToOption(
    session.amount_tolerance
  );

  return {
    session,
    ...core,
    dateTolerance: daysToDateToleranceOption(session.date_tolerance_days),
    amountToleranceOption,
    customAmountTolerance,
  };
}

/* ============================== การจัดการรอบกระทบยอด (§6) ============================== */

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

export async function cancelReconcileSession(sessionId: string, actor: ReconcileSessionActor): Promise<ReconcileSession> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .update({ status: 'cancelled', updated_by: actor.id, updated_by_email: actor.email })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  await appendAuditLogEntries(sessionId, [{ actionType: 'session_cancelled', actor }]);
  return data as ReconcileSession;
}

/** ลบแบบ soft delete เท่านั้นตามสเปกส่วน "6. SESSION LIST PAGE" — "do not permanently delete completed
 * sessions by default, prefer soft delete if possible" เลือกใช้ soft delete กับทุกสถานะเหมือนกันหมด (ไม่ใช่
 * แค่ completed) เพื่อความสม่ำเสมอและปลอดภัยของข้อมูลทุกสถานะเท่ากัน — ตั้ง deleted_at เท่านั้น ไม่ลบแถวจริง
 * ไม่ลบข้อมูลลูกใดๆ ทั้งสิ้น (หน้ารายการกรอง deleted_at is null ออกไปเองที่ fetchReconcileSessions) */
export async function softDeleteReconcileSession(sessionId: string, actor: ReconcileSessionActor): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(SESSIONS_TABLE)
    .update({ deleted_at: new Date().toISOString(), updated_by: actor.id, updated_by_email: actor.email })
    .eq('id', sessionId);
  if (error) throw error;
  await appendAuditLogEntries(sessionId, [{ actionType: 'session_deleted', actor }]);
}

/** ทำสำเนารอบกระทบยอด (§6 ปุ่ม "ทำสำเนา") — โหลดต้นฉบับทั้งชุด สร้าง id ใหม่ทั้งหมดให้ทุกแถว/กลุ่ม (ห้ามใช้
 * id ซ้ำกับต้นฉบับเด็ดขาด ไม่เช่นนั้นจะชน primary key ทันที — ดู regenerateAllIds) รีเซ็ตสถานะกลับเป็น
 * 'draft' เสมอ (ไม่คัดลอกสถานะ completed/reopened/หมายเหตุการปิดรอบ/ผู้ปิดรอบมาด้วย — สำเนาคือรอบใหม่ที่ยัง
 * ไม่เคยปิดจริง) แล้วบันทึกเป็น session ใหม่ผ่าน saveReconcileSession() ตามปกติ (sessionId: null บังคับให้
 * สร้างแถวใหม่) รันเครื่องมือจับคู่ (mergeManualMatches) ซ้ำหนึ่งครั้งเพื่อประกอบ ReconcileRow[] ที่จำเป็น
 * สำหรับการบันทึก (ไม่ใช่การ "รันจับคู่อัตโนมัติใหม่" ตามความหมายของสเปกส่วน 8 — ผลลัพธ์เหมือนเดิมทุกประการ
 * เพราะข้อมูล Bank/GL/matchGroups ทั้งหมดเป็นชุดเดียวกับต้นฉบับ แค่เปลี่ยน id เท่านั้น) */
export async function duplicateReconcileSession(
  sessionId: string,
  newSessionName: string,
  actor: ReconcileSessionActor
): Promise<SaveReconcileSessionResult> {
  const loaded = await fetchSessionDetail(sessionId);
  const regenerated = regenerateAllIds(loaded.matchBankRows, loaded.matchGLRows, loaded.matchGroups);
  const reviewFlags = remapRecordKeys(loaded.reviewFlags, regenerated.bankIdMap);
  const notes = remapRecordKeys(loaded.notes, regenerated.bankIdMap);

  const merged = mergeManualMatches({
    matchBankRows: regenerated.matchBankRows,
    matchGLRows: regenerated.matchGLRows,
    toleranceDays: loaded.session.date_tolerance_days,
    matchGroups: regenerated.matchGroups,
    reviewFlags,
    notes,
  });

  const result = await saveReconcileSession({
    sessionId: null,
    sessionName: newSessionName,
    bankAccountNo: loaded.session.bank_account_no,
    bankName: loaded.session.bank_name,
    periodStart: loaded.session.period_start,
    periodEnd: loaded.session.period_end,
    bankFileName: loaded.session.bank_file_name,
    glFileName: loaded.session.gl_file_name,
    reconcileRows: merged.rows,
    matchGLRows: regenerated.matchGLRows,
    matchGroups: regenerated.matchGroups,
    dateToleranceDays: loaded.session.date_tolerance_days,
    amountTolerance: loaded.session.amount_tolerance,
    status: 'draft',
    actor,
  });

  await appendAuditLogEntries(result.session.id, [
    { actionType: 'session_created', actor, actionNote: `ทำสำเนาจากรอบกระทบยอด "${loaded.session.session_name}"` },
  ]);

  return result;
}

/* ============================== ปิดรอบ / เปิดรอบใหม่ (§9/§10/§11) ============================== */

export async function completeReconcileSession(
  sessionId: string,
  completionNote: string | null,
  actor: ReconcileSessionActor
): Promise<ReconcileSession> {
  const supabase = getSupabaseClient();
  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .update({
      status: 'completed',
      completed_by: actor.id,
      completed_by_email: actor.email,
      completed_at: nowISO,
      completion_note: completionNote,
      updated_by: actor.id,
      updated_by_email: actor.email,
    })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  await appendAuditLogEntries(sessionId, [
    { actionType: 'session_completed', actor, actionNote: completionNote },
  ]);
  return data as ReconcileSession;
}

/** เปิดรอบที่ปิดแล้วกลับมาแก้ไข (§11) — เก็บ completed_by/completed_by_email/completed_at/completion_note
 * เดิมไว้ทั้งหมดเสมอ (ไม่เขียนทับ/ล้างประวัติการปิดรอบเดิมเด็ดขาดตามสเปก "Never silently overwrite completed
 * history") บันทึกแค่ reopened_by/reopened_by_email/reopened_at/reopen_reason เพิ่มเติม + เปลี่ยน status เป็น
 * 'reopened' เท่านั้น */
export async function reopenReconcileSession(
  sessionId: string,
  reason: string,
  actor: ReconcileSessionActor
): Promise<ReconcileSession> {
  const supabase = getSupabaseClient();
  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .update({
      status: 'reopened',
      reopened_by: actor.id,
      reopened_by_email: actor.email,
      reopened_at: nowISO,
      reopen_reason: reason,
      updated_by: actor.id,
      updated_by_email: actor.email,
    })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  await appendAuditLogEntries(sessionId, [{ actionType: 'session_reopened', actor, actionNote: reason }]);
  return data as ReconcileSession;
}

/* ============================== Audit Log (§12) ============================== */

async function appendAuditLogEntries(sessionId: string, entries: AppendAuditLogInput[]): Promise<void> {
  if (entries.length === 0) return;
  const supabase = getSupabaseClient();
  const rows = entries.map((entry) => ({
    session_id: sessionId,
    action_type: entry.actionType,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    action_note: entry.actionNote ?? null,
    performed_by: entry.actor.id,
    performed_by_email: entry.actor.email,
  }));
  const { error } = await supabase.from(AUDIT_LOGS_TABLE).insert(rows);
  // audit log ล้มเหลวต้องไม่ทำให้การกระทำหลัก (บันทึก/ปิดรอบ/ฯลฯ) ที่สำเร็จไปแล้วดูเหมือนล้มเหลวไปด้วย — log
  // ไว้ที่ console เท่านั้นตามสเปกส่วน "17. ERROR HANDLING" ("log technical errors to console only") ไม่ throw
  // ซ้ำ ไม่มี error ใดๆ แสดงต่อผู้ใช้จากจุดนี้
  if (error) {
    console.error('บันทึกประวัติการแก้ไข (audit log) ไม่สำเร็จ:', error);
  }
}

/** บันทึกเหตุการณ์เดียวลง audit log — ใช้เรียกจาก components/BankReconcileResults.tsx ตรงจุดที่ผู้ใช้ทำ
 * แอ็กชันนั้นๆ จริง (ยืนยันจับคู่/ยกเลิกจับคู่/เพิ่มหมายเหตุ/ทำเครื่องหมายตรวจสอบ/เปลี่ยนค่าคลาดเคลื่อน/export)
 * ไม่รอ auto-save เพราะ auto-save เป็นแค่กลไก "persist state ล่าสุด" ทั่วไป ไม่รู้ว่าเปลี่ยนอะไรมาเฉพาะเจาะจง */
export async function appendReconcileAuditLog(sessionId: string, entry: AppendAuditLogInput): Promise<void> {
  await appendAuditLogEntries(sessionId, [entry]);
}

export async function fetchReconcileAuditLog(sessionId: string): Promise<ReconcileAuditLogEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(AUDIT_LOGS_TABLE)
    .select('*')
    .eq('session_id', sessionId)
    .order('performed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReconcileAuditLogEntry[];
}

/* ============================== Export Excel/PDF (§13/§14) ============================== */

/** โหลดรอบกระทบยอดสดๆ จากฐานข้อมูลแล้วผสานผลจับคู่ด้วยตนเองเข้ากับเอนจินอัตโนมัติ (mergeManualMatches) ให้พร้อม
 * สร้างไฟล์ export ทันที — จุดรวมเดียวที่ทั้ง exportReconcileSessionExcel/exportReconcileSessionPdf ด้านล่าง และ
 * ในอนาคตคือหน้ารายการ "ประวัติการกระทบยอดธนาคาร" (row-level Export) กับ header ของ session ที่เปิดอยู่ใน
 * BankReconcileResults.tsx ต่างเรียกใช้ร่วมกัน แทนที่จะคัดลอก fetch+merge นี้ซ้ำในหลายที่ ตั้งใจ "ไม่ไว้ใจ" state
 * บนจอเลยแม้แต่ตอน export จาก session ที่เปิดอยู่และมีการแก้ไขที่ยังไม่ได้บันทึก — ดึงจากฐานข้อมูลสดใหม่ทุกครั้ง
 * ตามสเปกส่วน "13. EXPORT EXCEL" ตรงๆ ("exports the currently-opened session from saved data, not
 * screen-only state") เพื่อไม่ให้ไฟล์ export มีข้อมูลที่ยังไม่ผ่านการบันทึกจริงปนอยู่ */
async function loadSessionForExport(sessionId: string) {
  const loaded = await fetchSessionDetail(sessionId);
  const merged = mergeManualMatches({
    matchBankRows: loaded.matchBankRows,
    matchGLRows: loaded.matchGLRows,
    toleranceDays: loaded.session.date_tolerance_days,
    matchGroups: loaded.matchGroups,
    reviewFlags: loaded.reviewFlags,
    notes: loaded.notes,
  });
  return {
    session: loaded.session,
    reconcileRows: merged.rows,
    matchGLRows: loaded.matchGLRows,
    matchGroups: loaded.matchGroups,
  };
}

export async function exportReconcileSessionExcel(sessionId: string): Promise<Blob> {
  const { session, reconcileRows, matchGLRows, matchGroups } = await loadSessionForExport(sessionId);
  const auditLog = await fetchReconcileAuditLog(sessionId);
  return buildReconcileSessionExcelBlob(session, reconcileRows, matchGLRows, matchGroups, auditLog);
}

export async function exportReconcileSessionPdf(
  sessionId: string,
  mode: PdfReportMode,
  preparedByEmail: string,
  reportDateISO: string
): Promise<Blob> {
  const { session, reconcileRows, matchGLRows, matchGroups } = await loadSessionForExport(sessionId);
  return buildReconcileSessionPdfBlob(session, reconcileRows, matchGLRows, matchGroups, mode, preparedByEmail, reportDateISO);
}
