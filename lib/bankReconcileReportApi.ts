import { getSupabaseClient } from './supabaseClient';
import type { BankTransaction, DateTolerance, GLTransaction, TransactionType } from '@/types/bankReconcile';
import type { MatchGroup, MatchType, ReconcileReportStatus } from '@/types/bankReconcileMatch';

/**
 * โมดูล API สำหรับฟีเจอร์ "บันทึกประวัติการกระทบยอด" (เพิ่มเข้ามา 2026-07-19) — ตามรูปแบบเดียวกับ
 * lib/invoiceApi.ts ทุกประการ (TABLE constant, _SWR_KEY, getSupabaseClient() เรียกใหม่ทุกฟังก์ชัน,
 * {data,error} + throw error) ต่างจากโมดูลอื่นตรงที่การบันทึก (save) ต้องเขียน 4 ตารางพร้อมกันแบบ atomic
 * จึงเรียกผ่าน RPC (supabase.rpc) แทนการ insert/update ตรงๆ — ดู supabase/migration_006_*.sql สำหรับ
 * นิยามตารางและฟังก์ชัน save_bank_reconcile_report ฝั่งฐานข้อมูล
 */

const REPORTS_TABLE = 'bank_reconcile_reports';
const MATCH_GROUPS_TABLE = 'bank_reconcile_match_groups';
const BANK_ROWS_TABLE = 'bank_reconcile_bank_rows';
const GL_ROWS_TABLE = 'bank_reconcile_gl_rows';

export const RECONCILE_REPORTS_SWR_KEY = REPORTS_TABLE;

export interface ReconcileReportSummary {
  id: string;
  report_name: string;
  period_month: number;
  period_year: number;
  status: ReconcileReportStatus;
  bank_file_name: string | null;
  gl_file_name: string | null;
  tolerance_days: DateTolerance;
  bank_row_count: number;
  gl_row_count: number;
  matched_group_count: number;
  bank_unmatched_count: number;
  gl_unmatched_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReconcileReportDetail {
  report: ReconcileReportSummary;
  /** แถวเต็มทั้งหมด (ทั้งจับคู่แล้วและยังไม่จับคู่) เรียงตาม row_order เดิมเสมอ — ใช้แทน bankFile.rows/
   * glFile.rows ที่ปกติมาจากการ parse ไฟล์สดๆ ทำให้เปิดรายการที่บันทึกไว้แล้วไม่ต้องอัปโหลดไฟล์ใหม่เลย */
  bankRows: BankTransaction[];
  glRows: GLTransaction[];
  matchGroups: MatchGroup[];
  bankUnmatched: BankTransaction[];
  glUnmatched: GLTransaction[];
}

export interface ReconcileReportWriteInput {
  /** null = บันทึกเป็นรายการใหม่ / ไม่ null = บันทึกทับรายการเดิม (แก้ไขรายการที่เปิดมาจากประวัติ) */
  id: string | null;
  reportName: string;
  periodMonth: number;
  periodYear: number;
  status: ReconcileReportStatus;
  bankFileName: string | null;
  glFileName: string | null;
  toleranceDays: DateTolerance;
  /** แถวเต็มทั้งหมดตามลำดับเดิมในไฟล์ (หรือลำดับเดิมตอนโหลดมาจากประวัติ) — ต้องเป็น "ชุดข้อมูลเต็ม" เสมอ
   * (ทั้งที่อยู่ใน matchGroups ด้านล่างและที่ยังไม่จับคู่) ไม่ใช่แค่แถวที่ยังไม่จับคู่ ใช้กำหนด row_order ที่
   * ส่งไปบันทึก เพื่อให้กด "ตรวจสอบข้อมูล" ซ้ำหลัง reopen ได้ผลลัพธ์เหมือนอัปโหลดไฟล์ใหม่ทุกประการ */
  allBankRows: BankTransaction[];
  allGlRows: GLTransaction[];
  matchGroups: MatchGroup[];
}

interface ReconcileReportRow extends ReconcileReportSummary {
  created_by: string | null;
  created_by_email: string | null;
  updated_by: string | null;
  updated_by_email: string | null;
}

interface MatchGroupRow {
  id: string;
  report_id: string;
  match_type: MatchType;
  type: TransactionType;
}

interface BankRowRecord {
  id: string;
  match_group_id: string | null;
  row_order: number;
  transaction_date: string;
  type: TransactionType;
  amount: string | number;
}

interface GlRowRecord {
  id: string;
  match_group_id: string | null;
  row_order: number;
  document_no: string;
  transaction_date: string;
  type: TransactionType;
  amount: string | number;
}

function toBankTransaction(row: BankRowRecord): BankTransaction {
  return { id: row.id, date: row.transaction_date, type: row.type, amount: Number(row.amount) };
}

function toGLTransaction(row: GlRowRecord): GLTransaction {
  return { id: row.id, documentNo: row.document_no, date: row.transaction_date, type: row.type, amount: Number(row.amount) };
}

export async function fetchReconcileReports(): Promise<ReconcileReportSummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .select('*')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReconcileReportSummary[];
}

/** โหลดรายการประวัติ 1 รายการแบบเต็ม (header + แถว Bank/GL ทั้งหมด + กลุ่มที่จับคู่ไว้) พร้อมใช้ hydrate
 * BankReconcileWorkspace ได้ทันทีโดยไม่ต้องอัปโหลดไฟล์ใหม่เลย — ดึง 4 ตารางพร้อมกันด้วย Promise.all แล้ว
 * ประกอบผลลัพธ์ฝั่ง client (ไม่มี join ในฐานข้อมูล เพื่อให้แต่ละตารางยังคง select('*') ธรรมดาได้) */
