import { getSupabaseClient } from './supabaseClient';
import {
  arrayBufferToBase64,
  base64ToUint8Array,
  chunk,
  conflictTargetFor,
  countBackupRows,
  emptyTables,
  isCompanyScopedTable,
  prepareRowsForRestore,
  restoreDeleteOrder,
  restoreWriteOrder,
} from './backupLogic';
import {
  BACKUP_FILE_KIND,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  type BackupFile,
  type BackupRow,
  type BackupTable,
  type RestoreMode,
  type RestoreResult,
} from '@/types/backup';

/**
 * ชั้นคุยกับ Supabase ของฟีเจอร์ "สำรอง/กู้คืนข้อมูล" (เพิ่มเข้ามา 2026-09-08) — ตรรกะล้วนอยู่ใน
 * lib/backupLogic.ts (เทสต์แยกไว้แล้ว) ที่นี่มีแต่การอ่าน/เขียนจริงเท่านั้น ตามการแบ่งชั้นเดียวกับ
 * lib/invoiceApi.ts + lib/invoiceLogic.ts ที่ใช้อยู่ทั้งโปรเจกต์
 *
 * ข้อจำกัดที่ยอมรับไว้อย่างตั้งใจ (เขียนไว้ให้ชัดเพื่อไม่ให้เข้าใจผิดว่าเป็นบั๊ก):
 *
 * 1. **ไม่ atomic ทั้งชุด** — supabase-js ฝั่ง client ทำ transaction คร่อมหลายคำสั่งไม่ได้ ถ้าเน็ตหลุดกลางคัน
 *    ในโหมด "ล้างก่อนกู้" ข้อมูลจะค้างครึ่งๆ กลางๆ ได้ ทางแก้ที่ผู้ใช้ทำได้จริงคือกดกู้คืนไฟล์เดิมซ้ำอีกครั้ง
 *    (การกู้คืนไฟล์เดิมซ้ำให้ผลเหมือนเดิมเสมอ เพราะ upsert ยึด id จากไฟล์ ไม่ได้สร้างแถวใหม่ทุกครั้ง)
 *    ถ้าอนาคตต้องการ atomic จริงต้องย้ายไปทำเป็น RPC ฝั่งฐานข้อมูลแบบเดียวกับ save_bank_reconcile_report()
 *
 * 2. **ไม่สำรองสมาชิก/สิทธิ์ผู้ใช้** — company_members และ external_wht_viewer_companies อ้างอิง auth.users
 *    ซึ่งกู้คืนข้ามฐานข้อมูลไม่ได้อยู่ดี (user id คนละชุด) และการเขียนสิทธิ์กลับเข้าไปเองเป็นเรื่องความปลอดภัย
 *    ที่ไม่ควรทำผ่านไฟล์ที่แก้ด้วยมือได้ — หลังกู้คืนต้องเชิญสมาชิกใหม่ผ่านหน้า "อนุมัติสมาชิกใหม่" ตามปกติ
 *
 * 3. **โลโก้ถูกฝังมาในไฟล์เป็น base64** — ตั้งใจให้ไฟล์เดียวจบตามที่ผู้ใช้ขอ แลกกับขนาดไฟล์ที่ใหญ่ขึ้นราว 33%
 *    ของขนาดโลโก้ (โลโก้จำกัดไว้ที่ 2MB อยู่แล้ว จึงไม่เกินราว 2.7MB — ยอมรับได้)
 */

const LOGO_BUCKET = 'company-logos';

/** ขนาดก้อนตอน insert/upsert — 500 แถวต่อคำขอ สมดุลระหว่างจำนวน round-trip กับขนาด payload ต่อคำขอ */
const WRITE_CHUNK_SIZE = 500;

/** ขนาดก้อนตอนอ่าน — PostgREST จำกัดจำนวนแถวต่อคำขอไว้ (ค่าเริ่มต้น 1000) ต้องไล่อ่านเป็นหน้าๆ เอง ไม่งั้น
 * บริษัทที่มีข้อมูลเยอะจะได้ไฟล์ backup ที่ "ดูเหมือนสำเร็จ" แต่ข้อมูลขาดหายเงียบๆ ซึ่งอันตรายที่สุด */
const READ_PAGE_SIZE = 1000;

const COMPANY_BACKUP_COLUMNS =
  'name, tax_id, branch_type, branch_number, address, subdistrict, district, province, postal_code, default_signer_name';

/** ความคืบหน้าระหว่างทำงาน — หน้าจอเอาไปแสดงว่ากำลังทำตารางไหนอยู่ (ข้อมูลเยอะๆ ใช้เวลาหลายวินาที) */
export type BackupProgress = (message: string) => void;

