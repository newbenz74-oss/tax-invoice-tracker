import { formatThaiDate } from './thaiDate';
import type { AuditAction, AuditLogEntry } from '@/types/auditLog';

/**
 * ตรรกะล้วนของหน้า "ประวัติการใช้งาน" — แปลงแถวดิบจากตาราง audit_logs ให้เป็นภาษาที่คนทำบัญชีอ่านรู้เรื่อง
 *
 * ไฟล์นี้ตั้งใจไม่มีการเรียก Supabase / React / DOM เลยแม้แต่บรรทัดเดียว (รูปแบบเดียวกับ lib/invoiceLogic.ts,
 * lib/backupLogic.ts ฯลฯ) เพื่อให้เขียนเทสต์ครอบคลุมได้ทั้งหมดโดยไม่ต้องต่อฐานข้อมูลจริง — ดู
 * lib/auditLogLogic.test.ts
 *
 * หลักการแปลง: ฐานข้อมูลเก็บ "ข้อเท็จจริงดิบ" (ชื่อคอลัมน์จริง ค่าจริง ก่อน/หลัง) ส่วนการตีความเป็นประโยค
 * ภาษาไทยทำที่ชั้นนี้ทั้งหมด — ถ้าวันหนึ่งอยากเปลี่ยนคำพูดหรือเพิ่มภาษา ไม่ต้องแตะข้อมูลที่บันทึกไปแล้วเลย
 */

/** ชื่อตารางจริง → ชื่อที่ผู้ใช้เห็นในระบบ (ตรงกับชื่อเมนูใน lib/navigation.ts ให้มากที่สุด) */
const TABLE_LABELS: Record<string, string> = {
  pending_tax_invoices: 'ใบกำกับภาษี',
  business_partners: 'สมุดรายชื่อ',
  wht_certificates: 'ใบหัก ณ ที่จ่าย',
  bank_reconcile_reports: 'รายงานกระทบยอด',
  company_members: 'สมาชิกบริษัท',
};

export function tableLabel(tableName: string): string {
  // '-' คือเหตุการณ์ระดับบริษัทที่ไม่ผูกกับตารางใด (กู้คืนข้อมูล) — ดู types/auditLog.ts
  if (tableName === '-') return 'ทั้งบริษัท';
  return TABLE_LABELS[tableName] ?? tableName;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  insert: 'เพิ่ม',
  update: 'แก้ไข',
  delete: 'ลบ',
  restore_begin: 'เริ่มกู้คืนข้อมูล',
  restore_end: 'กู้คืนข้อมูลสำเร็จ',
};

export function actionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * ชื่อคอลัมน์จริง → ชื่อที่คนอ่านรู้เรื่อง
 *
 * รวมทุกตารางไว้ในชุดเดียวโดยตั้งใจ ไม่แยกตามตาราง เพราะชื่อคอลัมน์ในโปรเจกต์นี้ตั้งไม่ซ้ำความหมายกันอยู่แล้ว
 * (เช่น total_amount หมายถึง "ยอดรวม" เหมือนกันทั้งใบกำกับภาษีและใบหัก ณ ที่จ่าย) การรวมไว้ที่เดียวทำให้
 * เพิ่มตารางใหม่ทีหลังแทบไม่ต้องแก้อะไรเลย — คอลัมน์ที่ไม่มีในชุดนี้จะแสดงชื่อจริงตรงๆ ซึ่งยังพออ่านออก
 * ดีกว่าซ่อนไว้แล้วผู้ใช้ไม่รู้ว่ามีอะไรเปลี่ยน
 */
