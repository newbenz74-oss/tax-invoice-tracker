import type { CompanySettingsInput } from './companyApi';

/** ตรวจสอบความถูกต้องของฟอร์ม "ตั้งค่าบริษัท" (เพิ่มเข้ามา 2026-08-11) คืนค่า object ของ error รายฟิลด์
 * (ว่างถ้าไม่มี error) — เงื่อนไขเดียวกับ validateContactForm ใน lib/contactLogic.ts ทุกจุดที่ใช้ตรวจสอบ
 * รูปแบบเดียวกัน (เลขผู้เสียภาษี 13 หลัก, เลขที่สาขา 5 หลัก, รหัสไปรษณีย์ 5 หลัก) เพื่อความสอดคล้องกันทั้งระบบ
 * — ต่างจาก validateContactForm ตรงที่ไม่มี partner_type/entity_type/contact_code/ชื่อ ให้ตรวจสอบ เพราะ
 * บริษัทของผู้ใช้เองมีชื่ออยู่แล้ว (ตอนสร้างบริษัท) ไม่ได้แก้ผ่านฟอร์มนี้ ทุกฟิลด์ในฟอร์มนี้ไม่บังคับกรอก
 * ยกเว้นเลขที่สาขา (บังคับเฉพาะตอนเลือก "สาขา") */
export function validateCompanySettingsForm(
  input: CompanySettingsInput
): Partial<Record<keyof CompanySettingsInput, string>> {
  const errors: Partial<Record<keyof CompanySettingsInput, string>> = {};

  if (input.tax_id.trim() && !/^\d{13}$/.test(input.tax_id.trim())) {
    errors.tax_id = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
  }

  if (input.branch_type === 'branch') {
    if (!input.branch_number.trim()) {
      errors.branch_number = 'กรุณากรอกเลขที่สาขา';
    } else if (!/^\d{5}$/.test(input.branch_number.trim())) {
      errors.branch_number = 'เลขที่สาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001';
    }
  }

  if (input.postal_code.trim() && !/^\d{5}$/.test(input.postal_code.trim())) {
    errors.postal_code = 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก';
  }

  return errors;
}
