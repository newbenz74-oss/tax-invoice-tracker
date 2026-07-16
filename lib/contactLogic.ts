import type {
  BranchType,
  BusinessPartner,
  ContactFormInput,
  ContactStatus,
  EntityType,
  PartnerType,
} from '@/types/contact';

/** ป้ายชื่อประเภท — ใช้ในฟอร์ม, ตาราง, Segmented Control, และไฟล์ Excel (import/export) ให้ตรงกันทั้งระบบ */
export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  customer: 'ลูกค้า',
  vendor: 'ผู้จัดจำหน่าย',
};

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  individual: 'บุคคลธรรมดา',
  company: 'นิติบุคคล',
};

export const BRANCH_TYPE_LABELS: Record<BranchType, string> = {
  head_office: 'สำนักงานใหญ่',
  branch: 'สาขาที่',
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'เปิดใช้งาน',
  inactive: 'ไม่ใช้งาน',
};

export const PARTNER_TYPE_BADGE_CLASS: Record<PartnerType, string> = {
  customer: 'bg-primary-light text-primary',
  vendor: 'bg-purple-100 text-purple-700',
};

export const CONTACT_STATUS_BADGE_CLASS: Record<ContactStatus, string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-200 text-gray-600',
};

/** รหัสนำหน้าอัตโนมัติตามประเภท — CUS สำหรับลูกค้า, VEN สำหรับผู้จัดจำหน่าย ตามสเปก */
const CODE_PREFIX: Record<PartnerType, string> = {
  customer: 'CUS',
  vendor: 'VEN',
};

/** ชื่อที่แสดงในตาราง/ผลค้นหา — นิติบุคคลใช้ชื่อบริษัท, บุคคลธรรมดาใช้ชื่อ+นามสกุล */
export function getContactDisplayName(
  contact: Pick<BusinessPartner, 'entity_type' | 'company_name' | 'first_name' | 'last_name'>
): string {
  if (contact.entity_type === 'company') {
    return contact.company_name?.trim() || '-';
  }
  const name = [contact.first_name, contact.last_name].filter((v) => v && v.trim()).join(' ');
  return name || '-';
}

/** ป้ายสาขาที่แสดงในตาราง — "สำนักงานใหญ่" หรือ "สาขาที่ 00001" */
export function formatBranchLabel(contact: Pick<BusinessPartner, 'branch_type' | 'branch_number'>): string {
  if (contact.branch_type === 'head_office') return BRANCH_TYPE_LABELS.head_office;
  return contact.branch_number ? `${BRANCH_TYPE_LABELS.branch} ${contact.branch_number}` : BRANCH_TYPE_LABELS.branch;
}

/** normalize รหัสก่อนตรวจสอบ/บันทึกเสมอ (ตัดช่องว่างหัวท้าย + ตัวพิมพ์ใหญ่ทั้งหมด) เพื่อไม่ให้
 * "cus0001" กับ "CUS0001" ถูกมองว่าเป็นคนละรหัสกัน — ใช้ทั้งตอน validate, บันทึกจากฟอร์ม, และนำเข้า Excel */
export function normalizeContactCode(code: string): string {
  return code.trim().toUpperCase();
}

/** สร้างรหัสถัดไปแบบเรียงลำดับตามประเภท (CUS0001, CUS0002, ... / VEN0001, VEN0002, ...) — สแกนรหัส
 * เดิมทั้งหมดที่ขึ้นต้นด้วย prefix เดียวกัน หาเลขมากที่สุดแล้ว +1 (ไม่ใช่นับจำนวนแถว เพื่อกันปัญหารหัส
 * ไม่ต่อเนื่องจากการลบ/แก้ไขรายการเดิม) ผู้ใช้แก้ไขรหัสที่เสนอให้นี้เองได้ก่อนบันทึกเสมอ (ดู ContactForm.tsx) */
