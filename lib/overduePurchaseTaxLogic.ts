import type { PendingTaxInvoice } from '@/types/invoice';
import { daysBetween } from './invoiceLogic';
import { formatMonthLabel } from './thaiDate';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * หน้า "ภาษีซื้อที่ยังไม่ได้รับ" (เดิมชื่อเมนู "ภาษีซื้อไม่ถึงกำหนด") — รายงานติดตามเอกสารที่ยังไม่ได้รับ
 * (ไม่ใช่รายงานภาษีซื้อสำหรับยื่น ภ.พ.30 ที่มีอยู่แล้วใน vatReportLogic.ts) ดึงข้อมูลจากตาราง
 * pending_tax_invoices ตัวเดียวกัน (ผ่าน INVOICES_SWR_KEY เดิม ไม่มีตารางใหม่/เรียก API ใหม่ใดๆ)
 *
 * เงื่อนไขคัดกรองตามสเปก 6 ข้อ (1.มี VAT, 2.vat_amount>0, 3.สถานะยังไม่ได้รับ, 4.ไม่มีเลขที่ใบกำกับภาษี,
 * 5.ไม่มีวันที่ใบกำกับภาษี, 6.tax_invoice_status=waiting_tax_invoice) ลดรูปเหลือ 3 เงื่อนไขจริงด้านล่าง
 * ได้อย่างเทียบเท่า 100% เพราะ invariant ของระบบปัจจุบัน: tax_invoice_number/tax_invoice_date ของ
 * pending_tax_invoices ถูกตั้งค่าพร้อมกันกับ status='received' เท่านั้นเสมอ (ผ่าน markReceived() ใน
 * lib/invoiceApi.ts) หรือกรอกตรงได้เฉพาะ non_claimable_vat ที่กลายเป็น status='received' ทันทีอยู่แล้ว
 * (deriveStatusForTaxType) — จึงไม่มีทางมีแถวที่ status==='pending' แต่มีเลขที่/วันที่ใบกำกับภาษีอยู่แล้ว
 * เด็ดขาด แปลว่าเงื่อนไข 4/5/6 (ไม่มีเลขที่ หรือ ไม่มีวันที่ หรือ ยังรอ) เกิดขึ้นพร้อมกันเสมอเมื่อ
 * status==='pending' — เช็ค status==='pending' เพียงอย่างเดียวจึงครอบคลุมทั้ง 4/5/6 ในตัว
 * ("tax_invoice_status" ไม่ใช่คอลัมน์จริงในฐานข้อมูล เป็นค่าที่คำนวณสดจาก tax_type+status ผ่าน
 * getTaxInvoiceStatusLabel ใน invoiceLogic.ts — ค่า "รอรับใบกำกับภาษี" ของฟังก์ชันนั้นตรงกับ status==='pending'
 * ของรายการที่ไม่ใช่ no_vat/non_claimable_vat พอดี ซึ่งคือเงื่อนไขด้านล่างนี้เป๊ะ)
 *
 * รายการเก่าก่อนมีฟีเจอร์จำแนกประเภทภาษี (tax_type เป็น NULL) ปฏิบัติเหมือน claimable_vat ในรายงานนี้
 * เช่นเดียวกับที่ filterPurchaseTaxReport ทำ (ดู lib/vatReportLogic.ts) เพื่อไม่ให้รายการเก่าหายไปจากหน้า
 * ที่เคยเห็นได้ทันทีที่อัปเดตระบบ — ไม่มีการเดา/เขียนทับ tax_type ให้แต่อย่างใด
 */
export function filterUnreceivedPurchaseTax(invoices: PendingTaxInvoice[]): PendingTaxInvoice[] {
  return invoices.filter((inv) => {
    if (inv.tax_type === 'no_vat' || inv.tax_type === 'non_claimable_vat') return false; // ห้ามแสดง
    if (inv.status !== 'pending') return false; // ได้รับแล้ว/ยกเลิก ห้ามแสดง
    if (!(inv.vat_amount > 0)) return false; // เงื่อนไข 2
    return true;
  });
}

