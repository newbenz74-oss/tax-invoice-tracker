import type { AmountToleranceOption, BankRowMatchStatus, MatchGroup, MatchType, ReconcileRow } from '@/types/bankReconcile';
import { getRowNote } from './bankReconcileManualMatch';

/**
 * ชั้น "รองรับ UI" ของเครื่องมือจับคู่รายการด้วยตนเอง — เฟส 3 ของ Bank Reconcile เพิ่มเข้ามา 2026-07-16
 *
 * แยกจาก lib/bankReconcileManualMatch.ts (อัลกอริทึมล้วนๆ) โดยเจตนา ตามธรรมเนียมเดิมที่ตั้งไว้ตั้งแต่เฟส 2
 * (bankReconcileMatching.ts vs bankReconcileMatchLogic.ts) — ไฟล์นี้เป็นไฟล์ "ใหม่แยกต่างหาก" ไม่ใช่การแก้ไข
 * lib/bankReconcileMatchLogic.ts ของเฟส 2 (ซึ่งแตะแค่ 2 จุดเพิ่ม label/badge สถานะใหม่เท่านั้น) เหตุผลที่แยกไฟล์
 * ใหม่แทนการเพิ่มเข้าไฟล์เดิม: ฟังก์ชัน filter/count/summary ของเฟส 2 (filterBankResults/computeStatusCounts/
 * computeReconcileSummary) ทำงานกับ BankMatchResult[] + ReconcileFilters ของเฟส 2 ล้วนๆ และยังมี unit test 13
 * เคสอ้างอิงพฤติกรรมเดิมอยู่ — เฟส 3 ต้องการ logic ที่กว้างกว่าเดิม (กรองตาม "กลุ่มยืนยันด้วยตนเอง"/"ทำเครื่องหมาย
 * ต้องตรวจสอบ" ซึ่งเป็นแนวคิดที่ไม่มีในเฟส 2) จึงเขียนฟังก์ชันคู่ขนานชุดใหม่ที่ทำงานกับ ReconcileRow[] แทน โดย
 * ไม่แตะฟังก์ชันเดิมของเฟส 2 แม้แต่บรรทัดเดียว (function เดิมยังคง export อยู่ + ยังมี unit test คุ้มครองอยู่
 * เหมือนเดิมทุกประการ แค่ orchestrator ของเฟส 3 เปลี่ยนไปเรียกชุดใหม่นี้แทน)
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** แท็บของ Segmented Control เฟส 3 — 8 แท็บตามสเปกตรงๆ ("SEGMENTED CONTROL UPDATE") 'confirmed' เป็น "ถัง"
 * รวม 3 สถานะย่อยของการยืนยันด้วยตนเอง (confirmed_manual/confirmed_tolerance/confirmed_variance) เข้าด้วยกัน
 * (แท็บเดียวตามที่สเปกระบุ แม้ status จริงจะมี 3 ค่าย่อยก็ตาม — badge ในตารางยังคงแยกสีตามสถานะย่อยจริงเสมอ)
 * ส่วน 'review_required' เป็น "ถัง" ที่กรองจาก ReviewFlag (คนละแกนกับ status ทั้งหมด — แถวสถานะไหนก็ติดธงนี้
 * ได้ จึงนับซ้อนกับแท็บอื่นได้ตามธรรมชาติ ไม่ใช่ partition แบบ 6 แท็บที่เหลือซึ่งรวมกันแล้วเท่ากับ "ทั้งหมด" เป๊ะ) */
export type ReconcileTab =
  | 'all'
  | 'matched_exact'
  | 'matched_tolerance'
  | 'confirmed'
  | 'ambiguous'
  | 'pending_review'
  | 'review_required'
  | 'not_found_in_gl';

export const RECONCILE_TAB_LABELS: Record<ReconcileTab, string> = {
  all: 'ทั้งหมด',
  matched_exact: 'เรียบร้อย',
  matched_tolerance: 'น่าจะตรงกัน',
  confirmed: 'ยืนยันด้วยตนเอง',
  ambiguous: 'พบหลายรายการ',
  pending_review: 'รอตรวจสอบ',
  review_required: 'ต้องตรวจสอบ',
  not_found_in_gl: 'ไม่พบใน GL',
};

const CONFIRMED_ROW_TAB_ORDER: Exclude<ReconcileTab, 'all'>[] = [
  'matched_exact',
  'matched_tolerance',
  'confirmed',
  'ambiguous',
  'pending_review',
  'review_required',
  'not_found_in_gl',
];