const FIELD_LABELS: Record<string, string> = {
  // ใบกำกับภาษี
  vendor_name: 'ชื่อผู้ขาย',
  transaction_date: 'วันที่รายการ',
  description: 'รายละเอียด',
  amount_excl_vat: 'ยอดก่อน VAT',
  vat_amount: 'ภาษีมูลค่าเพิ่ม',
  total_amount: 'ยอดรวม',
  reference_no: 'เลขที่อ้างอิง',
  expected_date: 'วันที่คาดว่าจะได้รับ',
  status: 'สถานะ',
  received_date: 'วันที่ได้รับ',
  tax_invoice_number: 'เลขที่ใบกำกับภาษี',
  notes: 'หมายเหตุ',
  tax_type: 'ประเภทภาษี',
  wht_amount: 'ภาษีหัก ณ ที่จ่าย',

  // สมุดรายชื่อ
  partner_type: 'ประเภทคู่ค้า',
  contact_code: 'รหัส',
  entity_type: 'ประเภทบุคคล',
  company_name: 'ชื่อบริษัท',
  first_name: 'ชื่อ',
  last_name: 'นามสกุล',
  tax_id: 'เลขผู้เสียภาษี',
  branch_type: 'ประเภทสาขา',
  branch_number: 'เลขที่สาขา',
  address: 'ที่อยู่',
  subdistrict: 'ตำบล/แขวง',
  district: 'อำเภอ/เขต',
  province: 'จังหวัด',
  postal_code: 'รหัสไปรษณีย์',
  phone: 'โทรศัพท์',
  email: 'อีเมล',
  contact_person: 'ผู้ติดต่อ',

  // ใบหัก ณ ที่จ่าย
  cert_number: 'เลขที่ใบรับรอง',
  form_type: 'แบบฟอร์ม',
  period_year: 'ปี',
  period_month: 'เดือน',
  sequence_number: 'ลำดับที่',
  income_type_code: 'ประเภทเงินได้',
  income_type_label: 'ชื่อประเภทเงินได้',
  deduction_type: 'วิธีการหักภาษี',
  signer_name: 'ผู้ลงนาม',
  issued_date: 'วันที่ออก',
  payment_date: 'วันที่จ่ายเงิน',
  total_wht_amount: 'ยอดภาษีที่หัก',
  payee_name: 'ชื่อผู้ถูกหักภาษี',
  payer_name: 'ชื่อผู้จ่ายเงิน',
  voided_at: 'วันที่ยกเลิก',
  void_reason: 'เหตุผลที่ยกเลิก',

  // รายงานกระทบยอด
  report_name: 'ชื่อรายงาน',
  bank_file_name: 'ไฟล์ Bank Statement',
  gl_file_name: 'ไฟล์ GL',
  tolerance_days: 'ช่วงวันที่ยอมรับได้',
  bank_row_count: 'จำนวนแถว Bank',
  gl_row_count: 'จำนวนแถว GL',
  matched_group_count: 'จำนวนคู่ที่จับได้',

  // ทั่วไป
  company_id: 'บริษัท',
  user_id: 'ผู้ใช้',
  created_at: 'วันที่สร้าง',
  logo_url: 'โลโก้',

  // รายละเอียดของเหตุการณ์กู้คืนข้อมูล (p_details ที่ lib/backupApi.ts ส่งเข้า RPC audit_end_restore)
  // — ไม่ใช่ชื่อคอลัมน์ของตารางไหน แต่ใช้ช่องทางแปลชื่อเดียวกันเพราะแสดงผลด้วยกลไกเดียวกัน
  mode: 'วิธีการกู้คืน',
  totalRows: 'จำนวนรายการทั้งหมด',
  rowsByTable: 'จำนวนรายการแยกตามตาราง',
  logoRestored: 'กู้คืนโลโก้สำเร็จ',
  backupExportedAt: 'ไฟล์สำรองสร้างเมื่อ',
  backupExportedByEmail: 'ไฟล์สำรองสร้างโดย',
  sourceCompanyId: 'บริษัทต้นทางของไฟล์',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * คอลัมน์ที่ไม่ต้องแสดงในรายการ "อะไรเปลี่ยนบ้าง"
 *
 * เป็นค่าที่ระบบจัดการเองล้วนๆ ไม่ใช่สิ่งที่ผู้ใช้ตั้งใจแก้ — โชว์ไปก็มีแต่บดบังการเปลี่ยนแปลงจริง
 * (updated_at/updated_by ถูกกรองไปแล้วตั้งแต่ชั้น trigger ใน SQL แต่ใส่ซ้ำไว้ที่นี่ด้วยเพื่อให้ชั้นแสดงผล
 * ถูกต้องเสมอแม้ข้อมูลเก่าที่บันทึกไว้ก่อนหน้าจะมีค่าเหล่านี้ติดมา)
 */
const HIDDEN_FIELDS = new Set([
  'id',
  'company_id',
  'created_at',
  'created_by',
  'created_by_email',
  'updated_at',
  'updated_by',
  'updated_by_email',
]);

/** ค่า enum ในฐานข้อมูล → คำไทย (ใช้ร่วมกันทุกตารางด้วยเหตุผลเดียวกับ FIELD_LABELS) */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  // คอลัมน์ชื่อ status ถูกใช้ใน 3 ตารางที่มีชุดค่าคนละชุดกันโดยสิ้นเชิง — รวมไว้ที่เดียวได้เพราะค่าไม่ชนกัน
  // (ใบกำกับภาษี: pending/received/cancelled — รายงานกระทบยอด: draft/complete — ใบหัก ณ ที่จ่าย:
  // issued/voided ตาม migration_015) ถ้าวันหนึ่งมีตารางใหม่ใช้ค่าที่ซ้ำกับของเดิมแต่คนละความหมาย ต้องแยก
  // ชุดตามตารางแทน
  status: {
    pending: 'รอรับใบกำกับภาษี',
    received: 'ได้รับแล้ว',
    cancelled: 'ยกเลิก',
    draft: 'ทำค้างไว้',
    complete: 'เสร็จสมบูรณ์',
    issued: 'ออกแล้ว',
    voided: 'ยกเลิกแล้ว',
  },
  partner_type: { customer: 'ลูกค้า', vendor: 'ผู้จัดจำหน่าย' },
  entity_type: { individual: 'บุคคลธรรมดา', company: 'นิติบุคคล' },
  payee_entity_type: { individual: 'บุคคลธรรมดา', company: 'นิติบุคคล' },
  form_type: { '53': 'ภ.ง.ด.53', '03': 'ภ.ง.ด.3' },
  deduction_type: {
    withholding: 'หัก ณ ที่จ่าย',
    pay_forever: 'ออกให้ตลอดไป',
    pay_once: 'ออกให้ครั้งเดียว',
    other: 'อื่นๆ',
  },
  branch_type: { head_office: 'สำนักงานใหญ่', branch: 'สาขา' },
  payer_branch_type: { head_office: 'สำนักงานใหญ่', branch: 'สาขา' },
};