/* ============================== Aging (3 สถานะ) ==============================
 * ต่างจาก getAgingBucket เดิมใน invoiceLogic.ts (แบ่งช่วง 1-7/8-14/15-30/30+ วัน ใช้ในหน้าบันทึกค่าใช้จ่าย/
 * Dashboard) — หน้านี้สเปกต้องการแค่ 3 สถานะอย่างง่าย (ยังไม่ถึงกำหนด/เกินกำหนด/ไม่ระบุวันที่) จึงสร้างฟังก์ชัน
 * ใหม่แยกต่างหาก ไม่แก้ getAgingBucket เดิม (ยังใช้ที่ InvoiceTable/DashboardOverview เหมือนเดิมทุกประการ)
 * แต่ยังคงใช้ daysBetween() ตัวเดิมร่วมกันเพื่อให้การคำนวณจำนวนวันตรงกันทั้งระบบ */
export type OverdueAgingStatus = 'not_due' | 'overdue' | 'no_date';

export interface OverdueAgingInfo {
  status: OverdueAgingStatus;
  /** จำนวนวัน = วันนี้ - วันที่คาดว่าจะได้รับ (บวก = เกินกำหนดมาแล้วกี่วัน, ลบ/ศูนย์ = ยังเหลือกี่วัน) null ถ้าไม่มีวันที่ */
  days: number | null;
  /** ข้อความพร้อมแสดงผล เช่น "เหลือ 5 วัน" / "เกินกำหนด 12 วัน" / "ไม่ระบุวันที่" */
  daysText: string;
}

export const OVERDUE_AGING_LABELS: Record<OverdueAgingStatus, string> = {
  not_due: 'ยังไม่ถึงกำหนด',
  overdue: 'เกินกำหนด',
  no_date: 'ไม่ระบุวันที่',
};

export const OVERDUE_AGING_BADGE_CLASS: Record<OverdueAgingStatus, string> = {
  not_due: 'bg-sky-100 text-sky-700',
  overdue: 'bg-danger/15 text-danger',
  no_date: 'bg-gray-100 text-gray-500',
};

/** เกณฑ์ "เกินกำหนด" เดียวกับ getAgingBucket เดิม: ถ้าวันนี้ยังไม่เกินวันที่คาดว่าจะได้รับ (diff <= 0)
 * ถือว่ายังไม่ถึงกำหนด (รวมถึงวันครบกำหนดพอดี) — เกินกำหนดจริงต้องผ่านวันที่คาดว่าจะได้รับไปแล้วอย่างน้อย 1 วัน */
export function getOverdueAging(expectedDate: string | null, today: string): OverdueAgingInfo {
  if (!expectedDate) return { status: 'no_date', days: null, daysText: 'ไม่ระบุวันที่' };
  const diff = daysBetween(expectedDate, today);
  if (diff <= 0) return { status: 'not_due', days: diff, daysText: `เหลือ ${-diff} วัน` };
  return { status: 'overdue', days: diff, daysText: `เกินกำหนด ${diff} วัน` };
}

/* ============================== ตัวกรองหน้าจอ ============================== */
export interface OverdueFilterOptions {
  /** กรองตามเดือนของ "วันที่คาดว่าจะได้รับ" (expected_date) — 'all' = ไม่กรองเดือน */
  month: number | 'all';
  /** กรองตามปีปฏิทิน (ค.ศ.) ของ expected_date เช่นเดียวกับที่ formatMonthLabel/computeMonthlyVatSummary
   * แสดงปีปฏิทินตรงๆ ไม่แปลงเป็น พ.ศ. (คนละแบบกับ vat_claim_year ที่เป็น พ.ศ. โดยตั้งใจ) — 'all' = ไม่กรองปี */
  year: number | 'all';
  agingStatus: 'all' | OverdueAgingStatus;
  vendor: string | 'all';
  search: string;
}

export const OVERDUE_FILTER_DEFAULTS: OverdueFilterOptions = {
  month: 'all',
  year: 'all',
  agingStatus: 'all',
  vendor: 'all',
  search: '',
};

