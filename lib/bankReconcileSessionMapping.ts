import type {
  AmountToleranceOption,
  DateToleranceOption,
  MatchBankRow,
  MatchGLRow,
  MatchGroup,
  ReconcileRow,
  ReviewFlag,
  RowNote,
} from '@/types/bankReconcile';
import type {
  BankTransactionDbRow,
  GLTransactionDbRow,
  MatchGroupDbRow,
  MatchGroupItemDbRow,
} from '@/types/bankReconcileSession';
import { AMOUNT_TOLERANCE_VALUES, DEFAULT_AMOUNT_TOLERANCE } from './bankReconcileManualMatchLogic';
import { DATE_TOLERANCE_DAYS, DEFAULT_DATE_TOLERANCE } from './bankReconcileMatchLogic';

/**
 * ชั้นแปลงข้อมูลไป-กลับระหว่างชนิดข้อมูลในหน่วยความจำของเฟส 1-3 (MatchBankRow/MatchGLRow/MatchGroup/
 * ReviewFlag/RowNote) กับโครงสร้างแถวฐานข้อมูลของเฟส 4 (BankTransactionDbRow/GLTransactionDbRow/
 * MatchGroupDbRow/MatchGroupItemDbRow) — เพิ่มเข้ามา 2026-07-16 เป็นไฟล์ pure function ล้วนๆ ไม่มีการเรียก
 * Supabase ที่นี่เลย (ดู lib/bankReconcileSessionApi.ts สำหรับส่วนที่เรียกจริง) เพื่อให้ทดสอบด้วย unit test
 * ธรรมดาได้ทั้งหมดโดยไม่ต้อง mock ฐานข้อมูล
 *
 * == เสถียรภาพของ id (สำคัญมาก อ่านก่อนแก้ไขไฟล์นี้) ==
 * bank_row_id/gl_row_id ที่มาจากการอัปโหลดไฟล์สดๆ (เฟส 2 เดิม lib/bankReconcileMatching.ts) มีรูปแบบ
 * "bank-<เลขแถว>"/"gl-<เลขแถว>" เสมอ (ไม่ใช่ uuid) — เจตนาของเฟส 2 ไม่เคยต้องการให้ id พวกนี้ globally unique
 * ข้ามไฟล์/ข้ามรอบเลย เพราะเดิมไม่มีการบันทึกฐานข้อมูล แต่ตาราง bank_reconcile_bank_transactions/
 * bank_reconcile_gl_transactions ของเฟส 4 ต้องใช้ uuid จริงเป็น primary key (ตามธรรมเนียมทุกตารางในระบบ) และ
 * ต้องเสถียรข้ามการบันทึกซ้ำหลายครั้ง (ไม่เช่นนั้น audit log ที่อ้างอิง entity_id จะไม่มีความหมายต่อเนื่องข้าม
 * การบันทึกแต่ละครั้งเลย) — ทางแก้ที่เลือก: ensureStableId() ตรวจว่า id ปัจจุบันเป็น uuid ที่ถูกต้องอยู่แล้วหรือ
 * ไม่ (เช่น เคยบันทึก/โหลดกลับมาแล้วรอบก่อน) ถ้าใช่ให้ใช้ค่าเดิมต่อไปเรื่อยๆ (เสถียรทุกการบันทึกครั้งถัดไป) ถ้า
 * ไม่ใช่ (แถวที่เพิ่งอัปโหลดสดๆ ยังเป็น "bank-N"/"gl-N" อยู่) จึงสร้าง uuid ใหม่ให้ครั้งเดียว — ผู้เรียก
 * (components/BankReconcileResults.tsx) ต้อง setState ทับ matchBankRows/matchGLRows/matchGroups เดิมด้วยค่า
 * remapped ที่ buildSessionSavePayload() คืนกลับมาเสมอหลังบันทึกสำเร็จ ไม่เช่นนั้นการบันทึกครั้งถัดไปจะสร้าง
 * uuid ใหม่ซ้ำอีกเพราะยังเห็น "bank-N" เดิมอยู่ (ไม่ผิดแต่ทำให้ id เปลี่ยนไปเรื่อยๆ ทุกครั้งโดยไม่จำเป็น)
 * ไม่มีการแก้ไข lib/bankReconcileMatching.ts ที่สร้าง "bank-N"/"gl-N" เดิมเลยแม้แต่บรรทัดเดียว (Phase 2 เดิม)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** คืน id ที่ "เสถียรพร้อมบันทึกลงฐานข้อมูล" ของค่าหนึ่งค่า — ถ้าเป็น uuid อยู่แล้วคืนค่าเดิมเป๊ะ (changed: false)
 * ถ้าไม่ใช่ (รูปแบบ "bank-N"/"gl-N" ของแถวที่เพิ่งอัปโหลดสดๆ) สร้าง uuid ใหม่ให้ (changed: true) */
