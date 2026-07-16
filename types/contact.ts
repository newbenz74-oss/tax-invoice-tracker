/** ประเภทของรายชื่อ — ลูกค้า หรือ ผู้จัดจำหน่าย (เลือกได้อย่างใดอย่างหนึ่งเท่านั้นต่อ 1 รายชื่อ) */
export type PartnerType = 'customer' | 'vendor';

/** ประเภทบุคคล — กำหนดว่าฟิลด์ชื่อกลุ่มไหนบังคับกรอก (ดู lib/contactLogic.ts validateContactForm) */
export type EntityType = 'individual' | 'company';

/** สำนักงานใหญ่ หรือ สาขาที่ (ต้องกรอกเลขสาขาเพิ่มถ้าเลือก branch) */
export type BranchType = 'head_office' | 'branch';

/** เปิดใช้งาน / ไม่ใช้งาน — "ปิดใช้งาน" ในตารางเป็นการ toggle ค่านี้ ไม่ใช่การลบข้อมูล */
export type ContactStatus = 'active' | 'inactive';

/** แถวข้อมูลจากตาราง business_partners (สมุดรายชื่อ) — ดู supabase/migration_004_business_partners.sql
 * เป็นตารางใหม่ทั้งหมด ไม่เกี่ยวข้อง/ไม่กระทบตาราง pending_tax_invoices เดิมเลย */
export interface BusinessPartner {
  id: string;
  partner_type: PartnerType;
  contact_code: string;
  entity_type: EntityType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  tax_id: string | null;
  branch_type: BranchType;
  branch_number: string | null;
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  note: string | null;
  status: ContactStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** ค่าฟอร์มเพิ่ม/แก้ไขรายชื่อ — ทุกฟิลด์เป็น string (แม้แต่ select) เพื่อควบคุมเป็น controlled input
 * ได้ง่าย เหมือน InvoiceFormInput เดิม แปลงเป็น payload จริงตอน submit เท่านั้น (ดู ContactForm.tsx) */
export interface ContactFormInput {
  partner_type: PartnerType | '';
  contact_code: string;
  entity_type: EntityType | '';
  company_name: string;
  first_name: string;
  last_name: string;
  tax_id: string;
  branch_type: BranchType;
  branch_number: string;
  address: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  phone: string;
  email: string;
  contact_person: string;
  note: string;
  status: ContactStatus;
}
