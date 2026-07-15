import { describe, expect, it } from 'vitest';
import {
  calcTotal,
  computeMonthlyVatSummary,
  computeStats,
  daysBetween,
  filterInvoices,
  getAgingBucket,
  sortInvoices,
  suggestVatAmount,
  validateInvoiceForm,
} from './invoiceLogic';
import type { InvoiceFormInput, PendingTaxInvoice } from '@/types/invoice';

const TODAY = '2026-07-13';

function makeInvoice(overrides: Partial<PendingTaxInvoice>): PendingTaxInvoice {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    vendor_name: 'บริษัท ทดสอบ จำกัด',
    transaction_date: '2026-07-01',
    description: null,
    amount_excl_vat: 1000,
    vat_amount: 70,
    total_amount: 1070,
    reference_no: null,
    expected_date: '2026-07-10',
    status: 'pending',
    received_date: null,
    tax_invoice_number: null,
    notes: null,
    created_by: null,
    created_by_email: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    vendor_tax_id: null,
    tax_invoice_date: null,
    vat_claim_month: null,
    vat_claim_year: null,
    ...overrides,
  };
}

const emptyForm: InvoiceFormInput = {
  vendor_name: '',
  transaction_date: '',
  description: '',
  amount_excl_vat: '',
  vat_amount: '',
  reference_no: '',
  expected_date: '',
  notes: '',
  vendor_tax_id: '',
};

describe('suggestVatAmount', () => {
  it('คำนวณ VAT เริ่มต้น 7% จากยอดก่อนภาษี', () => {
    expect(suggestVatAmount(1000)).toBe(70);
  });

  it('ปัดเศษเป็น 2 ตำแหน่งทศนิยม', () => {
    expect(suggestVatAmount(333.33)).toBe(23.33);
  });

  it('รองรับอัตรา VAT ที่กำหนดเอง', () => {
    expect(suggestVatAmount(1000, 0.1)).toBe(100);
  });

  it('คืนค่า 0 เมื่อยอดติดลบ', () => {
    expect(suggestVatAmount(-100)).toBe(0);
  });

  it('คืนค่า 0 เมื่อยอดเป็น NaN', () => {
    expect(suggestVatAmount(NaN)).toBe(0);
  });

  it('คืนค่า 0 เมื่อยอดเป็น 0', () => {
    expect(suggestVatAmount(0)).toBe(0);
  });
});

describe('calcTotal', () => {
  it('รวมยอดก่อนภาษีกับ VAT', () => {
    expect(calcTotal(1000, 70)).toBe(1070);
  });

  it('จัดการค่าที่ไม่ใช่ตัวเลขเป็น 0', () => {
    expect(calcTotal(NaN, 70)).toBe(70);
    expect(calcTotal(1000, NaN)).toBe(1000);
  });

  it('ปัดเศษผลรวมให้ถูกต้อง', () => {
    expect(calcTotal(100.1, 7.02)).toBeCloseTo(107.12, 2);
  });
});

describe('daysBetween', () => {
  it('คำนวณจำนวนวันระหว่างวันที่ถูกต้อง', () => {
    expect(daysBetween('2026-07-01', '2026-07-10')).toBe(9);
  });

  it('คืนค่าติดลบเมื่อวันที่ปลายทางอยู่ก่อนวันที่เริ่ม', () => {
    expect(daysBetween('2026-07-10', '2026-07-01')).toBe(-9);
  });

  it('คืนค่า 0 เมื่อเป็นวันเดียวกัน', () => {
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0);
  });
});

describe('getAgingBucket', () => {
  it('คืนค่า n_a เมื่อสถานะไม่ใช่ pending', () => {
    expect(getAgingBucket('2026-06-01', 'received', TODAY)).toBe('n_a');
    expect(getAgingBucket('2026-06-01', 'cancelled', TODAY)).toBe('n_a');
  });

  it('คืนค่า n_a เมื่อไม่มีวันที่คาดว่าจะได้รับ', () => {
    expect(getAgingBucket(null, 'pending', TODAY)).toBe('n_a');
  });

  it('คืนค่า not_due เมื่อวันที่คาดว่าจะได้รับยังไม่ถึง', () => {
    expect(getAgingBucket('2026-07-20', 'pending', TODAY)).toBe('not_due');
  });

  it('คืนค่า not_due เมื่อวันที่คาดว่าจะได้รับคือวันนี้พอดี', () => {
    expect(getAgingBucket(TODAY, 'pending', TODAY)).toBe('not_due');
  });

  it('คืนค่า overdue_1_7 ที่ขอบล่าง (1 วัน)', () => {
    expect(getAgingBucket('2026-07-12', 'pending', TODAY)).toBe('overdue_1_7');
  });

  it('คืนค่า overdue_1_7 ที่ขอบบน (7 วัน)', () => {
    expect(getAgingBucket('2026-07-06', 'pending', TODAY)).toBe('overdue_1_7');
  });

  it('คืนค่า overdue_8_14 ที่ขอบล่าง (8 วัน)', () => {
    expect(getAgingBucket('2026-07-05', 'pending', TODAY)).toBe('overdue_8_14');
  });

  it('คืนค่า overdue_8_14 ที่ขอบบน (14 วัน)', () => {
    expect(getAgingBucket('2026-06-29', 'pending', TODAY)).toBe('overdue_8_14');
  });

  it('คืนค่า overdue_15_30 ที่ขอบล่าง (15 วัน)', () => {
    expect(getAgingBucket('2026-06-28', 'pending', TODAY)).toBe('overdue_15_30');
  });

  it('คืนค่า overdue_15_30 ที่ขอบบน (30 วัน)', () => {
    expect(getAgingBucket('2026-06-13', 'pending', TODAY)).toBe('overdue_15_30');
  });

  it('คืนค่า overdue_30_plus เมื่อเกิน 30 วัน', () => {
    expect(getAgingBucket('2026-06-12', 'pending', TODAY)).toBe('overdue_30_plus');
  });
});