/**
 * คอลัมน์ที่ "หน้าตาเป็นตัวเลข แต่ไม่ใช่จำนวน" — ห้ามใส่คอมมาคั่นหลักพันเด็ดขาด
 *
 * เดิมโค้ดนี้ใส่คอมมาให้ทุกค่าที่เป็นตัวเลขล้วน ซึ่งทำให้เลขผู้เสียภาษี 13 หลัก '0105558012345' กลายเป็น
 * "105,558,012,345" (เลขศูนย์นำหน้าหายไปด้วย), รหัสไปรษณีย์ '10110' กลายเป็น "10,110", เบอร์โทร
 * '021234567' กลายเป็น "21,234,567" และเลขที่สาขา '00001' กลายเป็น "1" — คือค่าที่ผิดจนใช้อ้างอิงไม่ได้เลย
 *
 * ใช้บัญชีรายชื่อแบบ "ห้ามจัดรูปแบบ" แทน "อนุญาตให้จัดรูปแบบ" โดยตั้งใจ เพราะคอลัมน์จำนวนเงิน/จำนวนนับมี
 * เยอะกว่าและเพิ่มใหม่บ่อยกว่ามาก ถ้าลืมใส่ในบัญชีก็แค่ไม่มีคอมมา (อ่านออก) แต่ถ้าลืมกันคอลัมน์รหัสไว้จะได้
 * ค่าที่ผิดความหมายไปเลย — เลือกให้ผลของการลืมเบาที่สุด
 */
