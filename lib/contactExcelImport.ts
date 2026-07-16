import * as XLSX from 'xlsx';
import type { BranchType, BusinessPartner, ContactStatus, EntityType, PartnerType } from '@/types/contact';
import type { ContactWriteInput } from './contactApi';
import { normalizeContactCode } from './contactLogic';

/**
 * ⚠️ ไฟล์นี้เป็นเส้นทางนำเข้า Excel ของ "สมุดรายชื่อ" โดยเฉพาะ แยกต่างหากจาก lib/excelImport.ts
 * (ของหน้า "บันทึกค่าใช้จ่าย") โดยสิ้นเชิงตามที่กำหนดไว้ — ไม่ import อะไรจากไฟล์นั้นเลยแม้แต่บรรทัด
 * เดียว (แม้แต่ฟังก์ชันอ่านไฟล์ทั่วไปอย่าง readWorkbookRows ก็ทำสำเนาไว้ในไฟล์นี้ต่างหาก) เพื่อให้มั่นใจ
 * 100% ว่าการแก้ไข/บั๊กใดๆ ในฟีเจอร์นี้จะไม่มีทางกระทบ Excel Import ของหน้าบันทึกค่าใช้จ่ายเดิมเลย
 */
export const CONTACT_EXCEL_HEADERS = {
  partner_type: 'ประเภท',
  contact_code: 'รหัส',
  entity_type: 'ประเภทบุคคล',
  company_name: 'ชื่อบริษัท',
  first_name: 'ชื่อ',
  last_name: 'นามสกุล',
  tax_id: 'เลขประจำตัวผู้เสียภาษี',
  branch_type: 'สาขา',
  branch_number: 'เลขสาขา',
  address: 'ที่อยู่',
  subdistrict: 'ตำบล/แขวง',
  district: 'อำเภอ/เขต',
  province: 'จังหวัด',
  postal_code: 'รหัสไปรษณีย์',
  phone: 'เบอร์โทรศัพท์',
  email: 'Email',
  contact_person: 'ผู้ติดต่อ',
  note: 'หมายเหตุ',
  status: 'สถานะ',
} as const;

export const CONTACT_EXCEL_HEADER_ORDER = Object.values(CONTACT_EXCEL_HEADERS);

const PARTNER_TYPE_FROM_LABEL: Record<string, PartnerType> = {
  ลูกค้า: 'customer',
  ผู้จัดจำหน่าย: 'vendor',
};
const ENTITY_TYPE_FROM_LABEL: Record<string, EntityType> = {
  บุคคลธรรมดา: 'individual',
  นิติบุคคล: 'company',
};
const BRANCH_TYPE_FROM_LABEL: Record<string, BranchType> = {
  สำนักงานใหญ่: 'head_office',
  สาขาที่: 'branch',
};
const STATUS_FROM_LABEL: Record<string, ContactStatus> = {
  เปิดใช้งาน: 'active',
  ไม่ใช้งาน: 'inactive',
};

