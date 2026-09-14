/**
 * ประเภทข้อมูลของ "ประวัติการใช้งาน" (Audit Log) — ดู supabase/migration_026_audit_logs.sql สำหรับ
 * โครงตารางจริงและเหตุผลการออกแบบทั้งหมด
 */

/** ตารางที่เปิดบันทึกประวัติไว้ — ต้องตรงกับ trigger ที่ผูกไว้ใน migration_026 เป๊ะๆ */
export const AUDITED_TABLES = [
  'pending_tax_invoices',
  'business_partners',
  'wht_certificates',
  'bank_reconcile_reports',
  'company_members',
] as const;

export type AuditedTable = (typeof AUDITED_TABLES)[number];

/**
 * ชนิดการกระทำ — 3 ตัวแรกมาจาก trigger ตรงๆ (lower(TG_OP)) ส่วน restore_begin/restore_end เขียนจาก
 * RPC ตอนกู้คืนข้อมูลจากไฟล์สำรอง (ดูหัวข้อ 3 ใน migration_026)
 *
 * table_name ของสองตัวหลังเป็น '-' เพราะไม่ได้ผูกกับตารางใดตารางหนึ่ง — เป็นเหตุการณ์ระดับทั้งบริษัท
 */
export type AuditAction = 'insert' | 'update' | 'delete' | 'restore_begin' | 'restore_end';

export interface AuditLogEntry {
  id: number;
  company_id: string;
  /** ชื่อตาราง หรือ '-' สำหรับเหตุการณ์ระดับบริษัท (restore_begin/restore_end) */
  table_name: string;
  record_id: string;
  /** ชื่อที่คนอ่านรู้เรื่อง เก็บไว้ตั้งแต่ตอนเกิดเหตุ — null ได้ถ้าแถวนั้นไม่มีคอลัมน์ชื่อให้ใช้ */
  record_label: string | null;
  action: AuditAction;
  /** เฉพาะ action 'update' — ชื่อคอลัมน์ที่ค่าเปลี่ยนจริง */
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  actor_id: string | null;
  /** null เมื่อการเปลี่ยนแปลงเกิดนอกระบบ (SQL editor / service role) — แสดงเป็น "ระบบ" */
  actor_email: string | null;
  created_at: string;
}

/** ตัวกรองของหน้าประวัติ — ค่า 'all' คือไม่กรอง (ไม่ใช่ค่าว่าง เพื่อให้ <select> มีค่าเสมอ) */
export interface AuditLogFilter {
  table: AuditedTable | 'all';
  action: AuditAction | 'all';
  /** อีเมลผู้กระทำ — 'all' คือทุกคน */
  actorEmail: string | 'all';
  /** ค้นหาจากชื่อรายการ (record_label) แบบบางส่วน ไม่สนตัวพิมพ์เล็กใหญ่ */
  search: string;
}

export const DEFAULT_AUDIT_FILTER: AuditLogFilter = {
  table: 'all',
  action: 'all',
  actorEmail: 'all',
  search: '',
};

/** จำนวนแถวต่อหน้า — ตารางนี้โตเร็ว จึงโหลดทีละหน้าเสมอ ไม่ดึงทั้งหมดมาแล้วค่อยกรองในเบราว์เซอร์ */
export const AUDIT_PAGE_SIZE = 50;
