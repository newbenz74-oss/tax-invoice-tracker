import type { BankMatchResult, BankRowMatchStatus, DateToleranceOption, GLOnlyResult, MatchStatus } from '@/types/bankReconcile';

/**
 * ชั้น "รองรับ UI" ของเครื่องมือจับคู่รายการ — เฟส 2 ของ Bank Reconcile เพิ่มเข้ามา 2026-07-16
 *
 * แยกจาก lib/bankReconcileMatching.ts (อัลกอริทึมจับคู่ล้วนๆ ไม่มีข้อความแสดงผล) โดยเจตนา ไฟล์นี้รวม
 * ป้ายกำกับภาษาไทย/สี badge + ตัวกรอง/นับจำนวน/สรุป KPI ที่ components เรียกใช้ตรงๆ ตามธรรมเนียมเดิมของ
 * โปรเจกต์ (เทียบเท่า OverdueAgingStatus + OVERDUE_AGING_LABELS + OVERDUE_FILTER_DEFAULTS + OverdueKpis
 * ที่รวมกันอยู่ใน lib/overduePurchaseTaxLogic.ts ไฟล์เดียว)
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ป้ายกำกับภาษาไทยของสถานะจับคู่ทั้ง 9 ค่า — ใช้ map เดียวกันทั้งฝั่งแถว Bank (BankRowMatchStatus) และฝั่ง
 * GL-only (ค่า 'not_found_in_bank' เดียว) เพราะ MatchStatus เป็น superset ของทั้งสองอยู่แล้ว — 3 ค่าสุดท้าย
 * ก่อน not_found_in_bank (confirmed_manual/confirmed_tolerance/confirmed_variance) เพิ่มเข้ามาในเฟส 3
 * (เครื่องมือจับคู่ด้วยตนเอง) เป็นการเพิ่ม key ต่อท้ายเท่านั้น — TypeScript บังคับให้ครบทุก key ของ MatchStatus
 * อยู่แล้ว (Record<MatchStatus,string>) จึงไม่มีทางลืมเพิ่ม ไม่มีการแก้ไข label/สีของ 6 ค่าเดิมของเฟส 1/2 เลย */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched_exact: 'เรียบร้อย',
  matched_tolerance: 'น่าจะตรงกัน',
  ambiguous: 'พบหลายรายการที่อาจตรงกัน',
  pending_review: 'รอตรวจสอบ',
  not_found_in_gl: 'ไม่พบใน GL',
  confirmed_manual: 'ยืนยันด้วยตนเอง',
  confirmed_tolerance: 'ตรงกันภายในค่าคลาดเคลื่อน',
  confirmed_variance: 'ยืนยันแบบมีผลต่าง',
  not_found_in_bank: 'ไม่พบใน Bank',
};

/** สี badge ตามสเปก (Green/Blue/Orange/Amber/Red/Purple) — globals.css มี design token แค่
 * primary(ฟ้า)/success(เขียว)/warning(เหลืองอำพัน)/danger(แดง) เท่านั้น ไม่มีโทนม่วง จึงใช้ 4 สถานะแรก map
 * เข้ากับ token เดิมที่มีอยู่แล้ว (คงธีมสีเดิมของทั้งระบบ) ส่วน ambiguous (ส้ม) และ not_found_in_bank (ม่วง)
 * ไม่มี token ให้ใช้ตรงๆ จึงใช้คลาสสีสำเร็จรูปของ Tailwind v4 ตรงๆ แทนการเพิ่ม token ใหม่ใน globals.css
 * (เลือกไม่แก้ไฟล์ธีมกลางที่ใช้ร่วมกับทุกฟีเจอร์ เพื่อลดความเสี่ยงกระทบหน้าอื่น) — pending_review ใช้ warning
 * (โทนอำพัน #f59e0b อยู่แล้วในระบบ) ตรงกับตัวเลือก "Amber" ที่สเปกอนุญาตให้ใช้แทน Orange ได้พอดี
 *
 * เฟส 3 เพิ่ม 3 สถานะใหม่ (เพิ่ม key ต่อท้ายเท่านั้น เหมือน MATCH_STATUS_LABELS ด้านบน): confirmed_manual ใช้
 * teal เข้ม (bg-teal-200/text-teal-900) ตามสเปกที่ระบุ "dark green or teal" — จงใจให้เข้ม/อิ่มตัวกว่า badge
 * อื่นทั้งหมดในระบบ (ซึ่งใช้โทนอ่อน /15 หรือ 100-level เกือบทั้งหมด) เพื่อให้ "ยืนยันโดยมนุษย์แล้ว" ดูเด่นแยก
 * จาก matched_exact (เขียวอ่อน, จับคู่อัตโนมัติ) ได้ชัดเจนแม้เป็นสีตระกูลใกล้กัน — confirmed_tolerance ใช้ cyan
 * (Blue-green ตามสเปก) — confirmed_variance ใช้ amber เข้ม (bg-amber-200/text-amber-900) เข้มกว่า pending_review
 * (bg-warning/15 ที่เป็นโทนอ่อนกว่า) เพื่อแยกแยะ "รอตรวจสอบอัตโนมัติ" กับ "ยืนยันแล้วแต่มีผลต่างที่ต้องระวัง" ได้
 * ด้วยตา ไม่ต้องอ่านข้อความ label ก็แยกออก */
