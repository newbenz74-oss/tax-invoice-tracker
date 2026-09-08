import {
  BACKUP_FILE_KIND,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  type BackupFile,
  type BackupRow,
  type BackupTable,
} from '@/types/backup';

/**
 * ตรรกะล้วนของฟีเจอร์ "สำรอง/กู้คืนข้อมูล" (เพิ่มเข้ามา 2026-09-08) — ไม่แตะ Supabase, ไม่แตะ DOM, ไม่แตะ
 * React เลยแม้แต่บรรทัดเดียว ทุกอย่างที่นี่เป็นฟังก์ชันบริสุทธิ์ที่เทสต์ได้ตรงๆ ตามธรรมเนียมเดียวกับ
 * lib/invoiceLogic.ts / lib/contactLogic.ts / lib/bankReconcileLogic.ts ที่วางไว้แล้วทั้งโปรเจกต์ ส่วนที่คุยกับ
 * ฐานข้อมูลจริงอยู่ใน lib/backupApi.ts แยกไฟล์ต่างหาก
 *
 * หัวใจของไฟล์นี้คือ "เตรียมแถวให้เขียนกลับเข้าฐานข้อมูลได้จริง" ซึ่งมี 3 เรื่องที่ต้องจัดการเสมอ ไม่งั้น
 * Postgres จะปฏิเสธทั้งชุด:
 *   1. คอลัมน์ generated (total_amount ของ pending_tax_invoices) — เขียนค่าลงไปตรงๆ ไม่ได้ ต้องตัดทิ้ง
 *   2. created_by/updated_by ที่เป็น FK ไป auth.users — ถ้ากู้ลงฐานข้อมูลใหม่ user id เดิมไม่มีอยู่จริงแล้ว
 *      จะติด FK violation ทั้งชุด จึงล้างเป็น null เสมอ (อีเมลผู้สร้างยังอยู่ครบใน created_by_email ซึ่ง
 *      เป็น text ธรรมดา ไม่ผูก FK — ข้อมูล "ใครเป็นคนสร้าง" จึงไม่หายไปไหน)
 *   3. company_id ในไฟล์เป็นของบริษัทต้นทาง — ต้องเขียนทับด้วย id ของบริษัทที่กำลังเลือกอยู่เสมอ ไม่งั้นกู้คืน
 *      แล้วข้อมูลจะไปโผล่ในบริษัทอื่น (หรือชี้ไปบริษัทที่ไม่มีอยู่จริงแล้วติด FK)
 */

/** คอลัมน์ที่ฐานข้อมูลคำนวณเองเสมอ (generated always as ... stored) — ส่งค่าไปด้วยจะได้ error
 * "cannot insert a non-DEFAULT value into column" ทั้งชุด ดู supabase/migration.sql */
const GENERATED_COLUMNS: Partial<Record<BackupTable, readonly string[]>> = {
  pending_tax_invoices: ['total_amount'],
};

/** คอลัมน์ uuid ที่อ้างอิง auth.users — ล้างเป็น null ตอนกู้คืนเสมอ (เหตุผลอยู่ในหัวไฟล์ ข้อ 2) */
const USER_REFERENCE_COLUMNS = ['created_by', 'updated_by'] as const;

/** ตารางที่มีคอลัมน์ company_id ของตัวเอง — ตารางลูกของ bank_reconcile_reports ไม่มี (ผูกผ่าน report_id
 * ชั้นเดียว) จึงไม่ต้องเขียน company_id ทับ */
const COMPANY_SCOPED_TABLES: readonly BackupTable[] = [
  'business_partners',
  'pending_tax_invoices',
  'wht_certificates',
  'wht_certificate_counters',
  'bank_reconcile_reports',
];

export function isCompanyScopedTable(table: BackupTable): boolean {
  return COMPANY_SCOPED_TABLES.includes(table);
}

/** ตั้งชื่อไฟล์ backup ให้เรียงตามเวลาได้เองเวลาเก็บหลายไฟล์ไว้ในโฟลเดอร์เดียวกัน (ISO ตัดเป็นวินาที ไม่มี
 * เครื่องหมาย : เพราะ Windows ห้ามใช้ในชื่อไฟล์) ชื่อบริษัทถูกกรองอักขระที่ใช้ตั้งชื่อไฟล์ไม่ได้ออกทั้งหมด */
