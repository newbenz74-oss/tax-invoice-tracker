import type { BusinessPartner, EntityType } from '@/types/contact';
import type { WhtDeductionType, WhtFormType, WhtIncomeTypeCode, WhtPartySnapshot, WhtPayeeSnapshot } from '@/types/whtCertificate';
import type { Company } from './companyApi';
import { getContactDisplayName } from './contactLogic';

/** เลือกรหัสฟอร์มจากประเภทบุคคลของผู้ถูกหักภาษี ณ ที่จ่าย (จากสมุดรายชื่อ) — นิติบุคคล → 53, บุคคลธรรมดา → 03 */
export function formTypeForEntityType(entityType: EntityType): WhtFormType {
  return entityType === 'company' ? '53' : '03';
}

/** ประกอบเลขที่ใบหัก ณ ที่จ่ายตามรูปแบบที่ผู้ใช้ระบุ: {รหัสฟอร์ม}-{ปี พ.ศ. 2 หลักท้าย}{เดือน 2 หลัก}{ลำดับ 3 หลัก}
 * เช่น formatWhtCertNumber('53', 2569, 8, 1) -> "53-6908001" — buddhistYear รับเป็นปี พ.ศ. เต็ม 4 หลัก
 * (เช่น 2569 ไม่ใช่ 69) ตัดเอาแค่ 2 หลักท้ายเองภายในฟังก์ชันนี้ เพื่อให้เรียกใช้แบบเดียวกับ
 * currentBuddhistYear()/vat_claim_year ที่อื่นในระบบ (ไม่ต้องแปลงเองก่อนเรียก) sequence รับมาจากผลลัพธ์ของ
 * RPC get_next_wht_cert_number() เสมอ (ไม่ generate เลขเองฝั่ง frontend) ฟังก์ชันนี้ทำหน้าที่แค่ "จัดรูปแบบ
 * ตัวเลขที่ได้มาแล้วให้เป็น string ที่ถูกต้อง" เท่านั้น */
export function formatWhtCertNumber(
  formType: WhtFormType,
  buddhistYear: number,
  month: number,
  sequence: number
): string {
  const yy = String(buddhistYear % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const seq = String(sequence).padStart(3, '0');
  return `${formType}-${yy}${mm}${seq}`;
}

/** ป้ายชื่อประเภทเงินได้ — ใช้ในตัวเลือกตอนออกใบและตอนแสดงผล PDF ให้ตรงกัน ข้อความยกมาจากฟอร์มจริง
 * (ตัดคำอธิบายย่อยยาวๆ ในวงเล็บออก เหลือแค่หัวข้อหลักพอสั้นกระชับสำหรับใช้เป็นตัวเลือกในฟอร์ม) */
export const INCOME_TYPE_LABELS: Record<WhtIncomeTypeCode, string> = {
  '1': '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ (ม. 40(1))',
  '2': '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ (ม. 40(2))',
  '3': '3. ค่าแห่งลิขสิทธิ์ ฯลฯ (ม. 40(3))',
  '5': '5. ตามคำสั่งกรมสรรพากร มาตรา 3 เตรส (เช่น ค่าขนส่ง ค่าเช่า ค่าบริการ รางวัล)',
  '6': '6. อื่นๆ',
};

export const DEDUCTION_TYPE_LABELS: Record<WhtDeductionType, string> = {
  withholding: 'หักภาษี ณ ที่จ่าย',
  pay_forever: 'ออกให้ตลอดไป',
  pay_once: 'ออกภาษีให้ครั้งเดียว',
  other: 'อื่นๆ',
};

/** สร้าง snapshot ฝั่งผู้จ่ายเงินจากข้อมูล "ตั้งค่าบริษัท" ปัจจุบัน — เรียกตอนกดยืนยันออกใบเท่านั้น (ไม่ใช่
 * ตอนเปิดฟอร์ม) เพื่อให้ snapshot เป็นค่าล่าสุด ณ วินาทีที่ออกใบจริง */
export function buildPayerSnapshot(company: Company): WhtPartySnapshot {
  return {
    name: company.name,
    tax_id: company.tax_id,
    branch_type: company.branch_type,
    branch_number: company.branch_number,
    address: company.address,
    subdistrict: company.subdistrict,
    district: company.district,
    province: company.province,
    postal_code: company.postal_code,
  };
}

/** หารายชื่อผู้ขาย (vendor) ในสมุดรายชื่อที่ชื่อแสดงผลตรงกับ vendor_name ของรายการจ่ายเงินเป๊ะๆ (ตัดช่องว่าง
 * หน้า-หลังก่อนเทียบ ไม่ตัดตัวพิมพ์เล็ก-ใหญ่เพราะเป็นภาษาไทยเป็นหลัก) ใช้ตอนเปิด modal ออกใบหัก ณ ที่จ่าย
 * เพื่อจับคู่ผู้ขายอัตโนมัติ — ตั้งใจไม่ทำ fuzzy match (เช่น partial/similar name) เพราะข้อมูลบนใบต้องแม่นยำ
 * 100% เป็นเอกสารทางการ ถ้าจับคู่ผิดคนจะเป็นปัญหาใหญ่กว่าจับคู่ไม่ได้เลย (กรณีนั้นเตือนให้ผู้ใช้ไปเพิ่ม/แก้
 * ชื่อในสมุดรายชื่อเองแทน — ดู components/IssueWhtCertificateModal.tsx) คืนได้มากกว่า 1 รายการถ้าสมุดรายชื่อ
 * มีชื่อซ้ำกัน (ผู้ใช้เลือกเองว่าจะใช้รายชื่อไหน) กรองเฉพาะ partner_type 'vendor' และ status 'active' เท่านั้น
 * (รายชื่อที่ปิดใช้งานไปแล้วไม่ควรใช้ออกเอกสารใหม่) */
export function findPayeeCandidates(vendorName: string, contacts: BusinessPartner[]): BusinessPartner[] {
  const target = vendorName.trim();
  if (!target) return [];
  return contacts.filter(
    (c) => c.partner_type === 'vendor' && c.status === 'active' && getContactDisplayName(c) === target
  );
}

/** สร้าง snapshot ฝั่งผู้ถูกหักภาษี ณ ที่จ่ายจากรายชื่อที่จับคู่ได้ในสมุดรายชื่อ — ใช้ getContactDisplayName
 * เดียวกับที่ตารางสมุดรายชื่อใช้แสดงผล (นิติบุคคลใช้ชื่อบริษัท, บุคคลธรรมดาใช้ชื่อ+นามสกุล) เพื่อให้ชื่อบนใบ
 * ตรงกับที่แสดงในสมุดรายชื่อเป๊ะๆ ไม่ต้องคำนวณซ้ำ/พลาดจุดใดจุดหนึ่ง */
export function buildPayeeSnapshot(partner: BusinessPartner): WhtPayeeSnapshot {
  return {
    entity_type: partner.entity_type,
    name: getContactDisplayName(partner),
    tax_id: partner.tax_id,
    branch_type: partner.branch_type,
    branch_number: partner.branch_number,
    address: partner.address,
    subdistrict: partner.subdistrict,
    district: partner.district,
    province: partner.province,
    postal_code: partner.postal_code,
  };
}
