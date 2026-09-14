import { getSupabaseClient } from './supabaseClient';
import { AUDIT_PAGE_SIZE, type AuditLogEntry, type AuditLogFilter } from '@/types/auditLog';

/**
 * ชั้นคุยกับ Supabase ของหน้า "ประวัติการใช้งาน" — ตรรกะการแปลงเป็นภาษาคนอยู่ใน lib/auditLogLogic.ts
 * (เทสต์แยกไว้แล้ว) ที่นี่มีแต่การอ่านจริงกับการเรียก RPC เท่านั้น ตามการแบ่งชั้นเดียวกับทั้งโปรเจกต์
 *
 * ไม่มีฟังก์ชันเขียน/ลบประวัติในไฟล์นี้โดยเจตนา และเขียนไม่ได้จริงๆ ด้วย — ตาราง audit_logs มี RLS policy
 * แค่ select อย่างเดียว (ดูหัวข้อ 2 ใน supabase/migration_026_audit_logs.sql) แถวถูกเขียนโดย trigger ฝั่ง
 * ฐานข้อมูลเท่านั้น ถ้าวันหนึ่งมีใครเผลอเพิ่มฟังก์ชันเขียนที่นี่ Supabase จะปฏิเสธเอง
 */

export const AUDIT_LOGS_SWR_KEY = 'audit-logs';

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** ยังมีหน้าถัดไปหรือไม่ — ดูจากการขอเกินมา 1 แถว (ถูกกว่าการสั่งนับทั้งตารางทุกครั้ง) */
  hasMore: boolean;
}

/**
 * ดึงประวัติหนึ่งหน้า เรียงใหม่สุดก่อนเสมอ
 *
 * กรองที่ฝั่งฐานข้อมูลทุกเงื่อนไข ไม่ใช่ดึงมาทั้งหมดแล้วค่อยกรองในเบราว์เซอร์ — ตารางนี้โตตลอดเวลาและไม่มี
 * การลบอัตโนมัติ บริษัทที่ใช้งานมาสองสามปีอาจมีเป็นแสนแถว การดึงมาทั้งหมดจะทำให้หน้าค้างและเปลืองโควตา
 *
 * เรียงด้วย id ไม่ใช่ created_at เพราะสองแถวที่เกิดในวินาที (หรือไมโครวินาที) เดียวกันอาจมี created_at
 * เท่ากันเป๊ะ แล้วลำดับจะไม่คงที่ระหว่างหน้า ทำให้แถวซ้ำหรือหลุดหายตอนกดหน้าถัดไป — id เป็น identity
 * ที่เพิ่มขึ้นตามลำดับการเกิดจริงเสมอ จึงเรียงได้แน่นอน (ดูเหตุผลการเลือก bigint ใน migration_026)
 */
export async function fetchAuditLogs(
  companyId: string,
  filter: AuditLogFilter,
  page: number
): Promise<AuditLogPage> {
  const supabase = getSupabaseClient();
  const from = (page - 1) * AUDIT_PAGE_SIZE;

  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('company_id', companyId)
    .order('id', { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE); // ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม

  if (filter.table !== 'all') query = query.eq('table_name', filter.table);
  if (filter.action !== 'all') query = query.eq('action', filter.action);
  if (filter.actorEmail !== 'all') query = query.eq('actor_email', filter.actorEmail);

  const search = filter.search.trim();
  if (search) {
    // ilike = ค้นหาแบบไม่สนตัวพิมพ์เล็กใหญ่ — escape % และ _ ที่เป็นอักขระพิเศษของ LIKE ก่อนเสมอ ไม่งั้น
    // ผู้ใช้ที่พิมพ์ "50%" จะได้ผลลัพธ์มั่วเพราะ % ถูกตีความเป็น "อะไรก็ได้"
    const safe = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    query = query.ilike('record_label', `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as AuditLogEntry[];
  return {
    entries: rows.slice(0, AUDIT_PAGE_SIZE),
    hasMore: rows.length > AUDIT_PAGE_SIZE,
  };
}

/* ============================== หน้าต่างพักการบันทึกระหว่างกู้คืนข้อมูล ==============================
   ทั้ง 3 ฟังก์ชันนี้เรียกจาก lib/backupApi.ts เท่านั้น — เหตุผลเต็มว่าทำไมต้องพักการบันทึกและข้อแลกเปลี่ยน
   ที่ยอมรับไว้ อยู่ที่หัวข้อ 3 ของ supabase/migration_026_audit_logs.sql */

export async function beginRestoreAuditWindow(companyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('audit_begin_restore', { p_company_id: companyId });
  if (error) throw error;
}

export async function endRestoreAuditWindow(
  companyId: string,
  summary: string,
  details: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('audit_end_restore', {
    p_company_id: companyId,
    p_summary: summary,
    p_details: details,
  });
  if (error) throw error;
}

/** ปิดหน้าต่างแบบไม่เขียนสรุป — ใช้เมื่อกู้คืนล้มเหลวกลางคัน จะได้ไม่ทิ้งหน้าต่างค้างไว้จนหมดอายุเอง */
export async function cancelRestoreAuditWindow(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('audit_cancel_restore');
  if (error) throw error;
}