/** คอลัมน์ที่เก็บเป็นวันที่ ISO (YYYY-MM-DD) — ต้องแสดงเป็น วว/ดด/ปปปป ปี พ.ศ. เหมือนทุกหน้าในระบบ */
const DATE_FIELDS = new Set([
  'transaction_date',
  'expected_date',
  'received_date',
  'tax_invoice_date',
  'issued_date',
  'payment_date',
  // จงใจไม่ใส่ voided_at — เป็น timestamptz (มีเวลาต่อท้าย) ไม่ใช่ date เปล่าๆ แปลงด้วย formatThaiDate
  // ไม่ได้ ปล่อยให้แสดงค่าดิบไปก่อน ดีกว่าแสดงผิด
]);

const RAW_NUMERIC_FIELDS = new Set([
  'tax_id',
  'payer_tax_id',
  'payee_tax_id',
  'postal_code',
  'payer_postal_code',
  'payee_postal_code',
  'phone',
  'branch_number',
  'payer_branch_number',
  'payee_branch_number',
  'contact_code',
  'reference_no',
  'tax_invoice_number',
  'cert_number',
  'period_year',
  'period_month',
  'sequence_number',
  'form_type',
  'income_type_code',
]);

/**
 * แปลงค่าดิบเป็นข้อความสำหรับแสดงผล
 *
 * ตัวเลขที่เป็น "จำนวน" จริงๆ (เงิน/จำนวนรายการ) ใส่คอมมาคั่นหลักพันเสมอเพราะอ่านง่ายกว่ามาก ส่วนตัวเลขที่
 * เป็น "รหัส" คืนค่าเดิมดิบๆ ตาม RAW_NUMERIC_FIELDS ด้านบน
 */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(ว่าง)';

  const mapped = VALUE_LABELS[field]?.[String(value)];
  if (mapped) return mapped;

  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';

  // คอลัมน์วันที่เก็บเป็น ISO ค.ศ. ในฐานข้อมูล ต้องแปลงกลับเป็น พ.ศ. ให้ตรงกับที่แสดงในหน้าอื่นทั้งระบบ
  // (2026-09-14) ไม่งั้นประวัติจะบอกว่า "วันที่ทำรายการ: 2026-09-14 → 2026-09-20" ซึ่งอ่านแล้วสับสนกับ
  // ตารางใบกำกับภาษีที่แสดง 14/09/2569 อยู่หน้าเดียวกัน
  if (DATE_FIELDS.has(field) && typeof value === 'string') return formatThaiDate(value);

  if (RAW_NUMERIC_FIELDS.has(field)) return String(value);

  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) {
    return Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  }

  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

export interface AuditFieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

/** รายการ "อะไรเปลี่ยนจากอะไรเป็นอะไร" ของ 1 แถวประวัติ — คืนอาร์เรย์ว่างถ้าไม่ใช่การแก้ไข */
export function describeChanges(entry: AuditLogEntry): AuditFieldChange[] {
  if (entry.action !== 'update' || !entry.changed_fields) return [];

  return entry.changed_fields
    .filter((field) => !HIDDEN_FIELDS.has(field))
    .map((field) => ({
      field,
      label: fieldLabel(field),
      before: formatFieldValue(field, entry.old_values?.[field]),
      after: formatFieldValue(field, entry.new_values?.[field]),
    }));
}

export interface AuditFieldValue {
  field: string;
  label: string;
  value: string;
}

