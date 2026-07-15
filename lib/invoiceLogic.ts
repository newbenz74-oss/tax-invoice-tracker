import type {
  AgingBucket,
  InvoiceFormInput,
  InvoiceStatus,
  PendingTaxInvoice,
  SortDirection,
  SortField,
  TaxType,
} from '@/types/invoice';

export const DEFAULT_VAT_RATE = 0.07;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** เสนอยอด VAT อัตโนมัติจากยอดก่อนภาษี (ค่าเริ่มต้น 7%) ผู้ใช้แก้ไขเองได้ */
export function suggestVatAmount(amountExclVat: number, vatRate: number = DEFAULT_VAT_RATE): number {
  if (!Number.isFinite(amountExclVat) || amountExclVat < 0) return 0;
  return round2(amountExclVat * vatRate);
}

/** คำนวณยอดรวม = ยอดก่อนภาษี + VAT */
export function calcTotal(amountExclVat: number, vatAmount: number): number {
  const a = Number.isFinite(amountExclVat) ? amountExclVat : 0;
  const v = Number.isFinite(vatAmount) ? vatAmount : 0;
  return round2(a + v);
}

/** จำนวนวันจาก fromISO ถึง toISO (บวก = toISO อยู่หลัง fromISO) */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + 'T00:00:00Z').getTime();
  const to = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** จัดกลุ่ม aging ตามวันที่คาดว่าจะได้รับ เทียบกับวันนี้ — เฉพาะรายการที่ยัง pending เท่านั้น */
export function getAgingBucket(
  expectedDate: string | null,
  status: InvoiceStatus,
  today: string
): AgingBucket {
  if (status !== 'pending' || !expectedDate) return 'n_a';
  const overdueDays = daysBetween(expectedDate, today);
  if (overdueDays <= 0) return 'not_due';
  if (overdueDays <= 7) return 'overdue_1_7';
  if (overdueDays <= 14) return 'overdue_8_14';
  if (overdueDays <= 30) return 'overdue_15_30';
  return 'overdue_30_plus';
}

export const AGING_LABELS: Record<AgingBucket, string> = {
  not_due: 'ยังไม่ถึงกำหนด',
  overdue_1_7: 'เกินกำหนด 1-7 วัน',
  overdue_8_14: 'เกินกำหนด 8-14 วัน',
  overdue_15_30: 'เกินกำหนด 15-30 วัน',
  overdue_30_plus: 'เกินกำหนดมากกว่า 30 วัน',
  n_a: '-',
};

export const AGING_BADGE_CLASS: Record<AgingBucket, string> = {
  not_due: 'bg-gray-100 text-gray-600',
  overdue_1_7: 'bg-yellow-100 text-yellow-800',
  overdue_8_14: 'bg-orange-100 text-orange-800',
  overdue_15_30: 'bg-red-100 text-red-800',
  overdue_30_plus: 'bg-red-200 text-red-900',
  n_a: 'bg-gray-50 text-gray-400',
};

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending: 'รอรับใบกำกับภาษี',
  received: 'ได้รับแล้ว',
  cancelled: 'ยกเลิก',
};

/** ป้ายชื่อประเภทภาษี — ใช้ในฟอร์ม, ตาราง, และหน้าตรวจสอบก่อนนำเข้า Excel ให้ตรงกันทั้งระบบ */
export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  no_vat: 'ไม่มี VAT',
  claimable_vat: 'มี VAT และใช้เครดิต VAT',
  non_claimable_vat: 'มี VAT แต่ไม่ใช้เครดิต VAT',
};

/** ข้อความสถานะที่แสดงจริงในตาราง — คำนวณจาก tax_type + status ร่วมกัน (ไม่ใช่คอลัมน์แยกในฐานข้อมูล
 * เพื่อไม่ให้มีค่าสองชุดที่ต้องคอยประสานกันเอง) status เดิม (pending/received/cancelled) ไม่ถูกแตะเลย
 * — ค่านี้เป็นแค่ "การแปลผล" สำหรับแสดงผลเท่านั้น ตาม vocabulary ที่ตกลงกันไว้:
 * no_vat → "ไม่มี VAT", รอรับ (claimable_vat) → "รอรับใบกำกับภาษี", ได้รับแล้ว (claimable_vat) →
 * "ได้รับใบกำกับภาษีแล้ว", non_claimable_vat → "ไม่ใช้เครดิต VAT" — รายการไม่มี VAT จะไม่มีทางไปอยู่ใน
 * สถานะ "รอรับใบกำกับภาษี" เด็ดขาดเพราะไม่ผ่านเงื่อนไข claimable_vat เลย */
export function getTaxInvoiceStatusLabel(invoice: Pick<PendingTaxInvoice, 'tax_type' | 'status'>): string {
  if (invoice.status === 'cancelled') return STATUS_LABELS.cancelled;
  if (invoice.tax_type == null) return 'รอตรวจสอบประเภทภาษี'; // ข้อมูลเก่าก่อนมีฟีเจอร์นี้ — ยังไม่เดาให้
  if (invoice.tax_type === 'no_vat') return TAX_TYPE_LABELS.no_vat;
  if (invoice.tax_type === 'non_claimable_vat') return 'ไม่ใช้เครดิต VAT';
  return invoice.status === 'received' ? 'ได้รับใบกำกับภาษีแล้ว' : STATUS_LABELS.pending;
}

