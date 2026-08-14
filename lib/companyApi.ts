import { getSupabaseClient } from './supabaseClient';
import type { BranchType } from '@/types/contact';

/**
 * API สำหรับฟีเจอร์ "รองรับหลายบริษัท" (เพิ่มเข้ามา 2026-08-07 — ดู supabase/migration_007_multi_company.sql)
 * ดึงรายชื่อบริษัทที่ user ที่ login อยู่ตอนนี้เป็นสมาชิกอยู่ ผ่านตาราง company_members ที่ join กับ companies
 * — RLS ของทั้งสองตารางกรองให้เห็นเฉพาะแถวของตัวเองอยู่แล้วที่ชั้นฐานข้อมูล (ดู is_company_member() และ
 * policy "select_own_membership"/"select_member_companies") จึงไม่ต้อง filter เพิ่มฝั่ง client
 *
 * เพิ่มฟิลด์ข้อมูลบริษัท (tax_id, ที่อยู่, สำนักงานใหญ่/สาขา, ชื่อผู้ลงนามเริ่มต้น) พร้อมฟีเจอร์ "ตั้งค่าบริษัท"
 * (migration_013_company_settings.sql, 2026-08-11) — เป็นข้อมูลฝั่ง "ผู้มีหน้าที่หักภาษี ณ ที่จ่าย" (ผู้จ่ายเงิน)
 * บนใบหัก ณ ที่จ่ายที่จะออกในฟีเจอร์ถัดไป โครงสร้างที่อยู่/branch ใช้ชื่อฟิลด์เดียวกับ BusinessPartner
 * (types/contact.ts, สมุดรายชื่อ) เพื่อความสอดคล้องกัน — บริษัทของผู้ใช้เองถือเป็นนิติบุคคลเสมอ ไม่มี
 * entity_type แบบ BusinessPartner
 */
export interface Company {
  id: string;
  name: string;
  tax_id: string | null;
  branch_type: BranchType;
  branch_number: string | null;
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  default_signer_name: string | null;
  logo_url: string | null;
}

/** ค่าฟอร์มหน้า "ตั้งค่าบริษัท" — ทุกฟิลด์เป็น string (แม้แต่ select) เหมือน pattern ContactFormInput เดิม
 * แปลงเป็น payload จริงตอน submit เท่านั้น (ดู CompanySettingsPage.tsx) */
export interface CompanySettingsInput {
  tax_id: string;
  branch_type: BranchType;
  branch_number: string;
  address: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  default_signer_name: string;
}

const COMPANY_COLUMNS =
  'id, name, tax_id, branch_type, branch_number, address, subdistrict, district, province, postal_code, default_signer_name, logo_url';

/** bucket โลโก้บริษัท (ดู supabase/migration_017_company_logo.sql) — public bucket, path เก็บตายตัวเป็น
 * "{company_id}/logo.png" เสมอ (ไฟล์เดียวต่อบริษัท อัปโหลดใหม่ทับของเดิม ไม่มีสะสมไฟล์เก่าค้าง) */
const LOGO_BUCKET = 'company-logos';

function logoStoragePath(companyId: string): string {
  return `${companyId}/logo.png`;
}

interface CompanyMemberRow {
  companies: Company | Company[] | null;
}

export async function fetchMyCompanies(): Promise<Company[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('company_members')
    .select(`companies(${COMPANY_COLUMNS})`)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // PostgREST คืนค่า embedded resource เป็น object เดี่ยวปกติ (many-to-one ผ่าน foreign key) แต่ type ของ
  // supabase-js กำหนดเป็น array เผื่อกรณี relationship อื่น — normalize ให้เป็น Company เดี่ยวเสมอตรงนี้ที่
  // เดียว ผู้เรียกใช้ปลายทางไม่ต้องสนใจความกำกวมนี้เลย
  return ((data ?? []) as unknown as CompanyMemberRow[])
    .map((row) => (Array.isArray(row.companies) ? row.companies[0] : row.companies))
    .filter((c): c is Company => c !== null && c !== undefined);
}

