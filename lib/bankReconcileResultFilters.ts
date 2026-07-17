import type {
  BankReconcileResultRow,
  BankReviewFlags,
  GLOnlyRow,
  GLReviewFlags,
  ReconcileMatchOutput,
  TransactionDirection,
} from '@/types/bankReconcile';

/**
 * ตรรกะกรอง/นับของหน้าผลการกระทบยอด — ใหม่ทั้งไฟล์ 2026-07-17 ตามสเปกส่วน "14. SEGMENTED CONTROL" (ตัวกรอง
 * สถานะ + ทิศทาง พร้อมจำนวนรายการกำกับแต่ละปุ่ม) และ "18. SEARCH AND FILTER" (ค้นหา/กรองเพิ่มเติม) เป็น pure
 * function ล้วนๆ ไม่แตะ React/Supabase เลย เพื่อให้ทดสอบด้วย unit test ธรรมดาได้
 *
 * ตัวกรองสถานะ (statusTab) ครอบคลุมทั้งตารางหลัก (Bank-based, ส่วน "15") และตาราง GL-only (ส่วน "16") พร้อม
 * กันตามสเปกเป๊ะ ("[ทั้งหมด/พบใน GL/ไม่พบใน GL/GL ไม่พบใน Bank]") — ตีความว่าเป็นตัวกรอง "จุดสนใจ" รวมทั้งสอง
 * ตาราง: 'all' แสดงทั้งสองตารางครบ, 'found_in_gl'/'not_found_in_gl' แสดงเฉพาะตารางหลัก (กรองแถวตามสถานะนั้น)
 * และซ่อนตาราง GL-only ไปเลย (ไม่เกี่ยวข้องกับสถานะที่เลือก), 'gl_not_found_in_bank' แสดงเฉพาะตาราง GL-only
 * (ตารางหลักไม่มีความหมายกับสถานะนี้) — เป็นดุลยพินิจที่ตัดสินใจเอง เนื่องจากสเปกไม่ได้ระบุรายละเอียด
 * ปฏิสัมพันธ์ระหว่างตัวกรองนี้กับการที่ตารางทั้งสองต้องแยกส่วนกันเสมอ (ตามส่วน "16" ที่ระบุ "separate
 * section") ไว้ตรงๆ — ระบุไว้ในสรุปผลตอนส่งมอบด้วย
 *
 * ตัวกรองทิศทาง (directionTab) และตัวกรองเพิ่มเติมของส่วน "18" (ค้นหา/ช่วงวันที่/ช่วงยอดเงิน/ตรวจสอบแล้วหรือ
 * ไม่) เป็น AND ร่วมกับตัวกรองสถานะเสมอ ใช้กับทั้งสองตารางเหมือนกัน (แถว GL-only ก็มี direction/date/amount/
 * reviewed ของตัวเองให้กรองได้เช่นกัน)
 */

export type ResultStatusTab = 'all' | 'found_in_gl' | 'not_found_in_gl' | 'gl_not_found_in_bank';
export type ResultDirectionTab = 'all' | TransactionDirection;
export type ReviewedFilter = 'all' | 'reviewed' | 'not_reviewed';

export const RESULT_STATUS_TABS: ResultStatusTab[] = ['all', 'found_in_gl', 'not_found_in_gl', 'gl_not_found_in_bank'];
export const RESULT_STATUS_TAB_LABELS: Record<ResultStatusTab, string> = {
  all: 'ทั้งหมด',
  found_in_gl: 'พบใน GL',
  not_found_in_gl: 'ไม่พบใน GL',
  gl_not_found_in_bank: 'GL ไม่พบใน Bank',
};

export const RESULT_DIRECTION_TABS: ResultDirectionTab[] = ['all', 'income', 'payment'];
export const RESULT_DIRECTION_TAB_LABELS: Record<ResultDirectionTab, string> = {
  all: 'ทั้งหมด',
  income: 'รับเงิน',
  payment: 'จ่ายเงิน',
};

export interface ResultFilters {
  statusTab: ResultStatusTab;
  directionTab: ResultDirectionTab;
  /** ค้นหาจากรายละเอียด Bank/GL หรือเลขที่เอกสาร GL หรือยอดเงิน (ตรงตามสเปกส่วน "18" เป๊ะ: "search by
   * Bank/GL description, GL doc no, amount") */
  search: string;
  dateFrom: string | null;
  dateTo: string | null;
  amountMin: string;
  amountMax: string;
  reviewedFilter: ReviewedFilter;
}

export const DEFAULT_RESULT_FILTERS: ResultFilters = {
  statusTab: 'all',
  directionTab: 'all',
  search: '',
  dateFrom: null,
  dateTo: null,
  amountMin: '',
  amountMax: '',
  reviewedFilter: 'all',
};

function matchesDateRange(date: string | null, from: string | null, to: string | null): boolean {
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
}

function matchesAmountRange(amount: number, minStr: string, maxStr: string): boolean {
  const min = minStr.trim() === '' ? null : Number(minStr);
  const max = maxStr.trim() === '' ? null : Number(maxStr);
  if (min !== null && !Number.isNaN(min) && amount < min) return false;
  if (max !== null && !Number.isNaN(max) && amount > max) return false;
  return true;
}

