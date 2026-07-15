import { describe, expect, it } from 'vitest';
import {
  filterPurchaseTaxReport,
  sortPurchaseTaxReport,
  summarizePurchaseTaxReport,
  toPurchaseTaxReportRows,
} from './vatReportLogic';
import type { PendingTaxInvoice } from '@/types/invoice';

function makeInvoice(overrides: Partial<PendingTaxInvoice>): PendingTaxInvoice {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    vendor_name: 'บริษัท ทดสอบ จำกัด',
    transaction_date: '2026-07-01',
    description: 'ค่าสินค้า',
    amount_excl_vat: 1000,
    vat_amount: 70,
    total_amount: 1070,
    reference_no: null,
    expected_date: null,
    status: 'received',
    received_date: '2026-07-05',
    tax_invoice_number: 'INV-001',
    notes: null,
    created_by: null,
    created_by_email: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    vendor_tax_id: '1234567890123',
    tax_invoice_date: '2026-06-28',
    vat_claim_month: 7,
    vat_claim_year: 2569,
    ...overrides,
  };
}

describe('filterPurchaseTaxReport', () => {
  it('เอาเฉพาะรายการสถานะ "ได้รับแล้ว" เท่านั้น', () => {
    const invoices = [
      makeInvoice({ id: '1', status: 'received' }),
      makeInvoice({ id: '2', status: 'pending', vat_claim_month: null, vat_claim_year: null }),
      makeInvoice({ id: '3', status: 'cancelled', vat_claim_month: null, vat_claim_year: null }),
    ];
    const result = filterPurchaseTaxReport(invoices, { month: 7, year: 2569 });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('กรองตามเดือน/ปีที่ใช้เครดิต VAT ตรงกันเท่านั้น', () => {
    const invoices = [
      makeInvoice({ id: '1', vat_claim_month: 7, vat_claim_year: 2569 }),
      makeInvoice({ id: '2', vat_claim_month: 6, vat_claim_year: 2569 }),
      makeInvoice({ id: '3', vat_claim_month: 7, vat_claim_year: 2568 }),
    ];
    const result = filterPurchaseTaxReport(invoices, { month: 7, year: 2569 });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('month: "all" คืนทุกเดือนของปีนั้น', () => {
    const invoices = [
      makeInvoice({ id: '1', vat_claim_month: 1, vat_claim_year: 2569 }),
      makeInvoice({ id: '2', vat_claim_month: 12, vat_claim_year: 2569 }),
      makeInvoice({ id: '3', vat_claim_month: 5, vat_claim_year: 2568 }),
    ];
    const result = filterPurchaseTaxReport(invoices, { month: 'all', year: 2569 });
    expect(result.map((i) => i.id).sort()).toEqual(['1', '2']);
  });

  it('รายการที่ยังไม่มี vat_claim_month/year (null) ไม่ถูกนับไม่ว่าจะกรองเดือน/ปีไหน', () => {
    const invoices = [makeInvoice({ id: '1', status: 'received', vat_claim_month: null, vat_claim_year: null })];
    expect(filterPurchaseTaxReport(invoices, { month: 'all', year: 2569 })).toEqual([]);
  });

  // ตัวอย่างจากสเปก: ใบกำกับภาษีลงวันที่ 28/06/2569 บริษัทได้รับเอกสารจริง 05/07/2569 แต่นำไปใช้
  // เครดิตภาษีของเดือนกรกฎาคม — ต้องปรากฏในรายงานเดือนกรกฎาคม "ไม่ใช่" เดือนมิถุนายน แม้ใบกำกับภาษี
  // จะลงวันที่เดือนมิถุนายนก็ตาม เพราะตัวกรองหลักคือ vat_claim_month/year ไม่ใช่ tax_invoice_date
  it('ตัวอย่างจากสเปก: กรองตามเดือนที่ใช้เครดิต VAT ไม่ใช่วันที่ใบกำกับภาษีหรือวันที่ได้รับเอกสาร', () => {
    const invoice = makeInvoice({
      id: 'worked-example',
      tax_invoice_date: '2026-06-28',
      received_date: '2026-07-05',
      vat_claim_month: 7,
      vat_claim_year: 2569,
    });

    // ปรากฏในรายงานเดือนกรกฎาคม 2569 (เดือนที่ใช้เครดิต VAT)
    expect(filterPurchaseTaxReport([invoice], { month: 7, year: 2569 })).toHaveLength(1);
    // ไม่ปรากฏในรายงานเดือนมิถุนายน 2569 แม้ใบกำกับภาษีจะลงวันที่เดือนนี้ก็ตาม
    expect(filterPurchaseTaxReport([invoice], { month: 6, year: 2569 })).toHaveLength(0);
  });
});

describe('sortPurchaseTaxReport', () => {
  it('เรียงตามวันที่ใบกำกับภาษีจากเก่าไปใหม่', () => {
    const invoices = [
      makeInvoice({ id: '1', tax_invoice_date: '2026-07-20' }),
      makeInvoice({ id: '2', tax_invoice_date: '2026-07-01' }),
      makeInvoice({ id: '3', tax_invoice_date: '2026-07-10' }),
    ];
    expect(sortPurchaseTaxReport(invoices).map((i) => i.id)).toEqual(['2', '3', '1']);
  });

  it('วันที่เดียวกัน — เรียงตามเลขที่ใบกำกับภาษี', () => {
    const invoices = [
      makeInvoice({ id: '1', tax_invoice_date: '2026-07-01', tax_invoice_number: 'INV-003' }),
      makeInvoice({ id: '2', tax_invoice_date: '2026-07-01', tax_invoice_number: 'INV-001' }),
    ];
    expect(sortPurchaseTaxReport(invoices).map((i) => i.id)).toEqual(['2', '1']);
  });

  it('ไม่แก้ไข array ต้นฉบับ (immutable)', () => {
    const invoices = [makeInvoice({ id: '1', tax_invoice_date: '2026-07-20' }), makeInvoice({ id: '2', tax_invoice_date: '2026-07-01' })];
    const original = [...invoices];
    sortPurchaseTaxReport(invoices);
    expect(invoices).toEqual(original);
  });
});

describe('toPurchaseTaxReportRows', () => {
  it('แปลงฟิลด์ที่เป็น null ให้เป็น "-" (ยกเว้นวันที่ใบกำกับภาษีที่ปล่อยเป็น null ไว้ให้ formatter จัดการ)', () => {
    const rows = toPurchaseTaxReportRows([
      makeInvoice({
        id: '1',
        tax_invoice_number: null,
        vendor_tax_id: null,
        description: null,
        tax_invoice_date: null,
      }),
    ]);
    expect(rows[0]).toMatchObject({
      taxInvoiceDate: null,
      taxInvoiceNumber: '-',
      vendorTaxId: '-',
      description: '-',
    });
  });

  it('คงค่าตัวเลขและชื่อผู้ขายไว้ตามเดิม', () => {
    const rows = toPurchaseTaxReportRows([
      makeInvoice({ id: '1', vendor_name: 'ABC จำกัด', amount_excl_vat: 500, vat_amount: 35, total_amount: 535 }),
    ]);
    expect(rows[0]).toMatchObject({ vendorName: 'ABC จำกัด', amountExclVat: 500, vatAmount: 35, totalAmount: 535 });
  });
});

describe('summarizePurchaseTaxReport', () => {
  it('รวมยอดทุกคอลัมน์ตัวเลขและนับจำนวนรายการถูกต้อง', () => {
    const rows = toPurchaseTaxReportRows([
      makeInvoice({ id: '1', amount_excl_vat: 1000, vat_amount: 70, total_amount: 1070 }),
      makeInvoice({ id: '2', amount_excl_vat: 500, vat_amount: 35, total_amount: 535 }),
    ]);
    const summary = summarizePurchaseTaxReport(rows);
    expect(summary).toEqual({ count: 2, totalAmountExclVat: 1500, totalVatAmount: 105, totalAmount: 1605 });
  });

  it('array ว่างคืนค่าศูนย์ทั้งหมด', () => {
    expect(summarizePurchaseTaxReport([])).toEqual({
      count: 0,
      totalAmountExclVat: 0,
      totalVatAmount: 0,
      totalAmount: 0,
    });
  });
});