describe('validateInvoiceForm', () => {
  it('ฟอร์มว่างเปล่าต้องมี error หลายฟิลด์', () => {
    const errors = validateInvoiceForm(emptyForm);
    expect(errors.vendor_name).toBeDefined();
    expect(errors.transaction_date).toBeDefined();
    expect(errors.amount_excl_vat).toBeDefined();
  });

  it('ฟอร์มที่ถูกต้องต้องไม่มี error', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'ผู้ขาย A',
      transaction_date: '2026-07-01',
      amount_excl_vat: '1000',
      vat_amount: '70',
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('ปฏิเสธยอดก่อนภาษีที่เป็น 0 หรือติดลบ', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'A',
      transaction_date: '2026-07-01',
      amount_excl_vat: '0',
    });
    expect(errors.amount_excl_vat).toBeDefined();
  });

  it('ปฏิเสธ VAT ติดลบ', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'A',
      transaction_date: '2026-07-01',
      amount_excl_vat: '1000',
      vat_amount: '-5',
    });
    expect(errors.vat_amount).toBeDefined();
  });

  it('ปฏิเสธเมื่อวันที่คาดว่าจะได้รับอยู่ก่อนวันที่ทำรายการ', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'A',
      transaction_date: '2026-07-10',
      amount_excl_vat: '1000',
      expected_date: '2026-07-01',
    });
    expect(errors.expected_date).toBeDefined();
  });

  it('ยอมรับเมื่อวันที่คาดว่าจะได้รับตรงกับวันที่ทำรายการ', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'A',
      transaction_date: '2026-07-10',
      amount_excl_vat: '1000',
      expected_date: '2026-07-10',
    });
    expect(errors.expected_date).toBeUndefined();
  });

  it('vat_amount เป็นค่าว่างได้ (ไม่บังคับ)', () => {
    const errors = validateInvoiceForm({
      ...emptyForm,
      vendor_name: 'A',
      transaction_date: '2026-07-10',
      amount_excl_vat: '1000',
      vat_amount: '',
    });
    expect(errors.vat_amount).toBeUndefined();
  });
});

describe('filterInvoices', () => {
  const invoices = [
    makeInvoice({ id: '1', vendor_name: 'ABC จำกัด', status: 'pending', reference_no: 'REF-001' }),
    makeInvoice({ id: '2', vendor_name: 'XYZ จำกัด', status: 'received', tax_invoice_number: 'INV-999' }),
    makeInvoice({ id: '3', vendor_name: 'DEF จำกัด', status: 'cancelled' }),
  ];

  it('กรองตามสถานะ', () => {
    expect(filterInvoices(invoices, { status: 'pending' })).toHaveLength(1);
    expect(filterInvoices(invoices, { status: 'received' })).toHaveLength(1);
  });

  it('status "all" คืนค่าทั้งหมด', () => {
    expect(filterInvoices(invoices, { status: 'all' })).toHaveLength(3);
  });

  it('ค้นหาจากชื่อผู้ขาย (ไม่สนตัวพิมพ์เล็กใหญ่)', () => {
    expect(filterInvoices(invoices, { search: 'abc' })).toHaveLength(1);
  });

  it('ค้นหาจากเลขที่อ้างอิง', () => {
    expect(filterInvoices(invoices, { search: 'REF-001' })).toHaveLength(1);
  });

  it('ค้นหาจากเลขที่ใบกำกับภาษี', () => {
    expect(filterInvoices(invoices, { search: 'INV-999' })).toHaveLength(1);
  });

  it('กรองสถานะและค้นหาพร้อมกัน', () => {
    expect(filterInvoices(invoices, { status: 'pending', search: 'ABC' })).toHaveLength(1);
    expect(filterInvoices(invoices, { status: 'received', search: 'ABC' })).toHaveLength(0);
  });

  it('ค้นหาคำที่ไม่พบคืนค่าว่าง', () => {
    expect(filterInvoices(invoices, { search: 'ไม่มีทางเจอ' })).toHaveLength(0);
  });
});