export const MATCH_STATUS_BADGE_CLASS: Record<MatchStatus, string> = {
  matched_exact: 'bg-success/15 text-success',
  matched_tolerance: 'bg-primary/15 text-primary',
  ambiguous: 'bg-orange-100 text-orange-700',
  pending_review: 'bg-warning/15 text-warning',
  not_found_in_gl: 'bg-danger/15 text-danger',
  confirmed_manual: 'bg-teal-200 text-teal-900',
  confirmed_tolerance: 'bg-cyan-100 text-cyan-800',
  confirmed_variance: 'bg-amber-200 text-amber-900',
  not_found_in_bank: 'bg-purple-100 text-purple-700',
};

export const DATE_TOLERANCE_LABELS: Record<DateToleranceOption, string> = {
  same_day: 'วันเดียวกันเท่านั้น',
  '1_day': '±1 วัน',
  '3_days': '±3 วัน',
  '7_days': '±7 วัน',
};

/** แปลงตัวเลือก Date Tolerance ที่ผู้ใช้เลือกให้เป็นจำนวนวันจริง — ส่งเข้า runReconciliationMatch() ตรงๆ */
export const DATE_TOLERANCE_DAYS: Record<DateToleranceOption, number> = {
  same_day: 0,
  '1_day': 1,
  '3_days': 3,
  '7_days': 7,
};

export const DEFAULT_DATE_TOLERANCE: DateToleranceOption = '3_days';

/** ตัวกรองของตารางผลลัพธ์หลัก — ทำงานร่วมกับ Segmented Control (status) ได้พร้อมกันเสมอ (AND กันทุกเงื่อนไข
 * ตามสเปก "Search and filters must work together with the Segmented Control") */
export interface ReconcileFilters {
  search: string;
  status: BankRowMatchStatus | 'all';
  dateFrom: string | null;
  dateTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
}

export const DEFAULT_RECONCILE_FILTERS: ReconcileFilters = {
  search: '',
  status: 'all',
  dateFrom: null,
  dateTo: null,
  amountMin: null,
  amountMax: null,
};

/** ค้นหาแบบ substring ไม่สนตัวพิมพ์เล็ก/ใหญ่ ครอบคลุม 4 ช่องทางตามสเปกตรงๆ: รายละเอียด Bank, เลขที่เอกสาร GL,
 * รายละเอียด GL, และจำนวนเงิน (แปลงยอด Bank เป็นสตริงทศนิยม 2 ตำแหน่งทั้งค่าติดลบและค่าสัมบูรณ์ ให้ผู้ใช้พิมพ์
 * "15000.00" หรือ "-15000.00" แล้วเจอได้ทั้งคู่ในกรณีทั่วไปโดยไม่ต้องรู้เครื่องหมายที่ระบบเก็บภายใน) */
