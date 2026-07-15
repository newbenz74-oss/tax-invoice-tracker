import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildPurchaseTaxReportExcelBlob, buildPurchaseTaxReportPdfBlob, PURCHASE_TAX_REPORT_HEADERS } from './reportExport';
import type { PurchaseTaxReportRow, PurchaseTaxReportSummary } from './vatReportLogic';

const ROWS: PurchaseTaxReportRow[] = [
  {
    id: '1',
    taxInvoiceDate: '2026-06-28',
    taxInvoiceNumber: 'INV-001',
    vendorName: 'บริษัท ทดสอบ จำกัด',
    vendorTaxId: '1234567890123',
    description: 'ค่าสินค้า',
    amountExclVat: 1000,
    vatAmount: 70,
    totalAmount: 1070,
  },
  {
    id: '2',
    taxInvoiceDate: null,
    taxInvoiceNumber: '-',
    vendorName: 'ผู้ขาย ไม่มีเลขผู้เสียภาษี',
    vendorTaxId: '-',
    description: '-',
    amountExclVat: 500,
    vatAmount: 35,
    totalAmount: 535,
  },
];

const SUMMARY: PurchaseTaxReportSummary = {
  count: 2,
  totalAmountExclVat: 1500,
  totalVatAmount: 105,
  totalAmount: 1605,
};

describe('buildPurchaseTaxReportExcelBlob', () => {
  it('สร้างไฟล์ Excel ที่อ่านกลับมาได้ โดยมีชื่อรายงาน หัวคอลัมน์ ข้อมูล และแถวสรุปยอดครบ', async () => {
    const blob = buildPurchaseTaxReportExcelBlob(ROWS, SUMMARY, 'กรกฎาคม 2569');
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    // แถว 0: ชื่อรายงานพร้อมช่วงเวลา
    expect(String(aoa[0][0])).toContain('รายงานภาษีซื้อ');
    expect(String(aoa[0][0])).toContain('กรกฎาคม 2569');

    // แถว 2 (หลังแถวว่างคั่น): หัวคอลัมน์ตรงตามที่กำหนด
    expect(aoa[2]).toEqual(Object.values(PURCHASE_TAX_REPORT_HEADERS));

    // แถวข้อมูล 2 แถวถัดมา
    expect(aoa[3][1]).toBe('INV-001'); // เลขที่ใบกำกับภาษี
    expect(aoa[3][2]).toBe('บริษัท ทดสอบ จำกัด');
    expect(aoa[4][1]).toBe('-');

    // แถวสรุปยอดรวมอยู่แถวสุดท้าย มีคำว่า "รวมทั้งสิ้น" และยอดรวมตรงกับ summary
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow.join('|')).toContain('รวมทั้งสิ้น');
    expect(lastRow[5]).toBe(1500);
    expect(lastRow[6]).toBe(105);
    expect(lastRow[7]).toBe(1605);
  });

  it('รายการว่างยังสร้างไฟล์ได้โดยไม่ error (มีแค่หัวคอลัมน์กับแถวสรุปเป็นศูนย์)', async () => {
    const emptySummary: PurchaseTaxReportSummary = { count: 0, totalAmountExclVat: 0, totalVatAmount: 0, totalAmount: 0 };
    const blob = buildPurchaseTaxReportExcelBlob([], emptySummary, 'ทั้งปี 2569');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildPurchaseTaxReportPdfBlob', () => {
  it('สร้างไฟล์ PDF ได้โดยไม่ error และคืนค่าเป็น Blob ที่มีขนาดมากกว่า 0', () => {
    const blob = buildPurchaseTaxReportPdfBlob(ROWS, SUMMARY, 'กรกฎาคม 2569');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('รายการว่างยังสร้างไฟล์ PDF ได้โดยไม่ error', () => {
    const emptySummary: PurchaseTaxReportSummary = { count: 0, totalAmountExclVat: 0, totalVatAmount: 0, totalAmount: 0 };
    const blob = buildPurchaseTaxReportPdfBlob([], emptySummary, 'ทั้งปี 2569');
    expect(blob.size).toBeGreaterThan(0);
  });
});