describe('sortInvoices', () => {
  const invoices = [
    makeInvoice({ id: '1', vendor_name: 'C', total_amount: 300 }),
    makeInvoice({ id: '2', vendor_name: 'A', total_amount: 100 }),
    makeInvoice({ id: '3', vendor_name: 'B', total_amount: 200 }),
  ];

  it('เรียงตามชื่อผู้ขาย a-z', () => {
    const sorted = sortInvoices(invoices, 'vendor_name', 'asc');
    expect(sorted.map((i) => i.vendor_name)).toEqual(['A', 'B', 'C']);
  });

  it('เรียงตามชื่อผู้ขาย z-a', () => {
    const sorted = sortInvoices(invoices, 'vendor_name', 'desc');
    expect(sorted.map((i) => i.vendor_name)).toEqual(['C', 'B', 'A']);
  });

  it('เรียงตามยอดรวมจากน้อยไปมาก', () => {
    const sorted = sortInvoices(invoices, 'total_amount', 'asc');
    expect(sorted.map((i) => i.total_amount)).toEqual([100, 200, 300]);
  });

  it('ไม่แก้ไข array ต้นฉบับ (immutable)', () => {
    const original = [...invoices];
    sortInvoices(invoices, 'total_amount', 'desc');
    expect(invoices).toEqual(original);
  });
});

describe('computeStats', () => {
  it('นับจำนวนและยอดรวมตามสถานะได้ถูกต้อง', () => {
    const invoices = [
      makeInvoice({ id: '1', status: 'pending', total_amount: 100, expected_date: '2026-07-20' }),
      makeInvoice({ id: '2', status: 'pending', total_amount: 200, expected_date: '2026-06-01' }), // overdue
      makeInvoice({ id: '3', status: 'received', total_amount: 300 }),
      makeInvoice({ id: '4', status: 'cancelled', total_amount: 400 }),
    ];
    const stats = computeStats(invoices, TODAY);
    expect(stats.totalPending).toBe(2);
    expect(stats.totalPendingAmount).toBe(300);
    expect(stats.totalPendingVat).toBe(140); // ทั้งสองรายการ pending ใช้ vat_amount default 70 จาก makeInvoice
    expect(stats.totalReceived).toBe(1);
    expect(stats.totalCancelled).toBe(1);
    expect(stats.totalOverdue).toBe(1);
  });

  it('รายการว่างคืนค่าสถิติเป็นศูนย์ทั้งหมด', () => {
    const stats = computeStats([], TODAY);
    expect(stats.totalPending).toBe(0);
    expect(stats.totalPendingAmount).toBe(0);
    expect(stats.totalPendingVat).toBe(0);
    expect(stats.totalOverdue).toBe(0);
  });
});

describe('computeMonthlyVatSummary', () => {
  it('รวม VAT แยกตามเดือนและสถานะ (ค้างรับ vs ได้รับแล้ว)', () => {
    const invoices = [
      makeInvoice({ id: '1', transaction_date: '2026-07-01', vat_amount: 70, status: 'pending' }),
      makeInvoice({ id: '2', transaction_date: '2026-07-15', vat_amount: 30, status: 'pending' }),
      makeInvoice({ id: '3', transaction_date: '2026-07-20', vat_amount: 50, status: 'received' }),
    ];
    const summary = computeMonthlyVatSummary(invoices);
    expect(summary).toHaveLength(1);
    expect(summary[0].month).toBe('2026-07');
    expect(summary[0].vatPending).toBe(100);
    expect(summary[0].vatReceived).toBe(50);
  });

  it('แยกกลุ่มตามเดือนที่ต่างกัน เรียงเดือนล่าสุดขึ้นก่อน', () => {
    const invoices = [
      makeInvoice({ id: '1', transaction_date: '2026-05-01', vat_amount: 10, status: 'pending' }),
      makeInvoice({ id: '2', transaction_date: '2026-07-01', vat_amount: 20, status: 'pending' }),
      makeInvoice({ id: '3', transaction_date: '2026-06-01', vat_amount: 30, status: 'pending' }),
    ];
    const summary = computeMonthlyVatSummary(invoices);
    expect(summary.map((s) => s.month)).toEqual(['2026-07', '2026-06', '2026-05']);
  });

  it('ไม่นับรายการที่ยกเลิกแล้ว — เดือนที่มีแต่รายการยกเลิกจะไม่ปรากฏเลย', () => {
    const invoices = [makeInvoice({ id: '1', transaction_date: '2026-07-01', vat_amount: 70, status: 'cancelled' })];
    expect(computeMonthlyVatSummary(invoices)).toHaveLength(0);
  });

  it('เดือนที่มีทั้งรายการยกเลิกและไม่ยกเลิก — นับเฉพาะที่ไม่ยกเลิก', () => {
    const invoices = [
      makeInvoice({ id: '1', transaction_date: '2026-07-01', vat_amount: 70, status: 'pending' }),
      makeInvoice({ id: '2', transaction_date: '2026-07-05', vat_amount: 999, status: 'cancelled' }),
    ];
    const summary = computeMonthlyVatSummary(invoices);
    expect(summary).toHaveLength(1);
    expect(summary[0].vatPending).toBe(70);
    expect(summary[0].vatReceived).toBe(0);
  });

  it('ไม่มีรายการคืนค่า array ว่าง', () => {
    expect(computeMonthlyVatSummary([])).toEqual([]);
  });
});