/** สีป้ายสถานะในตาราง ตามที่ตกลงกันไว้: no_vat=เทา, รอรับ=ส้ม, ได้รับแล้ว=เขียว, ไม่ใช้เครดิต=ม่วง
 * เพิ่มสีเหลืองอำพันสำหรับข้อมูลเก่าที่ยังไม่ระบุประเภท (เพื่อชวนให้ผู้ใช้เข้าไปตรวจสอบ) และคงสีเทา
 * เดิมไว้สำหรับรายการที่ยกเลิก */
export function getTaxInvoiceStatusBadgeClass(invoice: Pick<PendingTaxInvoice, 'tax_type' | 'status'>): string {
  if (invoice.status === 'cancelled') return 'bg-gray-200 text-gray-600';
  if (invoice.tax_type == null) return 'bg-amber-100 text-amber-800';
  if (invoice.tax_type === 'no_vat') return 'bg-gray-100 text-gray-600';
  if (invoice.tax_type === 'non_claimable_vat') return 'bg-purple-100 text-purple-700';
  return invoice.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700';
}

/** หา status ('pending'/'received'/'cancelled' เดิม ไม่มีค่าใหม่เพิ่ม) ที่ควรใช้ตามประเภทภาษี —
 * no_vat และ non_claimable_vat ไม่มีขั้นตอน "รอรับใบกำกับภาษี" เลยตามสเปก จึงตั้งเป็น received ทันที
 * (ไม่มีอะไรต้องรอ) claimable_vat ใช้ขั้นตอนเดิมทุกประการ (pending ตอนสร้างใหม่, คงค่าเดิมไว้ตอนแก้ไข
 * ถ้าเคย received ไปแล้วจะไม่ถูกดึงกลับไป pending) previousStatus ที่เป็น cancelled จะไม่ถูกเปลี่ยนกลับ
 * โดยการแก้ไขฟิลด์อื่นๆ เด็ดขาด (ต้องกดปุ่มยกเลิก/กู้คืนเองเท่านั้น ซึ่งระบบยังไม่มีปุ่มกู้คืน) */
export function deriveStatusForTaxType(taxType: TaxType, previousStatus?: InvoiceStatus): InvoiceStatus {
  if (previousStatus === 'cancelled') return 'cancelled';
  if (taxType === 'no_vat' || taxType === 'non_claimable_vat') return 'received';
  return previousStatus === 'received' ? 'received' : 'pending';
}

/** ตรวจสอบความถูกต้องของฟอร์ม คืนค่า object ของ error รายฟิลด์ (ว่างถ้าไม่มี error)
 * options.taxTypeRequired ค่าเริ่มต้นคือ true (ใช้ตอนเพิ่มรายการใหม่เสมอ) — ตั้งเป็น false ได้เฉพาะ
 * ตอนแก้ไขรายการเก่าที่ tax_type เป็น NULL อยู่แล้วเท่านั้น (ก่อนมีฟีเจอร์จำแนกประเภทภาษี) เพื่อให้ยังคง
 * แก้ไขฟิลด์อื่น (เช่น แก้ชื่อผู้ขายที่พิมพ์ผิด) ได้โดยไม่ถูกบังคับให้เดา/เลือกประเภทภาษีของข้อมูลเก่า
 * ทันที ตาม "ห้ามเดาประเภทภาษีของข้อมูลเก่า" — ดู app/dashboard/page.tsx handleFormSubmit */
export function validateInvoiceForm(
  input: InvoiceFormInput,
  options?: { taxTypeRequired?: boolean }
): Partial<Record<keyof InvoiceFormInput, string>> {
  const errors: Partial<Record<keyof InvoiceFormInput, string>> = {};
  const taxTypeRequired = options?.taxTypeRequired ?? true;

  if (!input.vendor_name.trim()) {
    errors.vendor_name = 'กรุณากรอกชื่อผู้ขาย';
  }
  if (!input.transaction_date) {
    errors.transaction_date = 'กรุณาเลือกวันที่ทำรายการ';
  }

  if (taxTypeRequired && !input.tax_type) {
    errors.tax_type = 'กรุณาเลือกประเภทภาษี';
  }

  const amount = parseFloat(input.amount_excl_vat);
  if (input.amount_excl_vat.trim() === '' || Number.isNaN(amount) || amount <= 0) {
    errors.amount_excl_vat = 'กรุณากรอกจำนวนเงินที่มากกว่า 0';
  }

  // ไม่มี VAT: บังคับเป็น 0 อยู่แล้วในฟอร์ม (ช่องถูกซ่อน/ปิดใช้งาน) จึงไม่ต้องตรวจสอบความถูกต้องของ
  // ค่า VAT ที่กรอกมา — ตรวจเฉพาะกรณีมี VAT (claimable_vat/non_claimable_vat) เท่านั้น
  if (input.tax_type !== 'no_vat' && input.vat_amount.trim() !== '') {
    const vat = parseFloat(input.vat_amount);
    if (Number.isNaN(vat) || vat < 0) {
      errors.vat_amount = 'จำนวน VAT ไม่ถูกต้อง';
    }
  }

  // วันที่คาดว่าจะได้รับใบกำกับภาษีมีความหมายเฉพาะ claimable_vat เท่านั้น (ฟอร์มซ่อนช่องนี้ให้
  // ประเภทอื่นอยู่แล้ว) จึงตรวจสอบเฉพาะตอนที่มีค่าจริงๆ เท่านั้น ไม่ผูกกับ tax_type ตรงๆ
  if (input.expected_date && input.transaction_date && input.expected_date < input.transaction_date) {
    errors.expected_date = 'วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่ทำรายการ';
  }

  // เลขประจำตัวผู้เสียภาษีไม่บังคับกรอก แต่ถ้ากรอกมาต้องเป็นตัวเลข 13 หลักเท่านั้น (รูปแบบมาตรฐานไทย)
  if (input.vendor_tax_id.trim() && !/^\d{13}$/.test(input.vendor_tax_id.trim())) {
    errors.vendor_tax_id = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
  }

  return errors;
}

