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

  // อีเมลบริษัท (เพิ่มเข้ามา 2026-10-11) — ไม่บังคับกรอก แต่ถ้ากรอกต้องใช้ได้จริง เพราะค่านี้ถูกใส่เป็น CC
  // ของอีเมลใบหัก ณ ที่จ่ายทุกฉบับ ถ้าพิมพ์ผิดจะทำให้ "ส่งไม่ออกทั้งฉบับ" ไม่ใช่แค่สำเนาไม่ถึง (SMTP ปฏิเสธ
  // ทั้งข้อความเมื่อมีผู้รับที่อยู่ผิดรูปแบบ) จึงต้องดักตั้งแต่ตอนตั้งค่า ไม่ปล่อยไปเจอตอนกดส่ง
  //
  // ตรวจแบบหลวมๆ พอ (มี @ หนึ่งตัว มีอะไรอยู่สองข้าง ไม่มีช่องว่าง และฝั่งโดเมนมีจุด) — ไม่ใช้ regex ยาวๆ
  // ตามมาตรฐาน RFC เพราะอีเมลที่ถูกต้องตาม RFC มีรูปแบบแปลกๆ ที่ไม่มีใครใช้จริง และ regex พวกนั้นมักตัด
  // อีเมลที่ใช้งานได้จริงทิ้งโดยไม่ตั้งใจ ซึ่งแย่กว่าปล่อยให้พิมพ์ผิดหลุดไปแล้ว SMTP ตีกลับมาบอกเอง
  const email = input.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'รูปแบบอีเมลไม่ถูกต้อง เช่น accounting@company.co.th';
  }

  return errors;
}