/** อ่านทุกแถวของตารางหนึ่งแบบไล่ทีละหน้าจนหมด — คีย์เรียงต้องคงที่ ไม่งั้นแถวจะซ้ำ/หลุดระหว่างหน้า */
async function fetchAllRows(table: BackupTable, filter: { column: string; value: string }): Promise<BackupRow[]> {
  const supabase = getSupabaseClient();
  const rows: BackupRow[] = [];
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq(filter.column, filter.value)
      .range(from, from + READ_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as BackupRow[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

/** อ่านตารางลูกของรายงานกระทบยอด — กรองด้วย report_id ที่อยู่ในบริษัทนี้เท่านั้น (in filter ทีละก้อนกัน URL
 * ยาวเกินไปเวลามีรายงานเยอะ) */
async function fetchRowsByReportIds(table: BackupTable, reportIds: readonly string[]): Promise<BackupRow[]> {
  if (reportIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const rows: BackupRow[] = [];
  for (const ids of chunk(reportIds, 50)) {
    for (let from = 0; ; from += READ_PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .in('report_id', ids as string[])
        .range(from, from + READ_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as BackupRow[];
      rows.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
    }
  }
  return rows;
}

/** ดาวน์โหลดไฟล์โลโก้จาก storage แล้วแปลงเป็น base64 — ถ้าดาวน์โหลดไม่ได้ (ไฟล์หาย/สิทธิ์เปลี่ยน) คืน null
 * แทนการโยน error ทิ้ง เพราะโลโก้หายไม่ใช่เหตุผลที่ควรทำให้สำรองข้อมูลทั้งบริษัทล้มเหลว */
async function fetchLogoBase64(companyId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(`${companyId}/logo.png`);
  if (error || !data) return null;
  try {
    return arrayBufferToBase64(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * สร้างไฟล์สำรองข้อมูลของบริษัทหนึ่ง — อ่านทุกตารางที่ผูกกับบริษัทนี้ พร้อมข้อมูลตั้งค่าบริษัทและโลโก้
 * คืนค่าเป็นอ็อบเจกต์ BackupFile ให้ผู้เรียกแปลงเป็นไฟล์ JSON ดาวน์โหลดเอง (ฟังก์ชันนี้ไม่แตะ DOM)
 */
export async function exportCompanyBackup(
  companyId: string,
  exportedByEmail: string | null,
  onProgress?: BackupProgress
): Promise<BackupFile> {
  const supabase = getSupabaseClient();

  onProgress?.('กำลังอ่านข้อมูลบริษัท...');
  const { data: companyData, error: companyError } = await supabase
    .from('companies')
    .select(COMPANY_BACKUP_COLUMNS)
    .eq('id', companyId)
    .single();
  if (companyError) throw companyError;

  const tables = emptyTables();

  for (const table of BACKUP_TABLES) {
    if (!isCompanyScopedTable(table)) continue;
    onProgress?.(`กำลังอ่าน ${table}...`);
    tables[table] = await fetchAllRows(table, { column: 'company_id', value: companyId });
  }

  // ตารางลูกของรายงานกระทบยอดไม่มี company_id ของตัวเอง — ต้องไล่จาก report_id ที่อ่านมาได้ข้างบน
  const reportIds = tables.bank_reconcile_reports
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');
  for (const table of ['bank_reconcile_match_groups', 'bank_reconcile_bank_rows', 'bank_reconcile_gl_rows'] as const) {
    onProgress?.(`กำลังอ่าน ${table}...`);
    tables[table] = await fetchRowsByReportIds(table, reportIds);
  }

  onProgress?.('กำลังอ่านโลโก้บริษัท...');
  const logoBase64 = await fetchLogoBase64(companyId);

  return {
    kind: BACKUP_FILE_KIND,
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source_company_id: companyId,
    exported_by_email: exportedByEmail,
    company: companyData as unknown as BackupFile['company'],
    logo: logoBase64 ? { base64: logoBase64 } : null,
    tables,
  };
}

/** ลบข้อมูลทั้งหมดของบริษัทนี้ก่อนกู้คืน (โหมด replace) — ไล่ลบจากตารางลูกขึ้นไปหาตารางแม่
 *
 * ตารางลูกของรายงานกระทบยอดลบผ่าน report_id ที่อยู่ในบริษัทนี้เท่านั้น (ห้ามลบแบบไม่มีเงื่อนไข เพราะ user
 * อาจเป็นสมาชิกหลายบริษัทพร้อมกัน — RLS ปล่อยให้ลบของบริษัทอื่นที่ตัวเองเป็นสมาชิกได้ด้วย) */
async function wipeCompanyData(companyId: string, onProgress?: BackupProgress): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: reportRows, error: reportError } = await supabase
    .from('bank_reconcile_reports')
    .select('id')
    .eq('company_id', companyId);
  if (reportError) throw reportError;
  const reportIds = (reportRows ?? []).map((r) => (r as { id: string }).id);

  for (const table of restoreDeleteOrder()) {
    onProgress?.(`กำลังล้างข้อมูลเดิม: ${table}...`);
    if (isCompanyScopedTable(table)) {
      const { error } = await supabase.from(table).delete().eq('company_id', companyId);
      if (error) throw error;
      continue;
    }
    if (reportIds.length === 0) continue;
    for (const ids of chunk(reportIds, 50)) {
      const { error } = await supabase.from(table).delete().in('report_id', ids);
      if (error) throw error;
    }
  }
}

/**
 * กู้คืนข้อมูลจากไฟล์ backup ลงบริษัทที่กำลังเลือกอยู่
 *
 * - โหมด merge: upsert ทับแถวที่ id ตรงกัน ของเดิมที่ไม่มีในไฟล์ยังอยู่ครบ
 * - โหมด replace: ล้างข้อมูลของบริษัทนี้ทิ้งก่อน แล้วค่อยเขียนใหม่ทั้งหมด (ได้สภาพ ณ วันที่สำรองไว้เป๊ะ)
 *
 * เขียนตามลำดับ dependency เสมอ (สมุดรายชื่อ → ใบกำกับภาษี/ใบหัก ณ ที่จ่าย, รายงาน → กลุ่มจับคู่ → รายการ)
 * เพราะ foreign key ที่ฐานข้อมูลบังคับอยู่จริง สลับลำดับเมื่อไหร่คือพังทันที
 */
export async function restoreCompanyBackup(
  companyId: string,
  file: BackupFile,
  mode: RestoreMode,
  onProgress?: BackupProgress
): Promise<RestoreResult> {
  const supabase = getSupabaseClient();

  if (mode === 'replace') {
    await wipeCompanyData(companyId, onProgress);
  }

  const rowsByTable = Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0])) as Record<BackupTable, number>;

  for (const table of restoreWriteOrder()) {
    const rows = prepareRowsForRestore(table, file.tables[table] ?? [], companyId);
    if (rows.length === 0) continue;
    onProgress?.(`กำลังกู้คืน ${table} (${rows.length} แถว)...`);
    for (const part of chunk(rows, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase.from(table).upsert(part, { onConflict: conflictTargetFor(table) });
      if (error) throw error;
      rowsByTable[table] += part.length;
    }
  }

  onProgress?.('กำลังกู้คืนข้อมูลตั้งค่าบริษัท...');
  const { error: companyError } = await supabase
    .from('companies')
    .update({
      // ไม่กู้คืน "ชื่อบริษัท" ทับของเดิมโดยเจตนา — ชื่อคือสิ่งที่ผู้ใช้ใช้แยกบริษัทในหน้าเลือกบริษัท การเขียน
      // ทับอาจทำให้เหลือบริษัทชื่อซ้ำกันสองอันจนแยกไม่ออกว่าอันไหนคืออันไหน (ดูชื่อเดิมในไฟล์ได้จาก
      // file.company.name ที่หน้าจอแสดงให้ก่อนกดยืนยันอยู่แล้ว)
      tax_id: file.company.tax_id ?? null,
      branch_type: file.company.branch_type ?? 'head_office',
      branch_number: file.company.branch_type === 'branch' ? (file.company.branch_number ?? null) : null,
      address: file.company.address ?? null,
      subdistrict: file.company.subdistrict ?? null,
      district: file.company.district ?? null,
      province: file.company.province ?? null,
      postal_code: file.company.postal_code ?? null,
      default_signer_name: file.company.default_signer_name ?? null,
    })
    .eq('id', companyId);
  if (companyError) throw companyError;

  let logoRestored = false;
  if (file.logo) {
    onProgress?.('กำลังกู้คืนโลโก้บริษัท...');
    try {
      const bytes = base64ToUint8Array(file.logo.base64);
      const path = `${companyId}/logo.png`;
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, bytes, { contentType: 'image/png', upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      const { error: logoUpdateError } = await supabase
        .from('companies')
        .update({ logo_url: `${publicUrlData.publicUrl}?v=${Date.now()}` })
        .eq('id', companyId);
      if (logoUpdateError) throw logoUpdateError;
      logoRestored = true;
    } catch {
      // โลโก้กู้ไม่สำเร็จไม่ควรทำให้การกู้คืนข้อมูลทั้งบริษัทที่สำเร็จไปแล้วถือว่าล้มเหลว — รายงานผลว่า
      // logoRestored=false ให้หน้าจอบอกผู้ใช้ว่าอัปโหลดโลโก้ใหม่เองได้ที่หน้านี้
      logoRestored = false;
    }
  }

  return {
    mode,
    rowsByTable,
    totalRows: countBackupRows(file.tables),
    companySettingsRestored: true,
    logoRestored,
  };
}