export function ensureStableId(id: string): { id: string; changed: boolean } {
  if (isUuid(id)) return { id, changed: false };
  return { id: crypto.randomUUID(), changed: true };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** แปลงตัวเลือก Date Tolerance เป็นจำนวนวัน — ใช้ค่าจาก lib/bankReconcileMatchLogic.ts ตรงๆ (แหล่งความจริง
 * เดียว ไม่คัดลอกตัวเลขซ้ำ) */
export function dateToleranceOptionToDays(option: DateToleranceOption): number {
  return DATE_TOLERANCE_DAYS[option];
}

/** ย้อนกลับจากจำนวนวันเป็นตัวเลือก — ใช้ตอนโหลด session เก่ากลับมา (ฐานข้อมูลเก็บแค่ตัวเลขวัน ไม่เก็บตัวเลือก)
 * ถ้าไม่ตรงกับตัวเลือกใดเลย (ไม่ควรเกิดขึ้นจริงเพราะ UI มีแค่ 4 ตัวเลือกให้เลือก) fallback เป็นค่าเริ่มต้นของ
 * ระบบเพื่อไม่ให้หน้าจอพัง */
export function daysToDateToleranceOption(days: number): DateToleranceOption {
  const found = (Object.entries(DATE_TOLERANCE_DAYS) as [DateToleranceOption, number][]).find(([, d]) => d === days);
  return found ? found[0] : DEFAULT_DATE_TOLERANCE;
}

/** ย้อนกลับจากค่าตัวเลขที่บันทึกไว้เป็นตัวเลือก Amount Tolerance — ถ้าไม่ตรงกับ zero/small/one เป๊ะ (เช่น
 * ผู้ใช้เคยกรอกค่าเอง) ถือว่าเป็น 'custom' แล้วคืนค่าตัวเลขเดิมไว้ใน customAmountTolerance */
export function amountToleranceValueToOption(value: number): { option: AmountToleranceOption; custom: number } {
  const found = (Object.entries(AMOUNT_TOLERANCE_VALUES) as [Exclude<AmountToleranceOption, 'custom'>, number][]).find(
    ([, v]) => v === value
  );
  if (found) return { option: found[0], custom: 0 };
  if (!Number.isFinite(value)) return { option: DEFAULT_AMOUNT_TOLERANCE, custom: 0 };
  return { option: 'custom', custom: value };
}

function computeDateDifferenceDays(bankDate: string | null, glDate: string | null): number | null {
  if (!bankDate || !glDate) return null;
  const a = Date.parse(`${bankDate}T00:00:00Z`);
  const b = Date.parse(`${glDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

/* ============================== บันทึก: หน่วยความจำ -> payload สำหรับ RPC ============================== */

export interface BuildSessionSavePayloadParams {
  /** ReconcileRow[] ที่คำนวณล่าสุดแล้ว (mergedOutput.rows) — มีทั้ง status/reviewFlag/note ต่อแถวอยู่แล้ว
   * ไม่ต้องส่ง reviewFlags/notes Record แยกต่างหากอีก */
  reconcileRows: ReconcileRow[];
  /** แถว GL ทั้งหมด (ทั้งที่จับคู่แล้วและยังไม่จับคู่) — ไม่ใช่แค่ glOnlyResults */
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
}

export interface BuildSessionSavePayloadResult {
  bankTransactionsPayload: Record<string, unknown>[];
  glTransactionsPayload: Record<string, unknown>[];
  matchGroupsPayload: Record<string, unknown>[];
  matchGroupItemsPayload: Record<string, unknown>[];
  /** matchBankRows/matchGLRows/matchGroups ที่ id ถูกแทนที่เป็น uuid เสถียรแล้ว — เรียก setState ทับของเดิม
   * เสมอหลังบันทึกสำเร็จ (ดูหมายเหตุยาวด้านบนหัวไฟล์) แม้ idsChanged จะเป็น false ก็ปลอดภัยที่จะ setState ทับ
   * เพราะเป็น array/object ใหม่อยู่ดี (ไม่ได้ mutate ของเดิม) */
  remappedMatchBankRows: MatchBankRow[];
  remappedMatchGLRows: MatchGLRow[];
  remappedMatchGroups: MatchGroup[];
  /** true ถ้ามี id ใดถูกสร้างใหม่ครั้งนี้ (แถวที่เพิ่งอัปโหลดสดๆ ยังไม่เคยบันทึกมาก่อน) */
  idsChanged: boolean;
  /** id เดิม -> id ใหม่ ของแถว Bank/GL ที่ถูกสร้าง uuid ใหม่ครั้งนี้เท่านั้น (ว่างเปล่าถ้า idsChanged เป็น
   * false) — เพิ่มเข้ามาเพื่อแก้บั๊กที่พบระหว่างพัฒนา: reviewFlags/notes ใน
   * components/BankReconcileResults.tsx เก็บ key เป็น bank_row_id เดิม ("bank-N") ถ้าไม่รีแมป key เหล่านี้
   * ตาม bankIdMap ต่อทันทีหลังบันทึกครั้งแรกสำเร็จ (setState ทับ matchBankRows ด้วย remappedMatchBankRows
   * ตามที่หมายเหตุหัวไฟล์นี้กำชับ) รายการตรวจสอบ/หมายเหตุที่เพิ่มไว้ก่อนบันทึกครั้งแรกจะ "หายไป" จากหน้าจอ
   * ทันทีอย่างเงียบๆ (key เดิมไม่ตรงกับ bank_row_id ใหม่ของแถวนั้นอีกต่อไป) — glIdMap ไม่จำเป็นต้อง expose
   * เพราะไม่มี Record ใดในเฟส 1-3 ใช้ gl_row_id เป็น key เลย (มีแต่ bank_row_id) */
  bankIdMap: Map<string, string>;
}

/** สร้าง payload ทั้งหมดที่ใช้ส่งเข้า save_bank_reconcile_session() RPC ครั้งเดียว — คำนวณ id เสถียร +
 * source_row_number (จากตำแหน่งใน array ปัจจุบัน — ดูหมายเหตุที่ BankTransactionDbRow ใน
 * types/bankReconcileSession.ts) + is_used ของ GL (จากการรวม gl_transaction_ids ของทุกกลุ่มจับคู่) */
export function buildSessionSavePayload({
  reconcileRows,
  matchGLRows,
  matchGroups,
}: BuildSessionSavePayloadParams): BuildSessionSavePayloadResult {
  const bankIdMap = new Map<string, string>();
  const glIdMap = new Map<string, string>();
  let idsChanged = false;

  const remappedMatchBankRows: MatchBankRow[] = reconcileRows.map((row) => {
    const { id, changed } = ensureStableId(row.bank.bank_row_id);
    if (changed) {
      bankIdMap.set(row.bank.bank_row_id, id);
      idsChanged = true;
    }
    return { ...row.bank, bank_row_id: id };
  });

  const remappedMatchGLRows: MatchGLRow[] = matchGLRows.map((row) => {
    const { id, changed } = ensureStableId(row.gl_row_id);
    if (changed) {
      glIdMap.set(row.gl_row_id, id);
      idsChanged = true;
    }
    return { ...row, gl_row_id: id };
  });

  const remappedMatchGroups: MatchGroup[] = matchGroups.map((group) => ({
    ...group,
    bank_transaction_ids: group.bank_transaction_ids.map((id) => bankIdMap.get(id) ?? id),
    gl_transaction_ids: group.gl_transaction_ids.map((id) => glIdMap.get(id) ?? id),
  }));

  const usedGLIds = new Set<string>();
  for (const group of remappedMatchGroups) {
    for (const id of group.gl_transaction_ids) usedGLIds.add(id);
  }

  const bankTransactionsPayload = reconcileRows.map((row, index) => {
    const bank = remappedMatchBankRows[index];
    const { bank_row_id, raw_bank_row, ...normalized } = bank;
    void bank_row_id;
    return {
      id: bank.bank_row_id,
      source_row_number: index + 1,
      bank_transaction_date: normalized.bank_date,
      bank_description: normalized.bank_description,
      bank_money_in: normalized.bank_money_in,
      bank_money_out: normalized.bank_money_out,
      bank_amount: normalized.bank_amount,
      bank_balance: normalized.bank_balance,
      raw_data: raw_bank_row,
      normalized_data: normalized,
      reconcile_status: row.status,
      review_required: row.reviewFlag !== null,
      review_note: row.note?.note ?? null,
      note_updated_by: row.note?.updated_by ?? null,
      note_updated_at: row.note?.updated_at ?? null,
      reviewed_by: row.reviewFlag?.reviewed_by ?? null,
      reviewed_at: row.reviewFlag?.reviewed_at ?? null,
    };
  });

  const glTransactionsPayload = remappedMatchGLRows.map((gl, index) => {
    const { gl_row_id, raw_gl_row, ...normalized } = gl;
    void gl_row_id;
    return {
      id: gl.gl_row_id,
      source_row_number: index + 1,
      gl_date: normalized.gl_date,
      gl_document_no: normalized.gl_document_no,
      gl_description: normalized.gl_description,
      gl_debit: normalized.gl_debit,
      gl_credit: normalized.gl_credit,
      gl_amount: normalized.gl_amount,
      raw_data: raw_gl_row,
      normalized_data: normalized,
      is_used: usedGLIds.has(gl.gl_row_id),
    };
  });

  const matchGroupsPayload = remappedMatchGroups.map((group) => ({
    id: group.match_group_id,
    match_type: group.match_type,
    bank_total: group.bank_total,
    gl_total: group.gl_total,
    amount_difference: group.amount_difference,
    match_score: group.auto_match_score,
    match_reason: group.auto_match_reason,
    manual_match: group.manual_match,
    status: group.status,
    note: group.note,
    matched_by: group.matched_by,
    matched_at: group.matched_at,
  }));

  const matchGroupItemsPayload: Record<string, unknown>[] = [];
  for (const group of remappedMatchGroups) {
    for (const bankId of group.bank_transaction_ids) {
      matchGroupItemsPayload.push({
        match_group_id: group.match_group_id,
        transaction_type: 'bank',
        bank_transaction_id: bankId,
        gl_transaction_id: null,
      });
    }
    for (const glId of group.gl_transaction_ids) {
      matchGroupItemsPayload.push({
        match_group_id: group.match_group_id,
        transaction_type: 'gl',
        bank_transaction_id: null,
        gl_transaction_id: glId,
      });
    }
  }

  return {
    bankTransactionsPayload,
    glTransactionsPayload,
    matchGroupsPayload,
    matchGroupItemsPayload,
    remappedMatchBankRows,
    remappedMatchGLRows,
    remappedMatchGroups,
    idsChanged,
    bankIdMap,
  };
}

/** สร้าง id ใหม่ทั้งหมดแบบไม่มีเงื่อนไข (ต่างจาก ensureStableId ที่ใช้ตอนบันทึกปกติ ซึ่งจะ "คงของเดิมไว้ถ้า
 * เป็น uuid อยู่แล้ว") — ใช้เฉพาะตอน "ทำสำเนา" รอบกระทบยอด (§6 ปุ่ม "ทำสำเนา") เท่านั้น เพราะสำเนาต้องมี id
 * ของแถว Bank/GL/กลุ่มจับคู่ทุกตัวไม่ซ้ำกับต้นฉบับเด็ดขาด (ถ้าใช้ ensureStableId ตรงๆ จะได้ id เดิมกลับมาเพราะ
 * เป็น uuid ที่ถูกต้องอยู่แล้วจากการโหลด แล้วบันทึกซ้ำจะชน primary key ของต้นฉบับทันที) รีแมป
 * match_group_id ของทุกกลุ่มด้วย (ยังคง prefix "mg-" ตามธรรมเนียมเดิมของเฟส 3) พร้อมคืน bankIdMap/glIdMap
 * ให้ผู้เรียกใช้รีแมป reviewFlags/notes (ที่ key เป็น bank_row_id เดิม) ต่อเองผ่าน remapRecordKeys() */
export function regenerateAllIds(
  matchBankRows: MatchBankRow[],
  matchGLRows: MatchGLRow[],
  matchGroups: MatchGroup[]
): {
  matchBankRows: MatchBankRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  bankIdMap: Map<string, string>;
  glIdMap: Map<string, string>;
} {
  const bankIdMap = new Map<string, string>();
  const glIdMap = new Map<string, string>();

  const newMatchBankRows = matchBankRows.map((row) => {
    const newId = crypto.randomUUID();
    bankIdMap.set(row.bank_row_id, newId);
    return { ...row, bank_row_id: newId };
  });
  const newMatchGLRows = matchGLRows.map((row) => {
    const newId = crypto.randomUUID();
    glIdMap.set(row.gl_row_id, newId);
    return { ...row, gl_row_id: newId };
  });
  const newMatchGroups = matchGroups.map((group) => ({
    ...group,
    match_group_id: `mg-${crypto.randomUUID()}`,
    bank_transaction_ids: group.bank_transaction_ids.map((id) => bankIdMap.get(id) ?? id),
    gl_transaction_ids: group.gl_transaction_ids.map((id) => glIdMap.get(id) ?? id),
  }));

  return { matchBankRows: newMatchBankRows, matchGLRows: newMatchGLRows, matchGroups: newMatchGroups, bankIdMap, glIdMap };
}

/** รีแมป key ของ Record (ใช้กับ reviewFlags/notes ที่ key เป็น bank_row_id) ตาม idMap ที่ได้จาก
 * regenerateAllIds() — key ที่ไม่มีใน idMap ให้คงเดิม (ไม่ควรเกิดขึ้นจริงถ้า idMap มาจาก matchBankRows ชุด
 * เดียวกัน แต่กันไว้เพื่อความปลอดภัย) */
export function remapRecordKeys<T>(record: Record<string, T>, idMap: Map<string, string>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    result[idMap.get(key) ?? key] = value;
  }
  return result;
}

/* ============================== โหลด: แถวฐานข้อมูล -> หน่วยความจำ ============================== */

export interface LoadedSessionCoreData {
  matchBankRows: MatchBankRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  reviewFlags: Record<string, ReviewFlag>;
  notes: Record<string, RowNote>;
}

/** แปลงแถวฐานข้อมูลทั้ง 4 ตารางลูกกลับเป็นชนิดข้อมูลเดิมของเฟส 1-3 ทั้งหมด — ให้ผลลัพธ์ที่ป้อนเข้า
 * useState lazy initializer ของ components/BankReconcileResults.tsx ได้ตรงๆ ทันที (ดู LoadedSessionData ใน
 * types/bankReconcileSession.ts) เรียงลำดับ matchBankRows/matchGLRows ตาม source_row_number เสมอ (ให้ลำดับ
 * แถวในตารางเหมือนกับตอนอัปโหลดครั้งแรกเป๊ะ ไม่สลับที่กันเพราะฐานข้อมูลไม่รับประกันลำดับ SELECT) */
export function mapDbRowsToSessionCore(
  bankRows: BankTransactionDbRow[],
  glRows: GLTransactionDbRow[],
  groupRows: MatchGroupDbRow[],
  itemRows: MatchGroupItemDbRow[]
): LoadedSessionCoreData {
  const sortedBankRows = [...bankRows].sort((a, b) => a.source_row_number - b.source_row_number);
  const sortedGLRows = [...glRows].sort((a, b) => a.source_row_number - b.source_row_number);

  const matchBankRows: MatchBankRow[] = sortedBankRows.map((row) => ({
    bank_row_id: row.id,
    raw_bank_row: row.raw_data,
    ...row.normalized_data,
  }));

  const matchGLRows: MatchGLRow[] = sortedGLRows.map((row) => ({
    gl_row_id: row.id,
    raw_gl_row: row.raw_data,
    ...row.normalized_data,
  }));

  const bankDateById = new Map(matchBankRows.map((r) => [r.bank_row_id, r.bank_date] as const));
  const glDateById = new Map(matchGLRows.map((r) => [r.gl_row_id, r.gl_date] as const));

  const bankIdsByGroup = new Map<string, string[]>();
  const glIdsByGroup = new Map<string, string[]>();
  for (const item of itemRows) {
    if (item.transaction_type === 'bank' && item.bank_transaction_id) {
      const arr = bankIdsByGroup.get(item.match_group_id) ?? [];
      arr.push(item.bank_transaction_id);
      bankIdsByGroup.set(item.match_group_id, arr);
    } else if (item.transaction_type === 'gl' && item.gl_transaction_id) {
      const arr = glIdsByGroup.get(item.match_group_id) ?? [];
      arr.push(item.gl_transaction_id);
      glIdsByGroup.set(item.match_group_id, arr);
    }
  }

  const matchGroups: MatchGroup[] = groupRows.map((g) => {
    const bankIds = bankIdsByGroup.get(g.id) ?? [];
    const glIds = glIdsByGroup.get(g.id) ?? [];
    const dateDifferenceDays =
      bankIds.length === 1 && glIds.length === 1
        ? computeDateDifferenceDays(bankDateById.get(bankIds[0]) ?? null, glDateById.get(glIds[0]) ?? null)
        : null;
    return {
      match_group_id: g.id,
      match_type: g.match_type,
      status: g.status,
      bank_transaction_ids: bankIds,
      gl_transaction_ids: glIds,
      bank_total: g.bank_total,
      gl_total: g.gl_total,
      amount_difference: g.amount_difference,
      date_difference_days: dateDifferenceDays,
      manual_match: true,
      matched_by: g.matched_by,
      matched_at: g.matched_at,
      note: g.note,
      auto_match_score: g.match_score,
      auto_match_reason: g.match_reason,
    };
  });

  const reviewFlags: Record<string, ReviewFlag> = {};
  const notes: Record<string, RowNote> = {};
  for (const row of sortedBankRows) {
    if (row.review_required) {
      reviewFlags[row.id] = {
        review_required: true,
        reviewed_by: row.reviewed_by ?? '',
        reviewed_at: row.reviewed_at ?? '',
      };
    }
    if (row.review_note) {
      notes[row.id] = {
        note: row.review_note,
        updated_by: row.note_updated_by ?? '',
        updated_at: row.note_updated_at ?? '',
      };
    }
  }

  return { matchBankRows, matchGLRows, matchGroups, reviewFlags, notes };
}

export { round2 };
