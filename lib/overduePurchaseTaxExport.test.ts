import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildOverdueExcelBlob, buildOverduePdfBlob, OVERDUE_EXPORT_HEADERS } from './overduePurchaseTaxExport';
import type { PendingTaxInvoice } from '@/types/invoice';

const TODAY = '2026-07-16';

function makeInvoice(overrides: Partial<PendingTaxInvoice>): PendingTaxInvoice {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    vendor_name: 'บริษัท ทดสอบ จำกัด',
    transaction_date: '2026-07-01',
    description: 'ค่าสินค้า',
    amount_excl_vat: 1000,
    vat_amount: 70,
    total_amount: 1070,
    reference_no: 'PO-001',
    expected_date: '2026-07-25',
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

const INVOICES: PendingTaxInvoice[] = [
  makeInvoice({ id: '1', vendor_name: 'บริษัท ทดสอบ จำกัด', expected_date: '2026-07-25' }),
  makeInvoice({ id: '2', vendor_name: 'ร้านค้าตัวอย่าง', expected_date: '2026-06-01', amount_excl_vat: 500, vat_amount: 35, total_amount: 535 }),
  makeInvoice({ id: '3', vendor_name: 'ผู้ขาย ไม่ระบุวันที่', expected_date: null, amount_excl_vat: 200, vat_amount: 14, total_amount: 214 }),
];

describe('buildOverdueExcelBlob', () => {
  it('สร้างไฟล์ Excel ที่อ่านกลับมาได้ มีชื่อรายงาน หัวคอลัมน์ กลุ่มเดือน และแถวสรุปยอดรวม', async () => {
    const blob = buildOverdueExcelBlob(INVOICES, TODAY, 'ทั้งหมด');
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(String(aoa[0][0])).toContain('รายงานใบกำกับภาษีซื้อที่ยังไม่ได้รับ');
    expect(aoa[2]).toEqual(Object.values(OVERDUE_EXPORT_HEADERS));

    const flat = aoa.map((r) => r.join('|')).join('\n');
    expect(flat).toContain('บริษัท ทดสอบ จำกัด');
    expect(flat).toContain('ร้านค้าตัวอย่าง');
    expect(flat).toContain('ยังไม่ระบุเดือนที่คาดว่าจะได้รับ');

    const lastRow = aoa[aoa.length - 1];
    expect(lastRow.join('|')).toContain('รวมทั้งสิ้น (3 รายการ)');
    expect(lastRow[6]).toBe(1700); // 1000+500+200
    expect(lastRow[7]).toBe(119); // 70+35+14
    expect(lastRow[8]).toBe(1819);
  });

  it('รายการว่างยังสร้างไฟล์ได้โดยไม่ error', () => {
    const blob = buildOverdueExcelBlob([], TODAY, 'ทั้งหมด');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildOverduePdfBlob', () => {
  const kpis = { vendorCount: 3, itemCount: 3, totalAmountExclVat: 1700, totalVatAmount: 119, totalAmount: 1819 };

  it('สร้างไฟล์ PDF ได้โดยไม่ error และคืนค่าเป็น Blob ที่มีขนาดมากกว่า 0', () => {
    const blob = buildOverduePdfBlob(INVOICES, TODAY, 'ทั้งหมด', '16/07/2026', kpis);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('รายการว่างยังสร้างไฟล์ PDF ได้โดยไม่ error', () => {
    const emptyKpis = { vendorCount: 0, itemCount: 0, totalAmountExclVat: 0, totalVatAmount: 0, totalAmount: 0 };
    const blob = buildOverduePdfBlob([], TODAY, 'ทั้งหมด', '16/07/2026', emptyKpis);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('รายการจำนวนมากหลายเดือน/หลายผู้ขาย (ทดสอบ page-break) ยังสร้างได้โดยไม่ error', () => {
    const many: PendingTaxInvoice[] = [];
    for (let m = 1; m <= 6; m++) {
      for (let v = 0; v < 8; v++) {
        many.push(
          makeInvoice({
            id: `m${m}-v${v}`,
            vendor_name: `ผู้ขาย ${m}-${v}`,
            expected_date: `2026-0${m}-15`,
          })
        );
      }
    }
    const blob = buildOverduePdfBlob(many, TODAY, 'ทั้งหมด', '16/07/2026', {
      vendorCount: 48,
      itemCount: 48,
      totalAmountExclVat: 48000,
      totalVatAmount: 3360,
      totalAmount: 51360,
    });
    expect(blob.size).toBeGreaterThan(0);
  });
});