function matchesMonthYear(expectedDate: string | null, month: number | 'all', year: number | 'all'): boolean {
  if (month === 'all' && year === 'all') return true;
  if (!expectedDate) return false; // เลือกเดือน/ปีเจาะจงแล้ว รายการไม่ระบุวันที่ไม่มีทางตรงเงื่อนไขนี้ได้
  const [y, m] = expectedDate.split('-').map(Number);
  if (year !== 'all' && y !== year) return false;
  if (month !== 'all' && m !== month) return false;
  return true;
}

/** ใช้กับข้อมูลที่ผ่าน filterUnreceivedPurchaseTax แล้วเท่านั้น (base query) — ค้นหาแบบเดียวกับ
 * filterInvoices เดิมใน invoiceLogic.ts (ผู้ขาย/รายละเอียด/เลขที่อ้างอิง) ยกเว้นเลขที่ใบกำกับภาษี
 * เพราะรายการในหน้านี้ยังไม่มีเลขที่ใบกำกับภาษีเสมอ (ยังไม่ได้รับเอกสาร) */
export function applyOverdueFilters(
  invoices: PendingTaxInvoice[],
  filters: OverdueFilterOptions,
  today: string
): PendingTaxInvoice[] {
  return invoices.filter((inv) => {
    if (!matchesMonthYear(inv.expected_date, filters.month, filters.year)) return false;
    if (filters.agingStatus !== 'all') {
      if (getOverdueAging(inv.expected_date, today).status !== filters.agingStatus) return false;
    }
    if (filters.vendor !== 'all' && inv.vendor_name !== filters.vendor) return false;
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const hit =
        inv.vendor_name.toLowerCase().includes(q) ||
        (inv.description ?? '').toLowerCase().includes(q) ||
        (inv.reference_no ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

/* ============================== จัดกลุ่มรายเดือน ============================== */
/** key พิเศษสำหรับรายการที่ไม่มีวันที่คาดว่าจะได้รับ — เรียงไว้ท้ายสุดเสมอไม่ว่าเดือนอื่นจะมีกี่เดือนก็ตาม */
export const UNSPECIFIED_MONTH_KEY = 'unspecified';
export const UNSPECIFIED_MONTH_LABEL = 'ยังไม่ระบุเดือนที่คาดว่าจะได้รับ';

export interface OverdueMonthGroup {
  monthKey: string; // 'YYYY-MM' หรือ UNSPECIFIED_MONTH_KEY
  monthLabel: string;
  invoices: PendingTaxInvoice[];
  vendorCount: number;
  itemCount: number;
  totalAmountExclVat: number;
  totalVatAmount: number;
  totalAmount: number;
  overdueCount: number;
}

export function groupOverdueByMonth(invoices: PendingTaxInvoice[], today: string): OverdueMonthGroup[] {
  const byMonth = new Map<string, PendingTaxInvoice[]>();
  for (const inv of invoices) {
    const key = inv.expected_date ? inv.expected_date.slice(0, 7) : UNSPECIFIED_MONTH_KEY;
    const arr = byMonth.get(key);
    if (arr) arr.push(inv);
    else byMonth.set(key, [inv]);
  }

  const groups: OverdueMonthGroup[] = Array.from(byMonth.entries()).map(([monthKey, monthInvoices]) => ({
    monthKey,
    monthLabel: monthKey === UNSPECIFIED_MONTH_KEY ? UNSPECIFIED_MONTH_LABEL : formatMonthLabel(monthKey),
    invoices: monthInvoices,
    vendorCount: new Set(monthInvoices.map((i) => i.vendor_name)).size,
    itemCount: monthInvoices.length,
    totalAmountExclVat: round2(monthInvoices.reduce((s, i) => s + i.amount_excl_vat, 0)),
    totalVatAmount: round2(monthInvoices.reduce((s, i) => s + i.vat_amount, 0)),
    totalAmount: round2(monthInvoices.reduce((s, i) => s + i.total_amount, 0)),
    overdueCount: monthInvoices.filter((i) => getOverdueAging(i.expected_date, today).status === 'overdue').length,
  }));

  // เรียงเดือนล่าสุดก่อน (desc ตาม YYYY-MM) — กลุ่ม "ยังไม่ระบุเดือน" อยู่ท้ายสุดเสมอ
  groups.sort((a, b) => {
    if (a.monthKey === UNSPECIFIED_MONTH_KEY) return 1;
    if (b.monthKey === UNSPECIFIED_MONTH_KEY) return -1;
    return b.monthKey.localeCompare(a.monthKey);
  });
  return groups;
}

/* ============================== มุมมองรายบริษัท (ภายในเดือนเดียว) ============================== */
export interface OverdueVendorGroup {
  vendorName: string;
  invoices: PendingTaxInvoice[];
  itemCount: number;
  totalAmountExclVat: number;
  totalVatAmount: number;
  totalAmount: number;
}

export function groupByVendor(invoices: PendingTaxInvoice[]): OverdueVendorGroup[] {
  const byVendor = new Map<string, PendingTaxInvoice[]>();
  for (const inv of invoices) {
    const arr = byVendor.get(inv.vendor_name);
    if (arr) arr.push(inv);
    else byVendor.set(inv.vendor_name, [inv]);
  }
  return Array.from(byVendor.entries())
    .map(([vendorName, vendorInvoices]) => ({
      vendorName,
      invoices: vendorInvoices,
      itemCount: vendorInvoices.length,
      totalAmountExclVat: round2(vendorInvoices.reduce((s, i) => s + i.amount_excl_vat, 0)),
      totalVatAmount: round2(vendorInvoices.reduce((s, i) => s + i.vat_amount, 0)),
      totalAmount: round2(vendorInvoices.reduce((s, i) => s + i.total_amount, 0)),
    }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName, 'th'));
}

/* ============================== KPI Cards ============================== */
export interface OverdueKpis {
  itemCount: number;
  vendorCount: number;
  totalAmountExclVat: number;
  totalVatAmount: number;
  overdueCount: number;
}

/** คำนวณจากรายการที่ผ่านตัวกรองปัจจุบันแล้วเสมอ (ไม่ใช่ base query เฉยๆ) ตามสเปก */
export function computeOverdueKpis(invoices: PendingTaxInvoice[], today: string): OverdueKpis {
  return {
    itemCount: invoices.length,
    vendorCount: new Set(invoices.map((i) => i.vendor_name)).size,
    totalAmountExclVat: round2(invoices.reduce((s, i) => s + i.amount_excl_vat, 0)),
    totalVatAmount: round2(invoices.reduce((s, i) => s + i.vat_amount, 0)),
    overdueCount: invoices.filter((i) => getOverdueAging(i.expected_date, today).status === 'overdue').length,
  };
}

/* ============================== ตัวเลือก dropdown (ผู้ขาย/ปี) ============================== */
/** รายชื่อผู้ขายที่ปรากฏจริงในข้อมูล base query (ก่อนกรอง UI filters อื่น) เรียงตามตัวอักษรไทย —
 * ใช้ base query แทนข้อมูลที่กรองแล้ว เพื่อไม่ให้ dropdown ตัวเลือกหดหายไปเรื่อยๆ ตามตัวกรองอื่นที่เลือกไว้ */
export function getVendorOptions(invoices: PendingTaxInvoice[]): string[] {
  return Array.from(new Set(invoices.map((i) => i.vendor_name))).sort((a, b) => a.localeCompare(b, 'th'));
}

/** ปีปฏิทิน (ค.ศ.) ที่ปรากฏจริงในข้อมูล base query จาก expected_date เรียงล่าสุดก่อน */
export function getExpectedDateYearOptions(invoices: PendingTaxInvoice[]): number[] {
  const years = new Set<number>();
  for (const inv of invoices) {
    if (inv.expected_date) years.add(Number(inv.expected_date.slice(0, 4)));
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** ป้ายช่วงเวลาสำหรับหัว Export Excel/PDF — สะท้อนตัวกรองเดือน/ปีปัจจุบัน */
export function formatOverduePeriodLabel(month: number | 'all', year: number | 'all'): string {
  const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const monthLabel = month === 'all' ? null : THAI_MONTHS[month - 1];
  if (month === 'all' && year === 'all') return 'ทั้งหมด';
  if (monthLabel && year !== 'all') return `${monthLabel} ${year}`;
  if (monthLabel) return `${monthLabel} (ทุกปี)`;
  return `ปี ${year}`;
}
