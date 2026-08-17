import type { BranchType, EntityType } from './contact';

/** รหัสฟอร์มที่ขึ้นต้นเลขที่ใบหัก ณ ที่จ่าย — "53" คู่กับแบบ ภ.ง.ด.53 (ผู้ถูกหักเป็นนิติบุคคล) และ "03"
 * คู่กับแบบ ภ.ง.ด.3 (ผู้ถูกหักเป็นบุคคลธรรมดา) ตัวนับ (wht_certificate_counters) แยกชุดกันตามรหัสนี้ ดู
 * supabase/migration_014_wht_certificate_numbering.sql */
export type WhtFormType = '53' | '03';

/** รหัสประเภทเงินได้พึงประเมินที่จ่าย ตามหมวดบนแบบฟอร์มหนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ) — รองรับแค่
 * 5 จาก 6 หมวดของฟอร์มจริง (ตัดหมวด 4 ดอกเบี้ย/เงินปันผลออก ดูเหตุผลเต็มใน
 * supabase/migration_015_wht_certificates.sql) '1'=เงินเดือนค่าจ้าง, '2'=ค่าธรรมเนียมค่านายหน้า,
 * '3'=ค่าลิขสิทธิ์, '5'=ตามคำสั่งกรมสรรพากร มาตรา 3 เตรส (ค่าขนส่ง/ค่าเช่า/รางวัล ฯลฯ), '6'=อื่นๆ (เช่น
 * ค่าบริการ ตามตัวอย่างจริงที่ผู้ใช้ส่งมา) */
export type WhtIncomeTypeCode = '1' | '2' | '3' | '5' | '6';

/** ช่องติ๊กด้านล่างฟอร์ม "ผู้จ่ายเงิน [ ] หักภาษี ณ ที่จ่าย [ ] ออกให้ตลอดไป [ ] ออกภาษีให้ครั้งเดียว [ ] อื่นๆ"
 * ค่าเริ่มต้นคือ withholding (หักภาษี ณ ที่จ่าย) ตรงกับตัวอย่างจริงที่ผู้ใช้ส่งมาและเป็นกรณีปกติเกือบทั้งหมด */
export type WhtDeductionType = 'withholding' | 'pay_forever' | 'pay_once' | 'other';

export type WhtCertificateStatus = 'issued' | 'voided';

/** แถวข้อมูลจากตาราง wht_certificates — ดู supabase/migration_015_wht_certificates.sql
 * คอลัมน์ payer_ และ payee_ ทั้งหมดเป็น snapshot ณ วันที่ออกใบ ไม่ใช่ live reference ไปยัง companies/
 * business_partners (แก้ข้อมูลบริษัท/สมุดรายชื่อภายหลัง ใบที่ออกไปแล้วจะไม่เปลี่ยนตาม) */
export interface WhtCertificate {
  id: string;
  company_id: string;
  cert_number: string;
  form_type: WhtFormType;
  period_year: number;
  period_month: number;
  sequence_number: number;
  business_partner_id: string;
  income_type_code: WhtIncomeTypeCode;
  income_type_label: string | null;
  deduction_type: WhtDeductionType;
  deduction_type_note: string | null;
  signer_name: string | null;
  issued_date: string;
  payment_date: string;
  total_amount: number;
  total_wht_amount: number;
  payer_name: string;
  payer_tax_id: string | null;
  payer_branch_type: BranchType;
  payer_branch_number: string | null;
  payer_address: string | null;
  payer_subdistrict: string | null;
  payer_district: string | null;
  payer_province: string | null;
  payer_postal_code: string | null;
  payee_entity_type: EntityType;
  payee_name: string;
  payee_tax_id: string | null;
  payee_branch_type: BranchType;
  payee_branch_number: string | null;
  payee_address: string | null;
  payee_subdistrict: string | null;
  payee_district: string | null;
  payee_province: string | null;
  payee_postal_code: string | null;
  status: WhtCertificateStatus;
  voided_at: string | null;
  void_reason: string | null;
  // เพิ่มพร้อมปุ่ม "ส่งอีเมล" (migration_017, 2026-08-11) — email_sent_at = null หมายถึงยังไม่เคยส่งอีเมล
  // ใบนี้เลย ส่งซ้ำได้เรื่อยๆ ไม่มีการล็อก ค่านี้อัปเดตเป็นครั้งล่าสุดเสมอ (ไม่เก็บประวัติการส่งทุกครั้ง)
  // email_sent_to เป็น snapshot ที่อยู่อีเมล ณ ตอนส่งจริง ไม่ใช่ live reference ไปยังสมุดรายชื่อ
  email_sent_at: string | null;
  email_sent_to: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

/** ค่าที่ผู้ใช้กรอกตอนออกใบหัก ณ ที่จ่ายจริง (ดู components/IssueWhtCertificateModal.tsx) — formType/
 * businessPartnerId มาจากผู้ขายที่จับคู่ได้จากสมุดรายชื่อ ไม่ใช่กรอกเอง periodYear/periodMonth ใช้กำหนด
 * ว่าเลขที่จะรันในชุดของเดือน/ปีไหน (ปกติคือเดือน/ปีที่ออกใบจริง ไม่ใช่เดือนที่ทำรายการ) */
export interface CreateWhtCertificateInput {
  companyId: string;
  formType: WhtFormType;
  periodYear: number;
  periodMonth: number;
  businessPartnerId: string;
  incomeTypeCode: WhtIncomeTypeCode;
  incomeTypeLabel: string;
  deductionType: WhtDeductionType;
  deductionTypeNote: string;
  signerName: string;
  issuedDate: string;
  invoiceIds: string[];
  // เลขที่ใบ (ลำดับที่) ที่ผู้ใช้ระบุเอง (เพิ่มเข้ามา 2026-08-17 พร้อม migration_020) — undefined/ไม่ส่ง =
  // ให้ RPC รันเลขให้อัตโนมัติเหมือนเดิม ดู IssueWhtCertificateModal.tsx สำหรับ UI preview+แก้ไขเลขนี้
  sequenceOverride?: number;
}

/** ข้อมูล "ฝ่ายหนึ่งฝ่ายใด" (ผู้จ่าย/ผู้ถูกหัก) ที่ส่งเข้า RPC create_wht_certificate เป็น jsonb (p_payer/
 * p_payee) — โครงสร้างเดียวกับคอลัมน์ payer_ และ payee_ บนตาราง wht_certificates เพราะจะถูกคัดลอกเป็น
 * snapshot ตรงๆ ดู lib/whtCertificateLogic.ts buildPayerSnapshot()/buildPayeeSnapshot() สำหรับตัวแปลงจาก
 * Company/BusinessPartner จริง */
export interface WhtPartySnapshot {
  name: string;
  tax_id: string | null;
  branch_type: BranchType;
  branch_number: string | null;
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
}

/** ฝั่งผู้ถูกหักภาษี ณ ที่จ่ายเท่านั้นที่มี entity_type เพิ่ม (ใช้ตัดสินใจ formType 53/03 และ label
 * "สำนักงานใหญ่/สาขา" — ฝั่งผู้จ่าย (บริษัทของผู้ใช้เอง) ถือเป็นนิติบุคคลเสมอ ไม่ต้องมีฟิลด์นี้) */
export interface WhtPayeeSnapshot extends WhtPartySnapshot {
  entity_type: EntityType;
}