/** บันทึกข้อมูล "ตั้งค่าบริษัท" (เพิ่มเข้ามา 2026-08-11 พร้อมพื้นฐานฟีเจอร์ออกใบหัก ณ ที่จ่าย) — สมาชิก
 * บริษัททุกคนแก้ไขได้ (ไม่ใช่แค่แอดมิน) ตาม policy "update_member_companies" ที่ฐานข้อมูล ล้าง
 * branch_number ทิ้งเป็น null เสมอถ้าเลือกสำนักงานใหญ่ (กันข้อมูลค้าง/ขัดกับ CHECK constraint ที่บังคับว่า
 * ต้องมีเลขสาขาเฉพาะตอนเลือก branch เท่านั้น) */
export async function updateCompanySettings(companyId: string, input: CompanySettingsInput): Promise<Company> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('companies')
    .update({
      tax_id: input.tax_id.trim() || null,
      branch_type: input.branch_type,
      branch_number: input.branch_type === 'branch' ? input.branch_number.trim() || null : null,
      address: input.address.trim() || null,
      subdistrict: input.subdistrict.trim() || null,
      district: input.district.trim() || null,
      province: input.province.trim() || null,
      postal_code: input.postal_code.trim() || null,
      default_signer_name: input.default_signer_name.trim() || null,
    })
    .eq('id', companyId)
    .select(COMPANY_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Company;
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

/**
 * อัปโหลดโลโก้บริษัท (เพิ่มเข้ามา 2026-08-14) — รับ Blob ที่ผ่านการตัดพื้นหลังสีขาวออกแล้วจากฝั่ง client
 * (lib/logoBackgroundRemoval.ts ผ่าน canvas.toBlob('image/png')) เท่านั้น ไม่ได้ทำ image processing ใดๆ
 * ที่นี่ — อัปโหลดทับ path เดิมเสมอ ("{company_id}/logo.png", upsert: true) ไม่มีไฟล์เก่าค้างสะสม แล้วอัปเดต
 * companies.logo_url ต่อทันทีในคำเรียกเดียวกัน (2 ขั้นตอนนี้ไม่ atomic ในระดับ DB แต่ยอมรับความเสี่ยงได้เพราะ
 * ถ้าอัปโหลด storage สำเร็จแต่ update ตารางล้มเหลว ผู้ใช้แค่กดบันทึกซ้ำ — ไม่ทำให้ข้อมูลเสียหายถาวร)
 *
 * เติม query string `?v=timestamp` ท้าย public URL เสมอ (แก้ปัญหา browser/CDN cache: path ไฟล์เดิมทุกครั้ง
 * ที่อัปโหลดใหม่ ถ้าไม่มี cache-busting โลโก้เก่าจะค้างแสดงอยู่จนกว่าจะ hard refresh)
 */
export async function uploadCompanyLogo(companyId: string, logoBlob: Blob): Promise<string> {
  const supabase = getSupabaseClient();
  const path = logoStoragePath(companyId);

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, logoBlob, { contentType: 'image/png', upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', companyId);
  if (updateError) throw updateError;

  return logoUrl;
}

/** ลบโลโก้บริษัท — ลบไฟล์ใน storage ก่อนแล้วค่อยล้าง companies.logo_url เป็น null (ถ้าลบไฟล์ไม่สำเร็จจะไม่ล้าง
 * ค่าในตาราง กันกรณี URL ชี้ไปยังไฟล์ที่ยังอยู่จริงถูกลบทิ้งจากหน้าจอไปเฉยๆ ทั้งที่ไฟล์ยังอยู่) */
export async function removeCompanyLogo(companyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: removeError } = await supabase.storage.from(LOGO_BUCKET).remove([logoStoragePath(companyId)]);
  if (removeError) throw removeError;

  const { error: updateError } = await supabase.from('companies').update({ logo_url: null }).eq('id', companyId);
  if (updateError) throw updateError;
}