/**
 * รายการค่าทั้งแถว ณ ตอนเพิ่มหรือตอนก่อนลบ — ใช้กับ action insert/delete ที่ไม่มีคู่ "ก่อน→หลัง" ให้เทียบ
 *
 * ตัดคอลัมน์ที่เป็นค่าว่างออกด้วย (ต่างจาก describeChanges ที่ต้องโชว์ (ว่าง) เพราะการเปลี่ยนจาก "มีค่า"
 * เป็น "ว่าง" คือข้อมูลสำคัญ) — แถวที่เพิ่งสร้างมักมีคอลัมน์ที่ไม่ได้กรอกอยู่ครึ่งค่อนตาราง ถ้าโชว์หมดจะ
 * กลายเป็นรายการยาวเหยียดที่เต็มไปด้วยคำว่า (ว่าง) จนหาค่าที่มีความหมายไม่เจอ
 */
export function describeSnapshot(entry: AuditLogEntry): AuditFieldValue[] {
  const source = entry.action === 'delete' ? entry.old_values : entry.new_values;
  if (!source) return [];

  return Object.keys(source)
    .filter((field) => !HIDDEN_FIELDS.has(field))
    .filter((field) => {
      const value = source[field];
      return value !== null && value !== undefined && value !== '';
    })
    .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b), 'th'))
    .map((field) => ({ field, label: fieldLabel(field), value: formatFieldValue(field, source[field]) }));
}

/**
 * ประโยคสรุป 1 บรรทัดของแต่ละแถว — เป็นสิ่งที่ผู้ใช้กวาดตาอ่านก่อนตัดสินใจว่าจะกดดูรายละเอียดไหม
 * จึงต้องบอกให้ครบว่า "ทำอะไร" + "กับเรื่องอะไร" + "รายการชื่ออะไร" ในบรรทัดเดียว
 */
export function describeEntry(entry: AuditLogEntry): string {
  if (entry.action === 'restore_begin' || entry.action === 'restore_end') {
    // สองชนิดนี้ record_label คือข้อความสรุปที่เขียนมาจาก RPC อยู่แล้ว ใช้ตรงๆ ได้เลย
    return entry.record_label ?? actionLabel(entry.action);
  }

  const what = tableLabel(entry.table_name);
  const name = entry.record_label?.trim();
  return name ? `${actionLabel(entry.action)}${what} "${name}"` : `${actionLabel(entry.action)}${what}`;
}

/** ชื่อผู้กระทำสำหรับแสดงผล — null หมายถึงเกิดนอกระบบ (SQL editor / service role) ไม่ใช่ "ไม่รู้ว่าใคร" */
export function actorLabel(entry: AuditLogEntry): string {
  return entry.actor_email ?? 'ระบบ / ผู้ดูแลฐานข้อมูล';
}

/**
 * วันเวลาแบบไทย (พ.ศ.) — ประวัติต้องบอกเวลาระดับนาทีเสมอ เพราะการแก้หลายครั้งในวันเดียวกันเป็นเรื่องปกติ
 * ถ้าบอกแค่วันที่จะแยกไม่ออกว่าอันไหนเกิดก่อนหลัง
 */
export function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * รวมอีเมลผู้กระทำทั้งหมดที่พบในชุดข้อมูล เรียงตามตัวอักษร — ใช้เติมตัวเลือกในกล่องกรอง "ทำโดย"
 * สร้างจากข้อมูลที่โหลดมาแล้ว ไม่ query แยกอีกรอบ เพราะรายชื่อคนในบริษัทเดียวมีไม่กี่คน
 */
export function collectActorEmails(entries: AuditLogEntry[]): string[] {
  const emails = new Set<string>();
  for (const entry of entries) {
    if (entry.actor_email) emails.add(entry.actor_email);
  }
  return [...emails].sort((a, b) => a.localeCompare(b));
}
