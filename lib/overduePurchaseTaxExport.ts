import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { registerThaiFont, THAI_FONT_NAME } from './pdfThaiFont';
import { getTaxInvoiceStatusLabel } from './invoiceLogic';
import { getOverdueAging, groupByVendor, groupOverdueByMonth, type OverdueKpis } from './overduePurchaseTaxLogic';
import type { PendingTaxInvoice } from '@/types/invoice';

// ใช้ downloadBlob เดิมจาก lib/reportExport.ts (ไม่ import ที่นี่เพราะ component เรียกใช้ตรงได้อยู่แล้ว
// เป็น utility กลางที่ไม่ผูกกับรายงานภาษีซื้อรายงานใดรายงานหนึ่ง — ไม่ duplicate โค้ดส่วนนี้)

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDateForExport(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const THB_NUMBER = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** หัวคอลัมน์ของ Export Excel — ใช้ทั้งใน Excel export และเทียบผลเทสต์ */
export const OVERDUE_EXPORT_HEADERS = {
  month: 'เดือน',
  vendorName: 'ผู้ขาย',
  transactionDate: 'วันที่ทำรายการ',
  referenceNo: 'เลขที่อ้างอิง',
  expectedDate: 'วันที่คาดว่าจะได้รับ',
  agingText: 'จำนวนวันที่ค้าง',
  amountExclVat: 'ยอดก่อน VAT',
  vatAmount: 'VAT',
  totalAmount: 'ยอดรวม',
  statusLabel: 'สถานะ',
} as const;

const HEADER_ORDER = Object.values(OVERDUE_EXPORT_HEADERS);

/** สร้างไฟล์ Excel ของหน้า "ภาษีซื้อที่ยังไม่ได้รับ" — รับเฉพาะรายการที่ผ่านตัวกรองปัจจุบันแล้ว
 * (ตามสเปก "Export ต้องรองรับตาม Filter ปัจจุบัน") จัดเรียงตามกลุ่มเดือนเดียวกับที่แสดงบนหน้าจอ
 * ท้ายไฟล์มีแถวสรุปยอดรวม (จำนวนรายการ/ยอดก่อน VAT/VAT/ยอดรวม) ตามสเปก */
export function buildOverdueExcelBlob(invoices: PendingTaxInvoice[], today: string, periodLabel: string): Blob {
  const monthGroups = groupOverdueByMonth(invoices, today);
  const dataRows: (string | number)[][] = monthGroups.flatMap((group) =>
    group.invoices.map((inv) => {
      const aging = getOverdueAging(inv.expected_date, today);
      return [
        group.monthLabel,
        inv.vendor_name,
        formatDateForExport(inv.transaction_date),
        inv.reference_no ?? '-',
        formatDateForExport(inv.expected_date),
        aging.daysText,
        inv.amount_excl_vat,
        inv.vat_amount,
        inv.total_amount,
        // ใช้ getTaxInvoiceStatusLabel เดิมจาก lib/invoiceLogic.ts ตรงๆ (ไม่ hardcode ข้อความ) เพราะ
        // แม้ทุกรายการในหน้านี้จะสถานะ pending เหมือนกัน แต่ label ที่ถูกต้องต่างกันได้ตาม tax_type:
        // claimable_vat -> "รอรับใบกำกับภาษี", ข้อมูลเก่า tax_type เป็น NULL -> "รอตรวจสอบประเภทภาษี"
        getTaxInvoiceStatusLabel(inv),
      ];
    })
  );

  const totalExclVat = round2(invoices.reduce((s, i) => s + i.amount_excl_vat, 0));
  const totalVat = round2(invoices.reduce((s, i) => s + i.vat_amount, 0));
  const totalAmount = round2(invoices.reduce((s, i) => s + i.total_amount, 0));

  const aoa: (string | number)[][] = [
    [`รายงานใบกำกับภาษีซื้อที่ยังไม่ได้รับ — ${periodLabel}`],
    [],
    [...HEADER_ORDER],
    ...dataRows,
    [],
    ['', '', '', '', '', `รวมทั้งสิ้น (${invoices.length} รายการ)`, totalExclVat, totalVat, totalAmount, ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 18) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ภาษีซื้อที่ยังไม่ได้รับ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** อ่านค่า finalY ของตารางล่าสุดที่ jspdf-autotable วาดไป — jspdf-autotable ผูก `lastAutoTable` เข้ากับ
 * instance ของ jsPDF เป็นผลข้างเคียงเสมอ (ยืนยันจากซอร์สของแพ็กเกจ) แต่ไม่ได้ประกาศ type ไว้ใน jsPDF
 * เอง จึง cast แบบจำกัดขอบเขตแทนการปิด type-check ทั้งไฟล์ */
function getLastAutoTableFinalY(doc: jsPDF, fallback: number): number {
  const docWithTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return docWithTable.lastAutoTable?.finalY ?? fallback;
}

export interface OverduePdfKpis extends Pick<OverdueKpis, 'vendorCount' | 'itemCount' | 'totalAmountExclVat' | 'totalVatAmount'> {
  totalAmount: number;
}

/** สร้างไฟล์ PDF ของหน้า "ภาษีซื้อที่ยังไม่ได้รับ" — หัวรายงานตามสเปก (ชื่อรายงาน/ช่วงเวลา/วันที่ออก
 * รายงาน/สรุป KPI) ตามด้วยตารางแยกกลุ่มตามเดือนแล้วตามผู้ขาย (ไม่ใช่ตารางเดียวรวดเหมือนรายงานภาษีซื้อ
 * เดิม เพราะสเปกข้อนี้ระบุ "จัดกลุ่มตามเดือนและผู้ขาย" ชัดเจน) — ไล่ตำแหน่ง Y เองระหว่างส่วนหัวข้อความกับ
 * ตาราง (autoTable จัดการแบ่งหน้าของตัวเองอัตโนมัติอยู่แล้วถ้าตารางเดียวยาวเกินหน้า แต่หัวข้อเดือน/ผู้ขาย
 * ที่วาดด้วย doc.text() เองต้องเช็คขอบเขตหน้าเองต่างหาก) */
export function buildOverduePdfBlob(
  invoices: PendingTaxInvoice[],
  today: string,
  periodLabel: string,
  issuedDateLabel: string,
  kpis: OverduePdfKpis
): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;

  doc.setFontSize(14);
  doc.text('รายงานใบกำกับภาษีซื้อที่ยังไม่ได้รับ', marginX, 15);
  doc.setFontSize(10);
  doc.text(`ช่วงเวลา: ${periodLabel}`, marginX, 22);
  doc.text(`วันที่ออกรายงาน: ${issuedDateLabel}`, marginX, 27);
  doc.text(
    `จำนวนบริษัท: ${kpis.vendorCount}   จำนวนรายการ: ${kpis.itemCount}   ` +
      `รวมยอดก่อน VAT: ${THB_NUMBER.format(kpis.totalAmountExclVat)}   ` +
      `รวม VAT: ${THB_NUMBER.format(kpis.totalVatAmount)}   ` +
      `รวมยอดทั้งหมด: ${THB_NUMBER.format(kpis.totalAmount)}`,
    marginX,
    32
  );

  let cursorY = 40;
  const monthGroups = groupOverdueByMonth(invoices, today);

  for (const monthGroup of monthGroups) {
    if (cursorY > pageHeight - 30) {
      doc.addPage();
      cursorY = 15;
    }
    doc.setFontSize(11);
    doc.setFont(THAI_FONT_NAME, 'bold');
    doc.text(
      `${monthGroup.monthLabel} — ${monthGroup.itemCount} รายการ, ${monthGroup.vendorCount} บริษัท, เกินกำหนด ${monthGroup.overdueCount} รายการ`,
      marginX,
      cursorY
    );
    doc.setFont(THAI_FONT_NAME, 'normal');
    cursorY += 5;

    for (const vendorGroup of groupByVendor(monthGroup.invoices)) {
      if (cursorY > pageHeight - 30) {
        doc.addPage();
        cursorY = 15;
      }
      doc.setFontSize(9.5);
      doc.text(
        `${vendorGroup.vendorName} (${vendorGroup.itemCount} รายการ, ยอดก่อน VAT ${THB_NUMBER.format(vendorGroup.totalAmountExclVat)}, ` +
          `VAT ${THB_NUMBER.format(vendorGroup.totalVatAmount)}, ยอดรวม ${THB_NUMBER.format(vendorGroup.totalAmount)})`,
        marginX + 2,
        cursorY
      );
      cursorY += 4;

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX + 2, right: marginX },
        head: [['วันที่ทำรายการ', 'เลขที่อ้างอิง', 'รายละเอียด', 'วันที่คาดว่าจะได้รับ', 'ค้าง', 'ยอดก่อน VAT', 'VAT', 'ยอดรวม']],
        body: vendorGroup.invoices.map((inv) => {
          const aging = getOverdueAging(inv.expected_date, today);
          return [
            formatDateForExport(inv.transaction_date),
            inv.reference_no ?? '-',
            inv.description ?? '-',
            formatDateForExport(inv.expected_date),
            aging.daysText,
            THB_NUMBER.format(inv.amount_excl_vat),
            THB_NUMBER.format(inv.vat_amount),
            THB_NUMBER.format(inv.total_amount),
          ];
        }),
        theme: 'grid',
        styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 8, cellPadding: 1.3 },
        headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [47, 167, 226], textColor: 255 },
        columnStyles: {
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
        },
      });

      cursorY = getLastAutoTableFinalY(doc, cursorY) + 6;
    }
  }

  return doc.output('blob');
}
