/**
 * ชนิดข้อมูลของไฟล์สำรองข้อมูล (backup) ทั้งบริษัท — เพิ่มเข้ามา 2026-09-08 ตามคำขอผู้ใช้
 * ("อยากสำรองข้อมูลออกมาเป็นไฟล์ แล้วนำกลับเข้ามาให้ครบถ้วนเหมือนเดิมได้")
 *
 * รูปแบบไฟล์: JSON ไฟล์เดียว UTF-8 นามสกุล .json — เก็บ "ทุกแถวของทุกตารางที่ผูกกับบริษัทเดียว" พร้อม id
 * จริงของแต่ละแถว (ไม่ใช่ export แบบรายงานที่ตัด id ทิ้ง) เพราะการกู้คืนต้องรักษาความสัมพันธ์ระหว่างตารางไว้
 * ครบ เช่น wht_certificates.business_partner_id ต้องยังชี้ไปที่ผู้ติดต่อแถวเดิมได้หลังกู้คืน
 *
 * ทำไมถึงเป็น JSON ไม่ใช่ Excel: Excel ทำให้ข้อมูลเพี้ยนตอนอ่านกลับ (วันที่กลายเป็น serial number, id ที่ขึ้นต้น
 * ด้วยเลขศูนย์โดนตัด, ค่า null กับสตริงว่างแยกกันไม่ออก, ตัวเลขทศนิยมปัดเอง) ซึ่งยอมรับไม่ได้เลยสำหรับไฟล์ที่มี
 * หน้าที่ "กู้ข้อมูลกลับมาให้เหมือนเดิมเป๊ะ" — ส่วนการ export เพื่อ "เอาไปอ่าน/ทำต่อ" มีอยู่แล้วในหน้าอื่น
 * (lib/contactExport.ts, lib/reportExport.ts ฯลฯ) คนละวัตถุประสงค์กัน
 */

/** เวอร์ชันโครงสร้างไฟล์ backup — ขึ้นเลขใหม่เมื่อรูปแบบไฟล์เปลี่ยนจนอ่านแบบเดิมไม่ได้ ตัวอ่านจะปฏิเสธไฟล์ที่
 * เวอร์ชันสูงกว่าที่ตัวเองรู้จัก (ไฟล์จากแอปเวอร์ชันใหม่กว่า) แทนที่จะอ่านมั่วแล้วกู้ข้อมูลผิดๆ */
export const BACKUP_FORMAT_VERSION = 1;

/** ค่าคงที่ระบุว่าไฟล์นี้เป็นไฟล์สำรองข้อมูลของระบบนี้จริง (กันผู้ใช้เลือกไฟล์ JSON อื่นมาโดยไม่ตั้งใจ) */
export const BACKUP_FILE_KIND = 'benz-tax-invoice-tracker-backup';

/** ชื่อตารางทั้งหมดที่ถูกสำรอง — เรียงตามลำดับ dependency (ตารางแม่มาก่อนตารางลูกเสมอ) ใช้ลำดับนี้ทั้งตอน
 * เขียนกลับ (กู้คืน) และกลับด้านตอนลบ (โหมดล้างก่อนกู้) จึงประกาศไว้ที่เดียวไม่ให้หลุดออกจากกัน */