function matchesTab(row: ReconcileRow, tab: ReconcileTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'confirmed') return row.matchGroup !== null;
  if (tab === 'review_required') return row.reviewFlag !== null;
  return row.status === tab;
}

/** ค้นหาแบบ substring ไม่สนตัวพิมพ์เล็ก/ใหญ่ — ต่อยอดจาก matchesSearch ของเฟส 2 โดยเพิ่มช่องทางใหม่ที่เฟส 3
 * นำมาด้วย: หมายเหตุ (RowNote หรือ MatchGroup.note ผ่าน getRowNote), ผู้ยืนยัน, และรายละเอียด/เลขที่เอกสารของ
 * GL "ทุกแถว" ที่จับคู่ (matchedGLRows แทนที่จะอิง matchedGL เดี่ยวเหมือนเฟส 2 เพราะกลุ่ม 1:หลาย ไม่มี matchedGL) */
function matchesSearch(row: ReconcileRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const glParts = row.matchedGLRows.flatMap((g) => [g.gl_document_no, g.gl_description]);
  const haystack = [
    row.bank.bank_description,
    ...glParts,
    row.bank.bank_amount.toFixed(2),
    Math.abs(row.bank.bank_amount).toFixed(2),
    getRowNote(row),
    row.matchGroup?.matched_by ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function matchesDateRange(row: ReconcileRow, dateFrom: string | null, dateTo: string | null): boolean {
  if (!dateFrom && !dateTo) return true;
  const d = row.bank.bank_date;
  if (!d) return false;
  if (dateFrom && d < dateFrom) return false;
  if (dateTo && d > dateTo) return false;
  return true;
}

function matchesAmountRange(row: ReconcileRow, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  const amt = Math.abs(row.bank.bank_amount);
  if (min !== null && amt < min) return false;
  if (max !== null && amt > max) return false;
  return true;
}

export interface ReconcileRowFilters {
  search: string;
  tab: ReconcileTab;
  dateFrom: string | null;
  dateTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
}

export const DEFAULT_RECONCILE_ROW_FILTERS: ReconcileRowFilters = {
  search: '',
  tab: 'all',
  dateFrom: null,
  dateTo: null,
  amountMin: null,
  amountMax: null,
};

/** กรองแถวตาม Segmented Control (tab) + ช่องค้นหา + ตัวกรองเสริมพร้อมกันเสมอ (AND) — คู่ขนานกับ
 * filterBankResults ของเฟส 2 แต่ทำงานกับ ReconcileRow[]/ReconcileTab แทน */
export function filterReconcileRows(rows: ReconcileRow[], filters: ReconcileRowFilters): ReconcileRow[] {
  return rows.filter(
    (r) =>
      matchesTab(r, filters.tab) &&
      matchesSearch(r, filters.search) &&
      matchesDateRange(r, filters.dateFrom, filters.dateTo) &&
      matchesAmountRange(r, filters.amountMin, filters.amountMax)
  );
}

/** นับจำนวนแยกตามแท็บสำหรับ Segmented Control — คำนวณจากผลลัพธ์ "ทั้งหมด" เสมอ ไม่ผูกกับตัวกรองอื่นที่เลือกอยู่
 * ขณะนั้น (ธรรมเนียมเดียวกับ computeStatusCounts ของเฟส 2 ทุกประการ) แท็บ 'confirmed'/'review_required' เป็น
 * ถังคนละแกน จึงอาจนับซ้อนกับแท็บสถานะจริงได้ตามธรรมชาติ (แถวหนึ่งแถวนับได้มากกว่า 1 แท็บพร้อมกัน) */
export function computeReconcileTabCounts(rows: ReconcileRow[]): Record<ReconcileTab, number> {
  const counts = { all: rows.length } as Record<ReconcileTab, number>;
  for (const tab of CONFIRMED_ROW_TAB_ORDER) counts[tab] = 0;
  for (const row of rows) {
    for (const tab of CONFIRMED_ROW_TAB_ORDER) {
      if (matchesTab(row, tab)) counts[tab] += 1;
    }
  }
  return counts;
}

export interface ReconcileRowSummary {
  totalBank: number;
  matchedExact: number;
  matchedTolerance: number;
  confirmedManual: number;
  ambiguous: number;
  pendingReview: number;
  reviewRequired: number;
  notFoundInGL: number;
  notFoundInBank: number;
  totalDifference: number;
}

/** สถานะที่ถือว่า "กระทบยอดแล้ว" (ไม่นับเป็นผลต่างค้างใน KPI "ผลต่างรวม") — เฟส 2 นับแค่ matched_exact/
 * matched_tolerance เพราะตอนนั้นยังไม่มีการยืนยันด้วยตนเอง เฟส 3 เพิ่ม 3 สถานะยืนยันด้วยตนเองเข้าไปด้วย
 * (รวม confirmed_variance ด้วย — เพราะเป็นการที่มนุษย์ตัดสินใจ "ยอมรับ" ผลต่างนั้นแล้วอย่างชัดเจน ไม่ใช่ผลต่าง
 * ที่ยังค้างรอดำเนินการต่อ) เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล */
const RESOLVED_STATUSES: BankRowMatchStatus[] = [
  'matched_exact',
  'matched_tolerance',
  'confirmed_manual',
  'confirmed_tolerance',
  'confirmed_variance',
];

/** สรุป KPI ของเฟส 3 — คู่ขนานกับ computeReconcileSummary ของเฟส 2 (glOnlyCount/glOnlyTotal รับเข้ามาจาก
 * computeGLOnlyTotal เดิมของเฟส 2 ตรงๆ เพราะ GLOnlyResult[] ไม่มีการเปลี่ยนแปลงรูปร่างเลยในเฟส 3) */
export function computeReconcileRowSummary(
  rows: ReconcileRow[],
  glOnlyCount: number,
  glOnlyTotal: number
): ReconcileRowSummary {
  const counts = computeReconcileTabCounts(rows);
  const unreconciledBankTotal = rows
    .filter((r) => !RESOLVED_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + Math.abs(r.bank.bank_amount), 0);

  return {
    totalBank: rows.length,
    matchedExact: counts.matched_exact,
    matchedTolerance: counts.matched_tolerance,
    confirmedManual: counts.confirmed,
    ambiguous: counts.ambiguous,
    pendingReview: counts.pending_review,
    reviewRequired: counts.review_required,
    notFoundInGL: counts.not_found_in_gl,
    notFoundInBank: glOnlyCount,
    totalDifference: round2(unreconciledBankTotal + glOnlyTotal),
  };
}

/** ข้อความสรุปรูปแบบกลุ่ม เช่น "1 Bank : 2 GL" หรือ "2 Bank : 1 GL" ตามที่สเปกระบุตัวอย่างไว้ตรงๆ */
export function formatGroupSummary(group: Pick<MatchGroup, 'bank_transaction_ids' | 'gl_transaction_ids'>): string {
  return `${group.bank_transaction_ids.length} Bank : ${group.gl_transaction_ids.length} GL`;
}

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  one_to_one: 'ยืนยัน 1 ต่อ 1',
  one_to_many: '1 Bank ต่อหลาย GL',
  many_to_one: 'หลาย Bank ต่อ 1 GL',
  manual_override: 'เลือกด้วยตนเอง',
};

export const AMOUNT_TOLERANCE_LABELS: Record<AmountToleranceOption, string> = {
  zero: '0.00',
  small: '0.01',
  one: '1.00',
  custom: 'กำหนดเอง',
};

export const AMOUNT_TOLERANCE_VALUES: Record<Exclude<AmountToleranceOption, 'custom'>, number> = {
  zero: 0,
  small: 0.01,
  one: 1,
};

export const DEFAULT_AMOUNT_TOLERANCE: AmountToleranceOption = 'zero';

/** แปลงตัวเลือกค่าคลาดเคลื่อนที่ผู้ใช้เลือกให้เป็นตัวเลขจริง — กรณี 'custom' ใช้ customValue ที่ผู้ใช้กรอกเอง
 * (fallback เป็น 0 ถ้ากรอกค่าที่ไม่ใช่ตัวเลขจริง/ติดลบ เพื่อไม่ให้ validateManualMatch พังจากค่า NaN หลุดเข้าไป) */
export function resolveAmountTolerance(option: AmountToleranceOption, customValue: number): number {
  if (option === 'custom') {
    return Number.isFinite(customValue) && customValue >= 0 ? customValue : 0;
  }
  return AMOUNT_TOLERANCE_VALUES[option];
}
