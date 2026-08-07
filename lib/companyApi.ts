import { getSupabaseClient } from './supabaseClient';

/**
 * API สำหรับฟีเจอร์ "รองรับหลายบริษัท" (เพิ่มเข้ามา 2026-08-07 — ดู supabase/migration_007_multi_company.sql)
 * ดึงรายชื่อบริษัทที่ user ที่ login อยู่ตอนนี้เป็นสมาชิกอยู่ ผ่านตาราง company_members ที่ join กับ companies
 * — RLS ของทั้งสองตารางกรองให้เห็นเฉพาะแถวของตัวเองอยู่แล้วที่ชั้นฐานข้อมูล (ดู is_company_member() และ
 * policy "select_own_membership"/"select_member_companies") จึงไม่ต้อง filter เพิ่มฝั่ง client
 */
export interface Company {
  id: string;
  name: string;
}

interface CompanyMemberRow {
  companies: Company | Company[] | null;
}

export async function fetchMyCompanies(): Promise<Company[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('company_members')
    .select('companies(id, name)')
    .order('created_at', { ascending: true });
  if (error) throw error;

  // PostgREST คืนค่า embedded resource เป็น object เดี่ยวปกติ (many-to-one ผ่าน foreign key) แต่ type ของ
  // supabase-js กำหนดเป็น array เผื่อกรณี relationship อื่น — normalize ให้เป็น Company เดี่ยวเสมอตรงนี้ที่
  // เดียว ผู้เรียกใช้ปลายทางไม่ต้องสนใจความกำกวมนี้เลย
  return ((data ?? []) as unknown as CompanyMemberRow[])
    .map((row) => (Array.isArray(row.companies) ? row.companies[0] : row.companies))
    .filter((c): c is Company => c !== null && c !== undefined);
}

/**
 * สร้างบริษัทใหม่ + ผูกผู้เรียกเป็นสมาชิกทันที (self-service — เพิ่มเข้ามา 2026-08-07 ดู
 * supabase/migration_008_self_service_create_company.sql) ผ่าน RPC เดียวแบบ atomic เหมือนรูปแบบเดียวกับ
 * saveReconcileReport ใน lib/bankReconcileReportApi.ts (supabase.rpc -> { data, error } -> throw ถ้ามี error)
 */
export async function createCompany(name: string): Promise<Company> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('create_company', { p_name: name });
  if (error) throw error;
  return data as Company;
}
