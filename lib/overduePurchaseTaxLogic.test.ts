import { describe, expect, it } from 'vitest';
import {
  applyOverdueFilters,
  computeOverdueKpis,
  filterUnreceivedPurchaseTax,
  formatOverduePeriodLabel,
  getExpectedDateYearOptions,
  getOverdueAging,
  getVendorOptions,
  groupByVendor,
  groupOverdueByMonth,
  OVERDUE_FILTER_DEFAULTS,
  UNSPECIFIED_MONTH_KEY,
  UNSPECIFIED_MONTH_LABEL,
} from './overduePurchaseTaxLogic';
import type { PendingTaxInvoice } from '@/types/invoice';

const TODAY = '2026-07-16';

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
    expected_date: '2026-07-20',
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
    tax_type: 'claimable_vat',
    ...overrides,
  };
}

describe('filterUnreceivedPurchaseTax', () => {
  it('แสดงรายการ claimable_vat ที่ยังไม่ได้รับและมี VAT', () => {
    const inv = makeInvoice({ id: 'a', tax_type: 'claimable_vat', status: 'pending', vat_amount: 70 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(1);
  });

  it('แสดงรายการเก่าที่ tax_type เป็น NULL (ปฏิบัติเหมือน claimable_vat)', () => {
    const inv = makeInvoice({ id: 'legacy', tax_type: null, status: 'pending', vat_amount: 70 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(1);
  });

  it('ไม่แสดงรายการไม่มี VAT (no_vat)', () => {
    const inv = makeInvoice({ id: 'no-vat', tax_type: 'no_vat', status: 'received', vat_amount: 0 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(0);
  });

  it('ไม่แสดงรายการมี VAT แต่ไม่ใช้เครดิต VAT (non_claimable_vat)', () => {
    const inv = makeInvoice({ id: 'non-claim', tax_type: 'non_claimable_vat', status: 'received', vat_amount: 14 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(0);
  });

  it('ไม่แสดงรายการที่ได้รับใบกำกับภาษีแล้ว (status received)', () => {
    const inv = makeInvoice({ id: 'received', tax_type: 'claimable_vat', status: 'received', vat_amount: 70 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(0);
  });

  it('ไม่แสดงรายการที่ยกเลิก (status cancelled)', () => {
    const inv = makeInvoice({ id: 'cancelled', tax_type: 'claimable_vat', status: 'cancelled', vat_amount: 70 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(0);
  });

  it('ไม่แสดงรายการ VAT เท่ากับ 0', () => {
    const inv = makeInvoice({ id: 'zero-vat', tax_type: 'claimable_vat', status: 'pending', vat_amount: 0 });
    expect(filterUnreceivedPurchaseTax([inv])).toHaveLength(0);
  });
});

describe('getOverdueAging', () => {
  it('ไม่มีวันที่คาดว่าจะได้รับ -> no_date', () => {
    const aging = getOverdueAging(null, TODAY);
    expect(aging.status).toBe('no_date');
    expect(aging.days).toBeNull();
  });

  it('วันนี้ยังไม่ถึงวันที่คาดว่าจะได้รับ -> not_due พร้อมข้อความ "เหลือ N วัน"', () => {
    const aging = getOverdueAging('2026-07-21', TODAY); // เหลืออีก 5 วัน
    expect(aging.status).toBe('not_due');
    expect(aging.daysText).toBe('เหลือ 5 วัน');
  });

  it('วันนี้ตรงกับวันที่คาดว่าจะได้รับพอดี (diff=0) -> ยังถือว่า not_due (ตรงกับ getAgingBucket เดิม)', () => {
    const aging = getOverdueAging(TODAY, TODAY);
    expect(aging.status).toBe('not_due');
    expect(aging.daysText).toBe('เหลือ 0 วัน');
  });

  it('วันนี้เกินวันที่คาดว่าจะได้รับแล้ว -> overdue พร้อมข้อความ "เกินกำหนด N วัน"', () => {
    const aging = getOverdueAging('2026-07-04', TODAY); // เกินมา 12 วัน
    expect(aging.status).toBe('overdue');
    expect(aging.daysText).toBe('เกินกำหนด 12 วัน');
  });
});

describe('applyOverdueFilters', () => {
  const invoices = [
    makeInvoice({ id: 'jul', vendor_name: 'ผู้ขาย ก', expected_date: '2026-07-25' }), // not_due (เทียบ TODAY)
    makeInvoice({ id: 'jun-overdue', vendor_name: 'ผู้ขาย ข', expected_date: '2026-06-01' }), // overdue
    makeInvoice({ id: 'no-date', vendor_name: 'ผู้ขาย ก', expected_date: null }),
  ];

  it('ไม่กรองเลย (default) คืนทุกรายการรวมที่ไม่มีวันที่ด้วย', () => {
    expect(applyOverdueFilters(invoices, OVERDUE_FILTER_DEFAULTS, TODAY)).toHaveLength(3);
  });

  it('กรองตามเดือน 7 ปี 2026 ได้เฉพาะรายการเดือนกรกฎาคม ไม่รวมรายการไม่มีวันที่', () => {
    const result = applyOverdueFilters(invoices, { ...OVERDUE_FILTER_DEFAULTS, month: 7, year: 2026 }, TODAY);
    expect(result.map((i) => i.id)).toEqual(['jul']);
  });

  it('กรองสถานะ overdue ได้เฉพาะรายการเกินกำหนด', () => {
    const result = applyOverdueFilters(invoices, { ...OVERDUE_FILTER_DEFAULTS, agingStatus: 'overdue' }, TODAY);
    expect(result.map((i) => i.id)).toEqual(['jun-overdue']);
  });

  it('กรองสถานะ no_date ได้เฉพาะรายการไม่ระบุวันที่', () => {
    const result = applyOverdueFilters(invoices, { ...OVERDUE_FILTER_DEFAULTS, agingStatus: 'no_date' }, TODAY);
    expect(result.map((i) => i.id)).toEqual(['no-date']);
  });

  it('กรองตามผู้ขาย', () => {
    const result = applyOverdueFilters(invoices, { ...OVERDUE_FILTER_DEFAULTS, vendor: 'ผู้ขาย ก' }, TODAY);
    expect(result.map((i) => i.id).sort()).toEqual(['jul', 'no-date']);
  });

  it('ค้นหาด้วยชื่อผู้ขาย/รายละเอียด/เลขที่อ้างอิง', () => {
    const withRef = [
      ...invoices,
      makeInvoice({ id: 'ref-match', vendor_name: 'อื่นๆ', reference_no: 'PO-999', expected_date: null }),
    ];
    const result = applyOverdueFilters(withRef, { ...OVERDUE_FILTER_DEFAULTS, search: 'po-999' }, TODAY);
    expect(result.map((i) => i.id)).toEqual(['ref-match']);
  });
});

describe('groupOverdueByMonth', () => {
  it('จัดกลุ่มตามเดือนของวันที่คาดว่าจะได้รับ และรวมยอดถูกต้อง', () => {
    const invoices = [
      makeInvoice({ id: 'a', vendor_name: 'ผู้ขาย A', expected_date: '2026-07-05', amount_excl_vat: 1000, vat_amount: 70, total_amount: 1070 }),
      makeInvoice({ id: 'b', vendor_name: 'ผู้ขาย B', expected_date: '2026-07-20', amount_excl_vat: 500, vat_amount: 35, total_amount: 535 }),
    ];
    const groups = groupOverdueByMonth(invoices, TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].monthKey).toBe('2026-07');
    expect(groups[0].itemCount).toBe(2);
    expect(groups[0].vendorCount).toBe(2);
    expect(groups[0].totalAmountExclVat).toBe(1500);
    expect(groups[0].totalVatAmount).toBe(105);
    expect(groups[0].totalAmount).toBe(1605);
  });

  it('รายการไม่มีวันที่คาดว่าจะได้รับ อยู่ในกลุ่ม "ยังไม่ระบุเดือนที่คาดว่าจะได้รับ"', () => {
    const invoices = [makeInvoice({ id: 'no-date', expected_date: null })];
    const groups = groupOverdueByMonth(invoices, TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].monthKey).toBe(UNSPECIFIED_MONTH_KEY);
    expect(groups[0].monthLabel).toBe(UNSPECIFIED_MONTH_LABEL);
  });

  it('เรียงเดือนล่าสุดก่อน และกลุ่มไม่ระบุเดือนอยู่ท้ายสุดเสมอ', () => {
    const invoices = [
      makeInvoice({ id: 'jun', expected_date: '2026-06-01' }),
      makeInvoice({ id: 'aug', expected_date: '2026-08-01' }),
      makeInvoice({ id: 'no-date', expected_date: null }),
      makeInvoice({ id: 'jul', expected_date: '2026-07-01' }),
    ];
    const groups = groupOverdueByMonth(invoices, TODAY);
    expect(groups.map((g) => g.monthKey)).toEqual(['2026-08', '2026-07', '2026-06', UNSPECIFIED_MONTH_KEY]);
  });

  it('นับจำนวนรายการเกินกำหนดต่อเดือนถูกต้อง', () => {
    const invoices = [
      makeInvoice({ id: 'a', expected_date: '2026-07-01' }), // เกินกำหนด (ก่อน TODAY)
      makeInvoice({ id: 'b', expected_date: '2026-07-25' }), // ยังไม่ถึงกำหนด
    ];
    const groups = groupOverdueByMonth(invoices, TODAY);
    expect(groups[0].overdueCount).toBe(1);
  });
});

describe('groupByVendor', () => {
  it('รวมรายการตามผู้ขาย พร้อมยอดรวม และเรียงตามตัวอักษร', () => {
    const invoices = [
      makeInvoice({ id: 'a', vendor_name: 'บริษัท B', amount_excl_vat: 100, vat_amount: 7, total_amount: 107 }),
      makeInvoice({ id: 'b', vendor_name: 'บริษัท A', amount_excl_vat: 200, vat_amount: 14, total_amount: 214 }),
      makeInvoice({ id: 'c', vendor_name: 'บริษัท A', amount_excl_vat: 300, vat_amount: 21, total_amount: 321 }),
    ];
    const groups = groupByVendor(invoices);
    expect(groups.map((g) => g.vendorName)).toEqual(['บริษัท A', 'บริษัท B']);
    expect(groups[0].itemCount).toBe(2);
    expect(groups[0].totalAmountExclVat).toBe(500);
    expect(groups[0].totalVatAmount).toBe(35);
    expect(groups[0].totalAmount).toBe(535);
  });
});

describe('computeOverdueKpis', () => {
  it('คำนวณ KPI ทั้ง 5 ค่าจากรายการที่ส่งเข้ามา (หลังผ่านตัวกรองแล้ว)', () => {
    const invoices = [
      makeInvoice({ id: 'a', vendor_name: 'A', expected_date: '2026-07-01', amount_excl_vat: 100, vat_amount: 7 }), // overdue
      makeInvoice({ id: 'b', vendor_name: 'B', expected_date: '2026-07-25', amount_excl_vat: 200, vat_amount: 14 }), // not_due
    ];
    const kpis = computeOverdueKpis(invoices, TODAY);
    expect(kpis).toEqual({
      itemCount: 2,
      vendorCount: 2,
      totalAmountExclVat: 300,
      totalVatAmount: 21,
      overdueCount: 1,
    });
  });

  it('คืนค่าศูนย์ทั้งหมดเมื่อไม่มีรายการ', () => {
    expect(computeOverdueKpis([], TODAY)).toEqual({
      itemCount: 0,
      vendorCount: 0,
      totalAmountExclVat: 0,
      totalVatAmount: 0,
      overdueCount: 0,
    });
  });
});

describe('getVendorOptions / getExpectedDateYearOptions', () => {
  it('คืนรายชื่อผู้ขายไม่ซ้ำ เรียงตามตัวอักษรไทย', () => {
    const invoices = [
      makeInvoice({ vendor_name: 'บริษัท ข' }),
      makeInvoice({ vendor_name: 'บริษัท ก' }),
      makeInvoice({ vendor_name: 'บริษัท ก' }),
    ];
    expect(getVendorOptions(invoices)).toEqual(['บริษัท ก', 'บริษัท ข']);
  });

  it('คืนปีที่ปรากฏจริงจาก expected_date เรียงล่าสุดก่อน ไม่นับรายการไม่มีวันที่', () => {
    const invoices = [
      makeInvoice({ expected_date: '2026-01-01' }),
      makeInvoice({ expected_date: '2025-01-01' }),
      makeInvoice({ expected_date: null }),
    ];
    expect(getExpectedDateYearOptions(invoices)).toEqual([2026, 2025]);
  });
});

describe('formatOverduePeriodLabel', () => {
  it('ทั้งหมด เมื่อไม่กรองเดือน/ปี', () => {
    expect(formatOverduePeriodLabel('all', 'all')).toBe('ทั้งหมด');
  });

  it('แสดงเดือน+ปี เมื่อกรองทั้งคู่', () => {
    expect(formatOverduePeriodLabel(7, 2026)).toBe('กรกฎาคม 2026');
  });

  it('แสดงเดือน (ทุกปี) เมื่อกรองแค่เดือน', () => {
    expect(formatOverduePeriodLabel(7, 'all')).toBe('กรกฎาคม (ทุกปี)');
  });

  it('แสดงปี เมื่อกรองแค่ปี', () => {
    expect(formatOverduePeriodLabel('all', 2026)).toBe('ปี 2026');
  });
});