function matchesDirection(direction: TransactionDirection | null, tab: ResultDirectionTab): boolean {
  return tab === 'all' || direction === tab;
}

/** true = ตารางหลัก (Bank-based) ควรแสดงตามตัวกรองสถานะปัจจุบัน */
export function shouldShowPrimaryTable(statusTab: ResultStatusTab): boolean {
  return statusTab !== 'gl_not_found_in_bank';
}

/** true = ตาราง GL-only ควรแสดงตามตัวกรองสถานะปัจจุบัน */
export function shouldShowGLOnlyTable(statusTab: ResultStatusTab): boolean {
  return statusTab === 'all' || statusTab === 'gl_not_found_in_bank';
}

export function filterBankResults(
  rows: BankReconcileResultRow[],
  filters: ResultFilters,
  reviewFlags: Record<string, BankReviewFlags>
): BankReconcileResultRow[] {
  if (!shouldShowPrimaryTable(filters.statusTab)) return [];
  const query = filters.search.trim().toLowerCase();

  return rows.filter((r) => {
    if (filters.statusTab !== 'all' && filters.statusTab !== r.status) return false;
    if (!matchesDirection(r.bank.direction, filters.directionTab)) return false;
    if (!matchesDateRange(r.bank.date, filters.dateFrom, filters.dateTo)) return false;
    if (!matchesAmountRange(r.bank.amount, filters.amountMin, filters.amountMax)) return false;

    const reviewed = reviewFlags[r.bank.id]?.reviewed ?? false;
    if (filters.reviewedFilter === 'reviewed' && !reviewed) return false;
    if (filters.reviewedFilter === 'not_reviewed' && reviewed) return false;

    if (query) {
      const haystack = [r.bank.description, r.matchedGL?.description ?? '', r.matchedGL?.docNo ?? '', String(r.bank.amount)]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function filterGLOnlyResults(
  rows: GLOnlyRow[],
  filters: ResultFilters,
  reviewFlags: Record<string, GLReviewFlags>
): GLOnlyRow[] {
  if (!shouldShowGLOnlyTable(filters.statusTab)) return [];
  const query = filters.search.trim().toLowerCase();

  return rows.filter((r) => {
    if (!matchesDirection(r.gl.direction, filters.directionTab)) return false;
    if (!matchesDateRange(r.gl.date, filters.dateFrom, filters.dateTo)) return false;
    if (!matchesAmountRange(r.gl.amount, filters.amountMin, filters.amountMax)) return false;

    const reviewed = reviewFlags[r.gl.id]?.reviewed ?? false;
    if (filters.reviewedFilter === 'reviewed' && !reviewed) return false;
    if (filters.reviewedFilter === 'not_reviewed' && reviewed) return false;

    if (query) {
      const haystack = [r.gl.description, r.gl.docNo, String(r.gl.amount)].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** จำนวนรายการกำกับแต่ละปุ่มของตัวกรองสถานะ — นับจากตัวกรองอื่นทั้งหมด (ทิศทาง/ค้นหา/ช่วงวันที่/ช่วงยอดเงิน/
 * ตรวจสอบแล้ว) ที่ตั้งไว้ปัจจุบัน ยกเว้นตัวกรองสถานะเอง (สลับดูทีละปุ่ม) ตามธรรมเนียม "faceted filter count"
 * มาตรฐาน — ผู้ใช้เห็นว่าถ้าเปลี่ยนไปแท็บอื่นจะเจอกี่รายการโดยไม่ต้องกดดูเอง */
export function computeStatusTabCounts(
  matchOutput: ReconcileMatchOutput,
  filters: ResultFilters,
  bankReviewFlags: Record<string, BankReviewFlags>,
  glReviewFlags: Record<string, GLReviewFlags>
): Record<ResultStatusTab, number> {
  const counts = {} as Record<ResultStatusTab, number>;
  for (const tab of RESULT_STATUS_TABS) {
    const f = { ...filters, statusTab: tab };
    counts[tab] =
      filterBankResults(matchOutput.bankResults, f, bankReviewFlags).length +
      filterGLOnlyResults(matchOutput.glOnlyResults, f, glReviewFlags).length;
  }
  return counts;
}

export function computeDirectionTabCounts(
  matchOutput: ReconcileMatchOutput,
  filters: ResultFilters,
  bankReviewFlags: Record<string, BankReviewFlags>,
  glReviewFlags: Record<string, GLReviewFlags>
): Record<ResultDirectionTab, number> {
  const counts = {} as Record<ResultDirectionTab, number>;
  for (const tab of RESULT_DIRECTION_TABS) {
    const f = { ...filters, directionTab: tab };
    counts[tab] =
      filterBankResults(matchOutput.bankResults, f, bankReviewFlags).length +
      filterGLOnlyResults(matchOutput.glOnlyResults, f, glReviewFlags).length;
  }
  return counts;
}
