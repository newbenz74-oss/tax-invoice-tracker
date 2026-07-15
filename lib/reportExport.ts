import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { PurchaseTaxReportRow, PurchaseTaxReportSummary } from './vatReportLogic';
import { registerThaiFont, THAI_FONT_NAME } from './pdfThaiFont';

/** หัวคอลัมน์ของรายงานภาษีซื้อ — ใช้ทั้งใน Excel และ PDF export ให้ตรงกัน จัดลำดับตามที่สเปกกำหนด
 * (ใกล้เคียงรูปแบบรายงานภาษีซื้อของกรมสรรพากร) */
export const PURCHASE_TAX_REPORT_HEADERS = {
  taxInvoiceDate: 'วันที่ใบกำกับภาษี',
  taxInvoiceNumber: 'เลขที่ใบกำกับภาษี',
  vendorName: 'ผู้ขาย',
  vendorTaxId: 'เลขประจำตัวผู้เสียภาษี',
  description: 'รายการ',
  amountExclVat: 'ฐานภาษี',
  vatAmount: 'VAT 7%',
  totalAmount: 'ยอดรวม',
} as const;

const HEADER_ORDER = Object.values(PURCHASE_TAX_REPORT_HEADERS);

function formatDateForExport(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const THB_NUMBER = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** สั่งดาวน์โหลด Blob เป็นไฟล์ — pattern เดียวกับ handleDownloadTemplate ใน ExcelImportPanel.tsx */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** สร้างไฟล์ Excel ของรายงานภาษีซื้อ (รายการ + แถวสรุปยอดรวมท้ายตาราง) คืนค่าเป็น Blob พร้อมดาวน์โหลด */
export function buildPurchaseTaxReportExcelBlob(
  rows: PurchaseTaxReportRow[],
  summary: PurchaseTaxReportSummary,
  periodLabel: string
): Blob {
  // สร้างทั้งชีทเป็น array-of-arrays แถวเดียวรวด (ชื่อรายงาน → เว้นบรรทัด → หัวคอลัมน์ → ข้อมูล →
  // เว้นบรรทัด → แถวสรุปยอดรวม) เพื่อให้ตำแหน่งแถว/คอลัมน์แน่นอน ไม่ต้องเขียนทับซ้อนกันหลายรอบ
  const aoa: (string | number)[][] = [
    [`รายงานภาษีซื้อ — ${periodLabel}`],
    [],
    [...HEADER_ORDER],
    ...rows.map((r) => [
      formatDateForExport(r.taxInvoiceDate),
      r.taxInvoiceNumber,
      r.vendorName,
      r.vendorTaxId,
      r.description,
      r.amountExclVat,
      r.vatAmount,
      r.totalAmount,
    ]),
    [],
    ['', '', '', '', 'รวมทั้งสิ้น', summary.totalAmountExclVat, summary.totalVatAmount, summary.totalAmount],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 16) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายงานภาษีซื้อ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** สร้างไฟล์ PDF ของรายงานภาษีซื้อ (ฝังฟอนต์ Sarabun เพื่อให้แสดงภาษาไทยถูกต้อง) คืนค่าเป็น Blob */
export function buildPurchaseTaxReportPdfBlob(
  rows: PurchaseTaxReportRow[],
  summary: PurchaseTaxReportSummary,
  periodLabel: string
): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);

  doc.setFontSize(14);
  doc.text('รายงานภาษีซื้อ (Purchase Tax Report)', 14, 15);
  doc.setFontSize(10);
  doc.text(`ช่วงเวลา: ${periodLabel}`, 14, 22);

  autoTable(doc, {
    startY: 27,
    head: [HEADER_ORDER],
    body: rows.map((r) => [
      formatDateForExport(r.taxInvoiceDate),
      r.taxInvoiceNumber,
      r.vendorName,
      r.vendorTaxId,
      r.description,
      THB_NUMBER.format(r.amountExclVat),
      THB_NUMBER.format(r.vatAmount),
      THB_NUMBER.format(r.totalAmount),
    ]),
    foot: [
      [
        'รวมทั้งสิ้น',
        '',
        '',
        '',
        '',
        THB_NUMBER.format(summary.totalAmountExclVat),
        THB_NUMBER.format(summary.totalVatAmount),
        THB_NUMBER.format(summary.totalAmount),
      ],
    ],
    theme: 'grid',
    styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 8, cellPadding: 1.5 },
    headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [37, 99, 235], textColor: 255 },
    footStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [243, 244, 246], textColor: [17, 24, 39] },
    columnStyles: {
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  });

  return doc.output('blob');
}