export async function getReportDetail(id: string): Promise<ReconcileReportDetail> {
  const supabase = getSupabaseClient();

  const [reportRes, groupsRes, bankRes, glRes] = await Promise.all([
    supabase.from(REPORTS_TABLE).select('*').eq('id', id).single(),
    supabase.from(MATCH_GROUPS_TABLE).select('*').eq('report_id', id),
    supabase.from(BANK_ROWS_TABLE).select('*').eq('report_id', id).order('row_order', { ascending: true }),
    supabase.from(GL_ROWS_TABLE).select('*').eq('report_id', id).order('row_order', { ascending: true }),
  ]);
  if (reportRes.error) throw reportRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if (bankRes.error) throw bankRes.error;
  if (glRes.error) throw glRes.error;

  const groupRows = (groupsRes.data ?? []) as MatchGroupRow[];
  const bankRowRecords = (bankRes.data ?? []) as BankRowRecord[];
  const glRowRecords = (glRes.data ?? []) as GlRowRecord[];

  const bankRows = bankRowRecords.map(toBankTransaction);
  const glRows = glRowRecords.map(toGLTransaction);

  const bankRowsByGroup = new Map<string, BankTransaction[]>();
  bankRowRecords.forEach((record, index) => {
    if (!record.match_group_id) return;
    const list = bankRowsByGroup.get(record.match_group_id) ?? [];
    list.push(bankRows[index]);
    bankRowsByGroup.set(record.match_group_id, list);
  });
  const glRowsByGroup = new Map<string, GLTransaction[]>();
  glRowRecords.forEach((record, index) => {
    if (!record.match_group_id) return;
    const list = glRowsByGroup.get(record.match_group_id) ?? [];
    list.push(glRows[index]);
    glRowsByGroup.set(record.match_group_id, list);
  });

  const matchGroups: MatchGroup[] = groupRows.map((group) => ({
    groupId: group.id,
    matchType: group.match_type,
    type: group.type,
    bankRows: bankRowsByGroup.get(group.id) ?? [],
    glRows: glRowsByGroup.get(group.id) ?? [],
  }));

  const bankUnmatched = bankRowRecords
    .map((record, index) => (record.match_group_id ? null : bankRows[index]))
    .filter((row): row is BankTransaction => row !== null);
  const glUnmatched = glRowRecords
    .map((record, index) => (record.match_group_id ? null : glRows[index]))
    .filter((row): row is GLTransaction => row !== null);

  return {
    report: reportRes.data as ReconcileReportSummary,
    bankRows,
    glRows,
    matchGroups,
    bankUnmatched,
    glUnmatched,
  };
}

/** บันทึก (สร้างใหม่หรือทับรายการเดิม) แบบ atomic ทั้งชุดผ่าน RPC เดียว — คืนค่า id ของรายการที่บันทึก
 * (เดิมหรือใหม่) ให้ผู้เรียกใช้สลับไปโหมด "เปิดจากประวัติ" ต่อได้ทันทีหลังบันทึกครั้งแรก */
export async function saveReconcileReport(
  input: ReconcileReportWriteInput,
  actor: { id: string | null; email: string | null }
): Promise<string> {
  const supabase = getSupabaseClient();

  // map จาก id ของแถว (bank/gl) -> groupId ที่มันอยู่ ถ้ามี — ใช้แนบ match_group_id ให้ทุกแถวใน allBankRows/
  // allGlRows (ชุดข้อมูลเต็ม) ก่อนส่งไป RPC โดยไม่ต้องพึ่งรายการ "unmatched" แยกต่างหาก (unmatched = ไม่อยู่ใน
  // map นี้เลย)
  const bankGroupById = new Map<string, string>();
  const glGroupById = new Map<string, string>();
  input.matchGroups.forEach((group) => {
    group.bankRows.forEach((row) => bankGroupById.set(row.id, group.groupId));
    group.glRows.forEach((row) => glGroupById.set(row.id, group.groupId));
  });

  const bankPayload = input.allBankRows.map((row, index) => ({
    match_group_id: bankGroupById.get(row.id) ?? null,
    row_order: index,
    transaction_date: row.date,
    type: row.type,
    amount: row.amount,
  }));
  const glPayload = input.allGlRows.map((row, index) => ({
    match_group_id: glGroupById.get(row.id) ?? null,
    row_order: index,
    document_no: row.documentNo,
    transaction_date: row.date,
    type: row.type,
    amount: row.amount,
  }));
  const groupsPayload = input.matchGroups.map((group) => ({
    id: group.groupId,
    match_type: group.matchType,
    type: group.type,
  }));
  const reportPayload = {
    id: input.id,
    report_name: input.reportName,
    period_month: input.periodMonth,
    period_year: input.periodYear,
    status: input.status,
    bank_file_name: input.bankFileName,
    gl_file_name: input.glFileName,
    tolerance_days: input.toleranceDays,
    created_by: actor.id,
    created_by_email: actor.email,
    updated_by: actor.id,
    updated_by_email: actor.email,
  };

  const { data, error } = await supabase.rpc('save_bank_reconcile_report', {
    p_report: reportPayload,
    p_match_groups: groupsPayload,
    p_bank_rows: bankPayload,
    p_gl_rows: glPayload,
  });
  if (error) throw error;
  return (data as ReconcileReportRow).id;
}