export interface ContactImportRow {
  rowNumber: number;
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
  errors: string[];
  warnings: string[];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

/**
 * แปลง 1 แถวดิบจาก Excel ให้เป็น ContactImportRow พร้อมตรวจสอบความถูกต้อง แถวที่ว่างทั้งแถวคืนค่า
 * null เพื่อข้ามไปได้ (ไม่ตรวจรหัสซ้ำในนี้ — ตรวจแยกด้วย annotateDuplicateCodeErrors ด้านล่าง
 * เพราะต้องเทียบกับแถวอื่นในไฟล์เดียวกันและข้อมูลที่มีอยู่แล้ว ไม่ใช่แค่แถวตัวเอง)
 */
export function parseContactRow(raw: Record<string, unknown>, rowNumber: number): ContactImportRow | null {
  const partnerLabel = cellToString(raw[CONTACT_EXCEL_HEADERS.partner_type]);
  const contact_code = cellToString(raw[CONTACT_EXCEL_HEADERS.contact_code]);
  const entityLabel = cellToString(raw[CONTACT_EXCEL_HEADERS.entity_type]);
  const company_name = cellToString(raw[CONTACT_EXCEL_HEADERS.company_name]);
  const first_name = cellToString(raw[CONTACT_EXCEL_HEADERS.first_name]);
  const last_name = cellToString(raw[CONTACT_EXCEL_HEADERS.last_name]);
  const tax_id = cellToString(raw[CONTACT_EXCEL_HEADERS.tax_id]);
  const branchLabel = cellToString(raw[CONTACT_EXCEL_HEADERS.branch_type]);
  const branch_number = cellToString(raw[CONTACT_EXCEL_HEADERS.branch_number]);
  const address = cellToString(raw[CONTACT_EXCEL_HEADERS.address]);
  const subdistrict = cellToString(raw[CONTACT_EXCEL_HEADERS.subdistrict]);
  const district = cellToString(raw[CONTACT_EXCEL_HEADERS.district]);
  const province = cellToString(raw[CONTACT_EXCEL_HEADERS.province]);
  const postal_code = cellToString(raw[CONTACT_EXCEL_HEADERS.postal_code]);
  const phone = cellToString(raw[CONTACT_EXCEL_HEADERS.phone]);
  const email = cellToString(raw[CONTACT_EXCEL_HEADERS.email]);
  const contact_person = cellToString(raw[CONTACT_EXCEL_HEADERS.contact_person]);
  const note = cellToString(raw[CONTACT_EXCEL_HEADERS.note]);
  const statusLabel = cellToString(raw[CONTACT_EXCEL_HEADERS.status]);

  const isRowEmpty =
    !partnerLabel &&
    !contact_code &&
    !entityLabel &&
    !company_name &&
    !first_name &&
    !last_name &&
    !tax_id &&
    !branchLabel &&
    !address &&
    !phone &&
    !email;
  if (isRowEmpty) return null;

  const errors: string[] = [];
  const warnings: string[] = [];

  let partner_type: PartnerType | '' = '';
  if (!partnerLabel) {
    errors.push('ไม่ได้ระบุประเภท (ลูกค้า/ผู้จัดจำหน่าย)');
  } else {
    const matched = PARTNER_TYPE_FROM_LABEL[partnerLabel];
    if (!matched) errors.push(`ประเภท "${partnerLabel}" ไม่ถูกต้อง (ต้องเป็น "ลูกค้า" หรือ "ผู้จัดจำหน่าย")`);
    else partner_type = matched;
  }

  if (!contact_code) errors.push('ไม่ได้กรอกรหัส');

  let entity_type: EntityType | '' = '';
  if (!entityLabel) {
    errors.push('ไม่ได้ระบุประเภทบุคคล (บุคคลธรรมดา/นิติบุคคล)');
  } else {
    const matched = ENTITY_TYPE_FROM_LABEL[entityLabel];
    if (!matched) errors.push(`ประเภทบุคคล "${entityLabel}" ไม่ถูกต้อง (ต้องเป็น "บุคคลธรรมดา" หรือ "นิติบุคคล")`);
    else entity_type = matched;
  }

  if (entity_type === 'company' && !company_name) {
    errors.push('นิติบุคคลต้องกรอกชื่อบริษัท');
  }
  if (entity_type === 'individual' && (!first_name || !last_name)) {
    errors.push('บุคคลธรรมดาต้องกรอกชื่อและนามสกุล');
  }

  if (tax_id && !/^\d{13}$/.test(tax_id)) {
    errors.push('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  }

  let branch_type: BranchType = 'head_office';
  if (branchLabel) {
    const matched = BRANCH_TYPE_FROM_LABEL[branchLabel];
    if (!matched) errors.push(`สาขา "${branchLabel}" ไม่ถูกต้อง (ต้องเป็น "สำนักงานใหญ่" หรือ "สาขาที่")`);
    else branch_type = matched;
  }
  if (branch_type === 'branch') {
    if (!branch_number) errors.push('เลือก "สาขาที่" ต้องกรอกเลขสาขาด้วย');
    else if (!/^\d{5}$/.test(branch_number)) errors.push('เลขสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001');
  }

  if (postal_code && !/^\d{5}$/.test(postal_code)) {
    errors.push('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('รูปแบบอีเมลไม่ถูกต้อง');
  }

  if (phone && !/^[\d\s\-+]+$/.test(phone)) {
    errors.push('เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข ช่องว่าง เครื่องหมาย - และ +');
  }

  let status: ContactStatus = 'active';
  if (statusLabel) {
    const matched = STATUS_FROM_LABEL[statusLabel];
    if (!matched) errors.push(`สถานะ "${statusLabel}" ไม่ถูกต้อง (ต้องเป็น "เปิดใช้งาน" หรือ "ไม่ใช้งาน")`);
    else status = matched;
  }

  return {
    rowNumber,
    partner_type,
    contact_code,
    entity_type,
    company_name,
    first_name,
    last_name,
    tax_id,
    branch_type,
    branch_number,
    address,
    subdistrict,
    district,
    province,
    postal_code,
    phone,
    email,
    contact_person,
    note,
    status,
    errors,
    warnings,
  };
}

export function parseContactRows(rawRows: Record<string, unknown>[]): ContactImportRow[] {
  const rows: ContactImportRow[] = [];
  rawRows.forEach((raw, idx) => {
    // แถวที่ 1 ในไฟล์คือ header เสมอ ดังนั้นแถวข้อมูลแถวแรก (idx 0) = แถวที่ 2 จริง
    const parsed = parseContactRow(raw, idx + 2);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

/** หารหัสที่ซ้ำกันเองภายในไฟล์เดียวกัน (นับทุกแถวที่มีรหัสซ้ำ ไม่ใช่แค่แถวหลัง) */
export function findDuplicateCodesInFile(rows: ContactImportRow[]): Set<number> {
  const firstSeenAt = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const row of rows) {
    const code = normalizeContactCode(row.contact_code);
    if (!code) continue;
    const existingRowNumber = firstSeenAt.get(code);
    if (existingRowNumber !== undefined) {
      duplicates.add(existingRowNumber);
      duplicates.add(row.rowNumber);
    } else {
      firstSeenAt.set(code, row.rowNumber);
    }
  }
  return duplicates;
}

/** หารหัสที่ซ้ำกับรายชื่อที่มีอยู่แล้วในระบบ (มาจากฐานข้อมูลจริง ไม่ใช่ไฟล์ที่กำลังนำเข้า) */
export function findDuplicateCodesVsExisting(rows: ContactImportRow[], existing: BusinessPartner[]): Set<number> {
  const existingCodes = new Set(existing.map((c) => normalizeContactCode(c.contact_code)));
  const duplicates = new Set<number>();
  for (const row of rows) {
    const code = normalizeContactCode(row.contact_code);
    if (code && existingCodes.has(code)) duplicates.add(row.rowNumber);
  }
  return duplicates;
}

/** เติม error ของรหัสซ้ำ (ทั้งในไฟล์เดียวกันและซ้ำกับข้อมูลเดิม) เข้าไปในแต่ละแถว — รหัสซ้ำถือเป็น
 * ข้อผิดพลาดที่บล็อกการนำเข้า (ไม่ใช่แค่คำเตือน) เพราะ contact_code มี UNIQUE constraint จริงที่
 * ฐานข้อมูล การนำเข้าแถวที่รหัสซ้ำจะทำให้ทั้งไฟล์ import ไม่สำเร็จเลย (all-or-nothing) จึงต้องดักไว้
 * ตั้งแต่หน้าตรวจสอบก่อนนำเข้าจริง */
export function annotateDuplicateCodeErrors(
  rows: ContactImportRow[],
  existing: BusinessPartner[]
): ContactImportRow[] {
  const inFileDup = findDuplicateCodesInFile(rows);
  const vsExistingDup = findDuplicateCodesVsExisting(rows, existing);
  return rows.map((row) => {
    const extra: string[] = [];
    if (inFileDup.has(row.rowNumber)) extra.push('รหัสนี้ซ้ำกับแถวอื่นในไฟล์เดียวกัน');
    if (vsExistingDup.has(row.rowNumber)) extra.push('รหัสนี้มีอยู่แล้วในระบบ');
    if (extra.length === 0) return row;
    return { ...row, errors: [...row.errors, ...extra] };
  });
}

/** แปลงแถวที่ผ่านการตรวจสอบแล้วให้เป็น payload สำหรับบันทึกลง Supabase — normalize รหัสเป็นตัวพิมพ์
 * ใหญ่เสมอ (เหมือนตอนบันทึกจากฟอร์ม) ควรเรียกเฉพาะแถวที่ไม่มี errors ค้างอยู่แล้วเท่านั้น */
export function contactRowToWriteInput(row: ContactImportRow): ContactWriteInput {
  const partnerType: PartnerType = row.partner_type || 'customer';
  const entityType: EntityType = row.entity_type || 'individual';
  return {
    partner_type: partnerType,
    contact_code: normalizeContactCode(row.contact_code),
    entity_type: entityType,
    company_name: row.company_name.trim() || null,
    first_name: row.first_name.trim() || null,
    last_name: row.last_name.trim() || null,
    tax_id: row.tax_id.trim() || null,
    branch_type: row.branch_type,
    branch_number: row.branch_type === 'branch' ? row.branch_number.trim() || null : null,
    address: row.address.trim() || null,
    subdistrict: row.subdistrict.trim() || null,
    district: row.district.trim() || null,
    province: row.province.trim() || null,
    postal_code: row.postal_code.trim() || null,
    phone: row.phone.trim() || null,
    email: row.email.trim() || null,
    contact_person: row.contact_person.trim() || null,
    note: row.note.trim() || null,
    status: row.status,
  };
}

/** อ่านไฟล์ Excel (ArrayBuffer) แล้วแปลงชีทแรกให้เป็น array ของแถวดิบ — สำเนาของ readWorkbookRows ใน
 * lib/excelImport.ts ตั้งใจทำแยกไว้ต่างหาก (ไม่ import ข้ามไฟล์กัน) ตามที่อธิบายไว้ด้านบนของไฟล์นี้ */
export function readContactWorkbookRows(data: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
}

/** สร้างไฟล์ Excel เทมเพลตพร้อมตัวอย่าง 2 แถว (นิติบุคคล 1 + บุคคลธรรมดา 1) คืนค่าเป็น Blob พร้อมดาวน์โหลด */
export function buildContactTemplateBlob(): Blob {
  const exampleRows: Record<string, unknown>[] = [
    {
      [CONTACT_EXCEL_HEADERS.partner_type]: 'ลูกค้า',
      [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001',
      [CONTACT_EXCEL_HEADERS.entity_type]: 'นิติบุคคล',
      [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท ตัวอย่าง จำกัด',
      [CONTACT_EXCEL_HEADERS.first_name]: '',
      [CONTACT_EXCEL_HEADERS.last_name]: '',
      [CONTACT_EXCEL_HEADERS.tax_id]: '0105500000000',
      [CONTACT_EXCEL_HEADERS.branch_type]: 'สำนักงานใหญ่',
      [CONTACT_EXCEL_HEADERS.branch_number]: '',
      [CONTACT_EXCEL_HEADERS.address]: '123 ถนนตัวอย่าง',
      [CONTACT_EXCEL_HEADERS.subdistrict]: 'ตัวอย่าง',
      [CONTACT_EXCEL_HEADERS.district]: 'ตัวอย่าง',
      [CONTACT_EXCEL_HEADERS.province]: 'กรุงเทพมหานคร',
      [CONTACT_EXCEL_HEADERS.postal_code]: '10110',
      [CONTACT_EXCEL_HEADERS.phone]: '02-123-4567',
      [CONTACT_EXCEL_HEADERS.email]: 'contact@example.com',
      [CONTACT_EXCEL_HEADERS.contact_person]: 'คุณตัวอย่าง',
      [CONTACT_EXCEL_HEADERS.note]: '(ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
      [CONTACT_EXCEL_HEADERS.status]: 'เปิดใช้งาน',
    },
    {
      [CONTACT_EXCEL_HEADERS.partner_type]: 'ผู้จัดจำหน่าย',
      [CONTACT_EXCEL_HEADERS.contact_code]: 'VEN0001',
      [CONTACT_EXCEL_HEADERS.entity_type]: 'บุคคลธรรมดา',
      [CONTACT_EXCEL_HEADERS.company_name]: '',
      [CONTACT_EXCEL_HEADERS.first_name]: 'สมชาย',
      [CONTACT_EXCEL_HEADERS.last_name]: 'ใจดี',
      [CONTACT_EXCEL_HEADERS.tax_id]: '',
      [CONTACT_EXCEL_HEADERS.branch_type]: 'สำนักงานใหญ่',
      [CONTACT_EXCEL_HEADERS.branch_number]: '',
      [CONTACT_EXCEL_HEADERS.address]: '',
      [CONTACT_EXCEL_HEADERS.subdistrict]: '',
      [CONTACT_EXCEL_HEADERS.district]: '',
      [CONTACT_EXCEL_HEADERS.province]: '',
      [CONTACT_EXCEL_HEADERS.postal_code]: '',
      [CONTACT_EXCEL_HEADERS.phone]: '081-234-5678',
      [CONTACT_EXCEL_HEADERS.email]: '',
      [CONTACT_EXCEL_HEADERS.contact_person]: '',
      [CONTACT_EXCEL_HEADERS.note]: '(ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย)',
      [CONTACT_EXCEL_HEADERS.status]: 'เปิดใช้งาน',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(exampleRows, { header: CONTACT_EXCEL_HEADER_ORDER });
  worksheet['!cols'] = CONTACT_EXCEL_HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'สมุดรายชื่อ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