export function generateNextContactCode(partnerType: PartnerType, existing: BusinessPartner[]): string {
  const prefix = CODE_PREFIX[partnerType];
  let maxNum = 0;
  for (const c of existing) {
    const code = c.contact_code.trim().toUpperCase();
    if (!code.startsWith(prefix)) continue;
    const num = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export interface ContactValidationOptions {
  /** รายชื่อทั้งหมดที่มีอยู่แล้ว — ใช้ตรวจสอบรหัสซ้ำ */
  existing: BusinessPartner[];
  /** id ของรายชื่อที่กำลังแก้ไข (ไม่ใช่การเพิ่มใหม่) — ยกเว้นตัวเองออกจากการตรวจสอบรหัสซ้ำ */
  editingId?: string | null;
}

/** ตรวจสอบความถูกต้องของฟอร์ม คืนค่า object ของ error รายฟิลด์ (ว่างถ้าไม่มี error) — ทุก error
 * แสดงเป็นข้อความใต้ฟิลด์เสมอ (ไม่ใช้ browser alert ตามสเปก) ดู Field component ใน ContactForm.tsx */
export function validateContactForm(
  input: ContactFormInput,
  options: ContactValidationOptions
): Partial<Record<keyof ContactFormInput, string>> {
  const errors: Partial<Record<keyof ContactFormInput, string>> = {};

  if (!input.partner_type) {
    errors.partner_type = 'กรุณาเลือกประเภท';
  }
  if (!input.entity_type) {
    errors.entity_type = 'กรุณาเลือกประเภทบุคคล';
  }

  const code = normalizeContactCode(input.contact_code);
  if (!code) {
    errors.contact_code = 'กรุณากรอกรหัส';
  } else {
    const dup = options.existing.find(
      (c) => c.id !== options.editingId && normalizeContactCode(c.contact_code) === code
    );
    if (dup) errors.contact_code = `รหัสนี้ถูกใช้ไปแล้ว (${dup.contact_code})`;
  }

  if (input.entity_type === 'company' && !input.company_name.trim()) {
    errors.company_name = 'กรุณากรอกชื่อบริษัท';
  }
  if (input.entity_type === 'individual') {
    if (!input.first_name.trim()) errors.first_name = 'กรุณากรอกชื่อ';
    if (!input.last_name.trim()) errors.last_name = 'กรุณากรอกนามสกุล';
  }

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

  if (input.phone.trim() && !/^[\d\s\-+]+$/.test(input.phone.trim())) {
    errors.phone = 'เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข ช่องว่าง เครื่องหมาย - และ +';
  }

  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';
  }

  return errors;
}

export interface ContactFilterOptions {
  partnerType?: PartnerType | 'all';
  search?: string;
}

/** กรองตาม Segmented Control (ทั้งหมด/ลูกค้า/ผู้จัดจำหน่าย) + ค้นหา — ค้นหาครอบคลุมรหัส, ชื่อ,
 * นามสกุล, ชื่อบริษัท, เลขประจำตัวผู้เสียภาษี, เบอร์โทรศัพท์, Email ตามสเปก */
export function filterContacts(contacts: BusinessPartner[], opts: ContactFilterOptions): BusinessPartner[] {
  let result = contacts;

  if (opts.partnerType && opts.partnerType !== 'all') {
    result = result.filter((c) => c.partner_type === opts.partnerType);
  }

  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim().toLowerCase();
    result = result.filter(
      (c) =>
        c.contact_code.toLowerCase().includes(q) ||
        (c.first_name ?? '').toLowerCase().includes(q) ||
        (c.last_name ?? '').toLowerCase().includes(q) ||
        (c.company_name ?? '').toLowerCase().includes(q) ||
        (c.tax_id ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
    );
  }

  return result;
}

export interface ContactCounts {
  all: number;
  customer: number;
  vendor: number;
}

/** จำนวนรายชื่อของแต่ละ tab ใน Segmented Control — นับทุกสถานะรวมกัน (active + inactive) เพราะสถานะ
 * ไม่ใช่มิติของ Segmented Control นี้ (สถานะแสดงเป็น badge ในตารางแทน) */
export function computeContactCounts(contacts: BusinessPartner[]): ContactCounts {
  return {
    all: contacts.length,
    customer: contacts.filter((c) => c.partner_type === 'customer').length,
    vendor: contacts.filter((c) => c.partner_type === 'vendor').length,
  };
}