export interface InvoiceFilterOptions {
  status?: InvoiceStatus | 'all';
  search?: string;
}

export function filterInvoices(
  invoices: PendingTaxInvoice[],
  opts: InvoiceFilterOptions
): PendingTaxInvoice[] {
  let result = invoices;

  if (opts.status && opts.status !== 'all') {
    result = result.filter((i) => i.status === opts.status);
  }

  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim().toLowerCase();
    result = result.filter(
      (i) =>
        i.vendor_name.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.reference_no ?? '').toLowerCase().includes(q) ||
        (i.tax_invoice_number ?? '').toLowerCase().includes(q)
    );
  }

  return result;
}

export function sortInvoices(
  invoices: PendingTaxInvoice[],
  field: SortField,
  direction: SortDirection
): PendingTaxInvoice[] {
  const sorted = [...invoices].sort((a, b) => {
    const av = field === 'total_amount' ? a.total_amount : a[field] ?? '';
    const bv = field === 'total_amount' ? b.total_amount : b[field] ?? '';
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export interface InvoiceStats {
  totalPending: number;
  totalPendingAmount: number;
  totalPendingVat: number;
  totalReceived: number;
  totalCancelled: number;
  totalOverdue: number;
}

export function computeStats(invoices: PendingTaxInvoice[], today: string): InvoiceStats {
  const pending = invoices.filter((i) => i.status === 'pending');
  const received = invoices.filter((i) => i.status === 'received');
  const cancelled = invoices.filter((i) => i.status === 'cancelled');
  const overdue = pending.filter((i) => {
    const bucket = getAgingBucket(i.expected_date, i.status, today);
    return bucket !== 'not_due' && bucket !== 'n_a';
  });

  return {
    totalPending: pending.length,
    totalPendingAmount: round2(pending.reduce((sum, i) => sum + i.total_amount, 0)),
    totalPendingVat: round2(pending.reduce((sum, i) => sum + i.vat_amount, 0)),
    totalReceived: received.length,
    totalCancelled: cancelled.length,
    totalOverdue: overdue.length,
  };
}

/** สรุปยอด VAT รายเดือน (ตามเดือนของวันที่ทำรายการ) แยกเป็นค้างรับ (pending) กับได้รับแล้ว (received)
 * — ไม่นับรายการที่ยกเลิก เรียงเดือนล่าสุดขึ้นก่อน
 * ไม่นับรายการ non_claimable_vat เข้ายอดสรุปนี้ เพราะ VAT ของรายการเหล่านั้นใช้เครดิตภาษีซื้อไม่ได้
 * (นับรวมจะทำให้ยอด VAT ที่ "ได้รับแล้ว/รอรับ" ดูสูงเกินจริงเทียบกับ VAT ที่เอาไปเครดิตได้จริง)
 * ยังคงนับรายการเก่าที่ tax_type เป็น NULL และ no_vat (vat_amount เป็น 0 อยู่แล้ว ไม่กระทบยอดรวม) */
export interface MonthlyVatSummaryRow {
  month: string; // 'YYYY-MM'
  vatPending: number;
  vatReceived: number;
}

export function computeMonthlyVatSummary(invoices: PendingTaxInvoice[]): MonthlyVatSummaryRow[] {
  const byMonth = new Map<string, { vatPending: number; vatReceived: number }>();

  for (const invoice of invoices) {
    if (invoice.status === 'cancelled') continue;
    if (invoice.tax_type === 'non_claimable_vat') continue;
    const month = invoice.transaction_date.slice(0, 7);
    const entry = byMonth.get(month) ?? { vatPending: 0, vatReceived: 0 };
    if (invoice.status === 'pending') {
      entry.vatPending += invoice.vat_amount;
    } else if (invoice.status === 'received') {
      entry.vatReceived += invoice.vat_amount;
    }
    byMonth.set(month, entry);
  }

  return Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, vatPending: round2(v.vatPending), vatReceived: round2(v.vatReceived) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