export function buildBackupFileName(companyName: string, now: Date): string {
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(
    now.getMinutes()
  )}${pad2(now.getSeconds())}`;
  const safeName = companyName.replace(/[\\/:*?"<>|]/g, '').trim() || 'company';
  return `backup-${safeName}-${stamp}.json`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** นับจำนวนแถวรวมทุกตารางในไฟล์ backup — ใช้ทั้งในสรุปก่อนกู้คืนและสรุปหลังกู้คืน */
export function countBackupRows(tables: Record<BackupTable, BackupRow[]>): number {
  return BACKUP_TABLES.reduce((sum, table) => sum + (tables[table]?.length ?? 0), 0);
}

/** สร้างชุดตารางเปล่าครบทุกคีย์ — กันกรณีไฟล์เก่าไม่มีตารางที่เพิ่มมาทีหลัง (อ่านแล้วได้ [] ไม่ใช่ undefined) */
export function emptyTables(): Record<BackupTable, BackupRow[]> {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, [] as BackupRow[]])) as Record<BackupTable, BackupRow[]>;
}

export class BackupFileError extends Error {}

/**
 * อ่าน+ตรวจไฟล์ backup จากข้อความ JSON ที่ผู้ใช้เลือกมา — โยน BackupFileError พร้อมข้อความภาษาไทยที่บอกได้ว่า
 * "ผิดตรงไหน" ทุกกรณี เพราะหน้าจอเอาข้อความนี้ไปแสดงตรงๆ (ผู้ใช้ต้องรู้ว่าเลือกไฟล์ผิด หรือไฟล์เสียหาย)
 *
 * ตรวจเข้มตั้งแต่ต้นทางดีกว่าปล่อยให้ไปพังตอนเขียนฐานข้อมูล เพราะโหมด replace ลบของเดิมทิ้งไปแล้วก่อนเขียน —
 * ไฟล์เสียที่หลุดผ่านด่านนี้ไปได้แปลว่าข้อมูลหายจริง
 */
export function parseBackupFile(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupFileError('ไฟล์นี้ไม่ใช่ไฟล์ JSON ที่ถูกต้อง — กรุณาเลือกไฟล์สำรองข้อมูลที่ดาวน์โหลดจากระบบนี้');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BackupFileError('โครงสร้างไฟล์ไม่ถูกต้อง — กรุณาเลือกไฟล์สำรองข้อมูลที่ดาวน์โหลดจากระบบนี้');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.kind !== BACKUP_FILE_KIND) {
    throw new BackupFileError('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้ — กรุณาเลือกไฟล์ที่ดาวน์โหลดจากหน้า "ตั้งค่าบริษัท"');
  }

  const version = obj.format_version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new BackupFileError('ไฟล์สำรองข้อมูลไม่ระบุเวอร์ชัน — ไฟล์อาจเสียหาย');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupFileError(
      `ไฟล์นี้สร้างจากระบบเวอร์ชันใหม่กว่า (รูปแบบเวอร์ชัน ${version} แต่ระบบนี้รองรับถึง ${BACKUP_FORMAT_VERSION}) — กรุณาอัปเดตระบบก่อนกู้คืน`
    );
  }

  const company = obj.company;
  if (typeof company !== 'object' || company === null || Array.isArray(company)) {
    throw new BackupFileError('ไฟล์สำรองข้อมูลไม่มีข้อมูลบริษัท — ไฟล์อาจเสียหาย');
  }

  const rawTables = obj.tables;
  if (typeof rawTables !== 'object' || rawTables === null || Array.isArray(rawTables)) {
    throw new BackupFileError('ไฟล์สำรองข้อมูลไม่มีส่วนข้อมูลตาราง — ไฟล์อาจเสียหาย');
  }
  const tablesObj = rawTables as Record<string, unknown>;

  const tables = emptyTables();
  for (const table of BACKUP_TABLES) {
    const value = tablesObj[table];
    // ตารางที่ไม่มีในไฟล์ = ไฟล์เก่าที่สร้างก่อนตารางนั้นจะมีอยู่ ถือว่าว่างเปล่า (ไม่ใช่ไฟล์เสีย)
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      throw new BackupFileError(`ข้อมูลตาราง "${table}" ในไฟล์ผิดรูปแบบ — ไฟล์อาจเสียหาย`);
    }
    for (const row of value) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new BackupFileError(`ข้อมูลตาราง "${table}" ในไฟล์ผิดรูปแบบ — ไฟล์อาจเสียหาย`);
      }
    }
    tables[table] = value as BackupRow[];
  }

  const logoValue = obj.logo;
  let logo: BackupFile['logo'] = null;
  if (typeof logoValue === 'object' && logoValue !== null && !Array.isArray(logoValue)) {
    const base64 = (logoValue as Record<string, unknown>).base64;
    if (typeof base64 === 'string' && base64.length > 0) logo = { base64 };
  }

  return {
    kind: BACKUP_FILE_KIND,
    format_version: version,
    exported_at: typeof obj.exported_at === 'string' ? obj.exported_at : '',
    source_company_id: typeof obj.source_company_id === 'string' ? obj.source_company_id : '',
    exported_by_email: typeof obj.exported_by_email === 'string' ? obj.exported_by_email : null,
    company: company as BackupFile['company'],
    logo,
    tables,
  };
}

/**
 * เตรียมแถวหนึ่งตารางให้พร้อมเขียนกลับ — ตัดคอลัมน์ generated ทิ้ง, ล้าง created_by/updated_by เป็น null,
 * และเขียน company_id ทับด้วยบริษัทปลายทาง (เฉพาะตารางที่มีคอลัมน์นี้)
 *
 * ไม่แตะ id เดิมโดยเจตนา — id คือสิ่งเดียวที่ยึดความสัมพันธ์ระหว่างตารางไว้ได้ (ใบหัก ณ ที่จ่าย → ผู้ติดต่อ,
 * รายการฝั่งธนาคาร → กลุ่มจับคู่ → รายงาน) ถ้าสร้าง id ใหม่ตอนกู้คืน ความสัมพันธ์จะขาดหมดทันที
 */
export function prepareRowsForRestore(
  table: BackupTable,
  rows: readonly BackupRow[],
  targetCompanyId: string
): BackupRow[] {
  const generated = GENERATED_COLUMNS[table] ?? [];
  return rows.map((row) => {
    const next: BackupRow = { ...row };
    for (const column of generated) delete next[column];
    for (const column of USER_REFERENCE_COLUMNS) {
      if (column in next) next[column] = null;
    }
    if (isCompanyScopedTable(table)) next.company_id = targetCompanyId;
    return next;
  });
}

/** ลำดับการลบตอนโหมด replace = ย้อนกลับจากลำดับการเขียน (ลูกก่อนแม่) — ถึงตารางลูกจะมี on delete cascade
 * อยู่แล้วก็ลบเองตามลำดับให้ชัดเจน เพื่อให้จำนวนแถวที่ลบตรวจสอบได้และไม่ต้องพึ่งพฤติกรรม cascade */
export function restoreDeleteOrder(): BackupTable[] {
  return [...BACKUP_TABLES].reverse();
}

/** ลำดับการเขียนตอนกู้คืน (แม่ก่อนลูกเสมอ) */
export function restoreWriteOrder(): BackupTable[] {
  return [...BACKUP_TABLES];
}

/**
 * คีย์ที่ใช้ตัดสินว่า "แถวซ้ำ" ตอน upsert ในโหมด merge — ตารางส่วนใหญ่ใช้ id (primary key ปกติ) ยกเว้น
 * wht_certificate_counters ที่เป็น composite primary key ไม่มีคอลัมน์ id เลย (ดู migration_014)
 */
export function conflictTargetFor(table: BackupTable): string {
  if (table === 'wht_certificate_counters') return 'company_id,form_type,period_year,period_month';
  return 'id';
}

/** แบ่งแถวเป็นก้อนย่อยก่อนส่งขึ้น Supabase — บริษัทที่ใช้งานมานานมีใบกำกับภาษีหลักหมื่นแถวได้ง่ายๆ ส่งทีเดียว
 * ทั้งก้อนจะชน payload limit ของ PostgREST และทำให้ผู้ใช้รอโดยไม่เห็นความคืบหน้าเลย */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size ต้องมากกว่า 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** แปลง ArrayBuffer เป็น base64 โดยไม่พึ่ง FileReader (เรียกใน worker/เทสต์ได้) — แบ่งเป็นก้อนก่อนเรียก
 * String.fromCharCode เพราะไฟล์ใหญ่จะทำให้ call stack ล้นถ้ากาง array ทีเดียวทั้งก้อน */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** แปลง base64 กลับเป็น Uint8Array สำหรับอัปโหลดโลโก้คืนขึ้น storage */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** ข้อความสรุป "ไฟล์นี้สำรองไว้เมื่อไหร่" สำหรับแสดงก่อนกดยืนยันกู้คืน — คืนค่าว่างถ้าไฟล์ไม่ได้ระบุเวลามา */
export function formatExportedAt(isoText: string): string {
  if (!isoText) return '';
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return '';
  // ปี พ.ศ. ตามที่ใช้ทั้งระบบ (ดู lib/thaiDate.ts) — ที่นี่เป็นแค่ข้อความแสดงผล ไม่ใช่ค่าที่เก็บลงฐานข้อมูล
  const buddhistYear = date.getFullYear() + 543;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${buddhistYear} ${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )} น.`;
}