function matchesSearch(result: BankMatchResult, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    result.bank.bank_description,
    result.matchedGL?.gl_document_no ?? '',
    result.matchedGL?.gl_description ?? '',
    result.bank.bank_amount.toFixed(2),
    Math.abs(result.bank.bank_amount).toFixed(2),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/** กรองช่วงวันที่ตาม "วันที่ Bank" — แถวที่ไม่มีวันที่ (แปลงวันที่ไม่ได้) ถือว่าไม่ตรงเงื่อนไขทันทีเมื่อมีการ
 * เลือกช่วงวันที่ไว้ (เดียวกับ matchesMonthYear ใน lib/overduePurchaseTaxLogic.ts) */
function matchesDateRange(result: BankMatchResult, dateFrom: string | null, dateTo: string | null): boolean {
  if (!dateFrom && !dateTo) return true;
  const d = result.bank.bank_date;
  if (!d) return false;
  if (dateFrom && d < dateFrom) return false;
  if (dateTo && d > dateTo) return false;
  return true;
}

/** กรองช่วงจำนวนเงินตามค่าสัมบูรณ์ของยอด Bank (ผู้ใช้กรอกช่วงเป็นตัวเลขบวกล้วนๆ ไม่ต้องสนใจเครื่องหมาย
 * เงินเข้า/เงินออกภายใน) */
function matchesAmountRange(result: BankMatchResult, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  const amt = Math.abs(result.bank.bank_amount);
  if (min !== null && amt < min) return false;
  if (max !== null && amt > max) return false;
  return true;
}

/** กรองผลลัพธ์ตารางหลักตาม Segmented Control (status) + ช่องค้นหา + ตัวกรองเสริมทั้งหมดพร้อมกัน (AND) */
export function filterBankResults(results: BankMatchResult[], filters: ReconcileFilters): BankMatchResult[] {
  return results.filter((r) => {
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (!matchesSearch(r, filters.search)) return false;
    if (!matchesDateRange(r, filters.dateFrom, filters.dateTo)) return false;
    if (!matchesAmountRange(r, filters.amountMin, filters.amountMax)) return false;
    return true;
  });
}

const BANK_ROW_STATUSES: BankRowMatchStatus[] = [
  'matched_exact',
  'matched_tolerance',
  'ambiguous',
  'pending_review',
  'not_found_in_gl',
];

/** นับจำนวนแยกตามสถานะสำหรับ Segmented Control — คำนวณจากผลลัพธ์ "ทั้งหมด" เสมอ ไม่ผูกกับตัวกรองอื่นที่
 * เลือกอยู่ในขณะนั้น (ตามธรรมเนียม overview dashboard ทั่วไป: ทุกแท็บต้องเห็นจำนวนรวมของแท็บนั้นๆ เสมอ ไม่ใช่
 * จำนวนที่เหลือหลังกรองด้วยแท็บอื่น) — เรียกซ้ำได้ทุกครั้งที่ toleranceDays เปลี่ยน/รัน matching ใหม่ */
export function computeStatusCounts(results: BankMatchResult[]): Record<BankRowMatchStatus, number> {
  const counts = Object.fromEntries(BANK_ROW_STATUSES.map((s) => [s, 0])) as Record<BankRowMatchStatus, number>;
  for (const r of results) counts[r.status] += 1;
  return counts;
}

export interface ReconcileSummary {
  totalBank: number;
  matchedExact: number;
  matchedTolerance: number;
  ambiguous: number;
  pendingReview: number;
  notFoundInGL: number;
  notFoundInBank: number;
  totalDifference: number;
}

/**
 * สรุป KPI 8 การ์ดตามสเปก — totalDifference (ผลต่างรวม) ไม่มีสูตรระบุไว้ตรงๆ ในสเปก (มีแค่ชื่อการ์ด) ตีความ
 * เป็นผลรวมค่าสัมบูรณ์ของยอดเงินฝั่งที่ยัง "กระทบยอดไม่ได้" ทั้งหมดทั้งสองฝั่ง: ฝั่ง Bank (ทุกสถานะยกเว้น
 * matched_exact/matched_tolerance ซึ่งถือว่ากระทบยอดแล้ว) รวมกับฝั่ง GL ที่เหลือค้าง (glOnlyResults) — ไม่ใช่
 * ผลต่างระหว่างยอด Bank กับยอด GL ของคู่ที่จับคู่ได้แล้ว เพราะคู่ที่จับคู่แล้วมี amount_difference ≈ 0 อยู่แล้ว
 * ตามนิยามการจับคู่ (ต้องยอดเงินตรงกันเป๊ะเสมอ) เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผลตอนส่งมอบด้วย
 */
export function computeReconcileSummary(bankResults: BankMatchResult[], glOnlyResults: GLOnlyResult[]): ReconcileSummary {
  const counts = computeStatusCounts(bankResults);
  const unreconciledBankTotal = bankResults
    .filter((r) => r.status !== 'matched_exact' && r.status !== 'matched_tolerance')
    .reduce((sum, r) => sum + Math.abs(r.bank.bank_amount), 0);
  const unmatchedGLTotal = glOnlyResults.reduce((sum, r) => sum + Math.abs(r.gl.gl_amount), 0);

  return {
    totalBank: bankResults.length,
    matchedExact: counts.matched_exact,
    matchedTolerance: counts.matched_tolerance,
    ambiguous: counts.ambiguous,
    pendingReview: counts.pending_review,
    notFoundInGL: counts.not_found_in_gl,
    notFoundInBank: glOnlyResults.length,
    totalDifference: round2(unreconciledBankTotal + unmatchedGLTotal),
  };
}

/** ยอดรวมของ GL ที่เหลือค้างทั้งหมด (ค่าสัมบูรณ์) — ใช้แสดงในส่วน "รายการใน GL ที่ไม่พบใน Bank Statement" */
export function computeGLOnlyTotal(glOnlyResults: GLOnlyResult[]): number {
  return round2(glOnlyResults.reduce((sum, r) => sum + Math.abs(r.gl.gl_amount), 0));
}