export const BACKUP_TABLES = [
  'business_partners',
  'pending_tax_invoices',
  'wht_certificates',
  'wht_certificate_counters',
  'bank_reconcile_reports',
  'bank_reconcile_match_groups',
  'bank_reconcile_bank_rows',
  'bank_reconcile_gl_rows',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** ชื่อภาษาไทยของแต่ละตาราง สำหรับแสดงในตารางสรุป "ไฟล์นี้มีอะไรอยู่บ้าง" ก่อนกู้คืน */
export const BACKUP_TABLE_LABELS: Record<BackupTable, string> = {
  business_partners: 'สมุดรายชื่อ (ลูกค้า/ผู้จัดจำหน่าย)',
  pending_tax_invoices: 'รายการซื้อ/ใบกำกับภาษี',
  wht_certificates: 'ใบหัก ณ ที่จ่ายที่ออกแล้ว',
  wht_certificate_counters: 'ตัวนับเลขที่ใบหัก ณ ที่จ่าย',
  bank_reconcile_reports: 'รายงานกระทบยอด',
  bank_reconcile_match_groups: 'กลุ่มจับคู่ในรายงานกระทบยอด',
  bank_reconcile_bank_rows: 'รายการฝั่งธนาคาร',
  bank_reconcile_gl_rows: 'รายการฝั่งบัญชี (GL)',
};

/** แถวข้อมูลดิบจากฐานข้อมูล — เก็บทุกคอลัมน์ตามที่ select('*') คืนมา ไม่ประกาศ type ราย field เพราะไฟล์
 * backup ต้องพกคอลัมน์ที่เพิ่มเข้ามาในอนาคตติดไปด้วยเองโดยไม่ต้องแก้ไฟล์นี้ทุกครั้งที่มี migration ใหม่ */
export type BackupRow = Record<string, unknown>;

/** ข้อมูล "ตั้งค่าบริษัท" ที่สำรองไว้ — แถวเดียวจากตาราง companies (ไม่รวม id เพราะตอนกู้คืนเขียนทับลงบริษัท
 * ที่กำลังเลือกอยู่เสมอ ไม่ได้สร้างบริษัทใหม่) */
export interface BackupCompany {
  name: string;
  tax_id: string | null;
  branch_type: string;
  branch_number: string | null;
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  default_signer_name: string | null;
}

/** โลโก้บริษัทที่ฝังมาในไฟล์ backup — เก็บเป็น base64 ของไฟล์ PNG (ไม่ใช่ URL) เพราะ URL เดิมจะใช้ไม่ได้ทันที
 * ถ้าย้ายไปโปรเจกต์ Supabase ใหม่ ซึ่งเป็นกรณีหลักที่ฟีเจอร์นี้มีไว้รองรับ */
export interface BackupLogo {
  /** เนื้อไฟล์ PNG เข้ารหัส base64 (ไม่มีส่วนหัว data: URL) */
  base64: string;
}

export interface BackupFile {
  kind: typeof BACKUP_FILE_KIND;
  format_version: number;
  /** เวลาที่สร้างไฟล์ (ISO 8601) */
  exported_at: string;
  /** id ของบริษัทต้นทาง — เก็บไว้เพื่อเตือนตอนกู้คืนข้ามบริษัท ไม่ได้ใช้เขียนกลับ (ดู remapCompanyId) */
  source_company_id: string;
  /** อีเมลผู้กดสำรองข้อมูล (ถ้ามี) — ไว้ดูย้อนหลังว่าไฟล์นี้ใครเป็นคนสร้าง */
  exported_by_email: string | null;
  company: BackupCompany;
  logo: BackupLogo | null;
  tables: Record<BackupTable, BackupRow[]>;
}

/** โหมดการกู้คืน — ผู้ใช้เลือกเองตอนกู้คืนทุกครั้ง (ไม่ได้ตายตัวมาจากไฟล์)
 * - merge: upsert ทับแถวที่ id ตรงกัน แถวที่มีอยู่แล้วแต่ไม่มีในไฟล์จะยังอยู่ครบ (ปลอดภัยกว่า)
 * - replace: ลบข้อมูลทั้งหมดของบริษัทนี้ก่อน แล้วค่อยเขียนจากไฟล์ — ได้สภาพเหมือนวันที่สำรองไว้เป๊ะ */
export type RestoreMode = 'merge' | 'replace';

/** จำนวนแถวที่เขียนสำเร็จแยกรายตาราง + สถานะโลโก้ ใช้แสดงผลสรุปหลังกู้คืนเสร็จ */
export interface RestoreResult {
  mode: RestoreMode;
  rowsByTable: Record<BackupTable, number>;
  totalRows: number;
  companySettingsRestored: boolean;
  logoRestored: boolean;
}
