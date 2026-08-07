import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { registerThaiFont, THAI_FONT_NAME } from './pdfThaiFont';
import type { TransactionType } from '@/types/bankReconcile';

/**
 * โมดูล export ของหน้า "ดูรายละเอียด" ประวัติการกระทบยอด (BankReconcileHistoryDetail.tsx, เพิ่มเข้ามา
 * 2026-08-05) — เขียนตาม pattern เดียวกับ lib/reportExport.ts (รายงานภาษีซื้อ) ทุกประการ: ฟังก์ชัน
 * build*Blob คืนค่า Blob ล้วนๆ ไม่ยุ่งกับ DOM/download เอง (ให้ downloadBlob() จาก reportExport.ts จัดการ
 * ต่อ — import ใช้ร่วมกันได้เลย ไม่ต้องประกาศซ้ำ), PDF ฝังฟอนต์ Sarabun ผ่าน registerThaiFont() ตัวเดียวกัน
 *
 * ต่างจากรายงานภาษีซื้อตรงที่มีแถวสรุป 3 ระดับต่อท้าย (ไม่ใช่แค่ยอดรวมเดียว) ตามที่ผู้ใช้ขอ ("อยากรู้ว่า
 * ยอดรวมตรงกับ Statement ไหม"): ยอดรวม Bank Statement ทั้งหมด, ยอดที่กระทบยอดสำเร็จ, ยอดที่ยังไม่จับคู่ —
 * สองบรรทัดหลังรวมกันต้องเท่ากับบรรทัดแรกเสมอ (ดู summarizeBankReconcileHistoryRows) เป็นการยืนยันว่าไม่มี
 * แถวไหนตกหล่นไปจากผลรวม ไม่ใช่แค่โชว์ยอดเฉยๆ
 */

export interface BankReconcileHistoryExportRow {
  date: string; // ISO YYYY-MM-DD
  type: TransactionType;
  amount: number;
  /** เลขที่เอกสาร GL ที่แถวนี้จับคู่ด้วย (อาจมากกว่า 1 ถ้าอยู่ใน group แบบจับคู่เอง N:M) — [] = ยังไม่จับคู่ */
  glDocumentNos: string[];
}

export interface BankReconcileHistoryExportSummary {
  totalReceive: number;
  totalPayment: number;
  matchedReceive: number;
  matchedPayment: number;
  unmatchedReceive: number;
  unmatchedPayment: number;
}

/** สรุปยอดรวม 3 ระดับ (ทั้งหมด/กระทบยอดสำเร็จ/ยังไม่จับคู่) แยกรับ-จ่าย จาก export rows ชุดเดียวกับที่
 * แสดงในตาราง — matchedReceive+unmatchedReceive ต้องเท่ากับ totalReceive เสมอโดยธรรมชาติของการคำนวณนี้
 * (ทุกแถวถูกนับอยู่ฝั่งใดฝั่งหนึ่งเท่านั้น ไม่มีทางตกหล่นหรือนับซ้ำ) ใช้ทั้งใน UI (BankReconcileHistoryDetail)
 * และไฟล์ export เพื่อให้ตัวเลขตรงกันทุกจุดเสมอ */
export function summarizeBankReconcileHistoryRows(
  rows: BankReconcileHistoryExportRow[]
): BankReconcileHistoryExportSummary {
  const summary: BankReconcileHistoryExportSummary = {
    totalReceive: 0,
    totalPayment: 0,
    matchedReceive: 0,
    matchedPayment: 0,
    unmatchedReceive: 0,
    unmatchedPayment: 0,
  };
  for (const row of rows) {
    const matched = row.glDocumentNos.length > 0;
    if (row.type === 'receive') {
      summary.totalReceive += row.amount;
      if (matched) summary.matchedReceive += row.amount;
      else summary.unmatchedReceive += row.amount;
    } else {
      summary.totalPayment += row.amount;
      if (matched) summary.matchedPayment += row.amount;
      else summary.unmatchedPayment += row.amount;
    }
  }
  return summary;
}

const EXPORT_HEADERS = ['วันที่', 'รับ', 'จ่าย', 'จับคู่กับ GL เลขที่', 'สถานะ'] as const;

const THB_NUMBER = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDateForExport(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function docsLabel(docs: string[]): string {
  return docs.length > 0 ? docs.join(', ') : '-';
}

function statusLabel(docs: string[]): string {
  return docs.length > 0 ? 'จับคู่สำเร็จ' : 'ยังไม่จับคู่';
}

/** สร้างไฟล์ Excel ของรายงานประวัติกระทบยอด 1 รายการ (รายการ Bank Statement ทุกแถว + สรุปยอดรวม 3 ระดับ
 * ท้ายตาราง) คืนค่าเป็น Blob พร้อมดาวน์โหลดผ่าน downloadBlob() จาก lib/reportExport.ts */
export function buildBankReconcileHistoryExcelBlob(
  rows: BankReconcileHistoryExportRow[],
  summary: BankReconcileHistoryExportSummary,
  reportLabel: string
): Blob {
  const aoa: (string | number)[][] = [
    [`ประวัติการกระทบยอด — ${reportLabel}`],
    [],
    [...EXPORT_HEADERS],
    ...rows.map((r) => [
      formatDateForExport(r.date),
      r.type === 'receive' ? r.amount : '',
      r.type === 'payment' ? r.amount : '',
      docsLabel(r.glDocumentNos),
      statusLabel(r.glDocumentNos),
    ]),
    [],
    ['สรุปยอดรวม', '', '', '', ''],
    ['Bank Statement (ทั้งหมด)', summary.totalReceive, summary.totalPayment, '', ''],
    ['กระทบยอดสำเร็จ', summary.matchedReceive, summary.matchedPayment, '', ''],
    ['ยังไม่จับคู่', summary.unmatchedReceive, summary.unmatchedPayment, '', ''],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 16 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ประวัติการกระทบยอด');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** สร้างไฟล์ PDF ของรายงานประวัติกระทบยอด 1 รายการ (ฝังฟอนต์ Sarabun เพื่อให้แสดงภาษาไทยถูกต้อง) คืนค่า
 * เป็น Blob — โครงหน้าเหมือน buildPurchaseTaxReportPdfBlob() ใน lib/reportExport.ts ทุกประการ ต่างกันแค่
 * มีแถวสรุป 3 แถวใน foot แทนที่จะมีแถวเดียว */
export function buildBankReconcileHistoryPdfBlob(
  rows: BankReconcileHistoryExportRow[],
  summary: BankReconcileHistoryExportSummary,
  reportLabel: string
): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);

  doc.setFontSize(14);
  doc.text('ประวัติการกระทบยอด (Bank Reconcile History)', 14, 15);
  doc.setFontSize(10);
  doc.text(reportLabel, 14, 22);

  autoTable(doc, {
    startY: 27,
    head: [[...EXPORT_HEADERS]],
    body: rows.map((r) => [
      formatDateForExport(r.date),
      r.type === 'receive' ? THB_NUMBER.format(r.amount) : '-',
      r.type === 'payment' ? THB_NUMBER.format(r.amount) : '-',
      docsLabel(r.glDocumentNos),
      statusLabel(r.glDocumentNos),
    ]),
    foot: [
      ['Bank Statement (ทั้งหมด)', THB_NUMBER.format(summary.totalReceive), THB_NUMBER.format(summary.totalPayment), '', ''],
      ['กระทบยอดสำเร็จ', THB_NUMBER.format(summary.matchedReceive), THB_NUMBER.format(summary.matchedPayment), '', ''],
      ['ยังไม่จับคู่', THB_NUMBER.format(summary.unmatchedReceive), THB_NUMBER.format(summary.unmatchedPayment), '', ''],
    ],
    theme: 'grid',
    styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 8, cellPadding: 1.5 },
    headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [37, 99, 235], textColor: 255 },
    footStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [243, 244, 246], textColor: [17, 24, 39] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });

  return doc.output('blob');
}

export interface UnmatchedTableExportRow {
  date: string; // ISO YYYY-MM-DD
  type: TransactionType;
  amount: number;
  documentNo?: string;
  /** คำอธิบายรายการ (เพิ่มเข้ามา 2026-08-07) — มีเฉพาะฝั่ง GL เท่านั้น ใช้คู่กับพารามิเตอร์ showDescription
   * ของ buildUnmatchedTableExcelBlob ด้านล่าง */
  description?: string;
}

export interface UnmatchedTableExportTotals {
  totalReceive: number;
  totalPayment: number;
}

/** สร้างไฟล์ Excel ของตาราง "Bank Statement ไม่สำเร็จ" หรือ "GL ไม่สำเร็จ" 1 ตาราง (เพิ่มเข้ามา 2026-08-05
 * ตามคำขอผู้ใช้ — ยืนยันว่ายอดรวมท้ายตารางมาจากแถวในตารางนี้เท่านั้นได้ด้วยตัวเอง โดยเปิดไฟล์แล้วลองใช้สูตร
 * SUM ในโปรแกรม Excel เทียบกับตัวเลขที่แอปคำนวณให้) ต่างจาก buildBankReconcileHistoryExcelBlob() ตรงที่
 * คอลัมน์ตรงกับตารางบนหน้าจอ "เป๊ะ" ทุกคอลัมน์ (วันที่ / [เลขที่เอกสาร] / รับ / จ่าย / สถานะ — ไม่มีคอลัมน์
 * "จับคู่กับ GL เลขที่" เพราะทุกแถวในตารางนี้ไม่มีคู่อยู่แล้วโดยนิยาม) ไม่ใช่ export รวมทั้งรายงานเหมือนฟังก์ชัน
 * นั้น — ใช้ใน BankReconcileUnmatchedTable.tsx โดยตรง (component เดียวกันที่ใช้ทั้ง section "Bank Statement
 * ไม่สำเร็จ" และ "GL ไม่สำเร็จ" อยู่แล้ว จึงส่ง showDocumentNo มาควบคุมว่าจะมีคอลัมน์เลขที่เอกสารหรือไม่) */
export function buildUnmatchedTableExcelBlob(
  rows: UnmatchedTableExportRow[],
  totals: UnmatchedTableExportTotals,
  title: string,
  showDocumentNo: boolean,
  // เพิ่มเข้ามา 2026-08-07 ตามคำขอผู้ใช้ — คอลัมน์ "คำอธิบาย" เฉพาะตาราง "GL ไม่สำเร็จ" ค่าเริ่มต้น false
  // เพื่อไม่กระทบ call site เดิมที่ยังไม่ได้ส่งพารามิเตอร์นี้มา (Bank Statement ไม่สำเร็จ)
  showDescription: boolean = false
): Blob {
  // จำนวนคอลัมน์ "นำหน้า" ก่อนถึง รับ/จ่าย/สถานะ เปลี่ยนไปตาม showDocumentNo/showDescription — สร้างหัว
  // ตาราง/แถวข้อมูล/แถวสรุปแบบไดนามิกด้วยอาร์เรย์เดียวกันนี้เสมอ กัน hard-code ตำแหน่งคอลัมน์ผิดพลาด
  const headers = [
    'วันที่',
    ...(showDocumentNo ? ['เลขที่เอกสาร'] : []),
    ...(showDescription ? ['คำอธิบาย'] : []),
    'รับ',
    'จ่าย',
    'สถานะ',
  ];
  const leadingBlanksForTotalRow = (showDocumentNo ? 1 : 0) + (showDescription ? 1 : 0);

  const rowToAoa = (r: UnmatchedTableExportRow): (string | number)[] => [
    formatDateForExport(r.date),
    ...(showDocumentNo ? [r.documentNo || '-'] : []),
    ...(showDescription ? [r.description || '-'] : []),
    r.type === 'receive' ? r.amount : '',
    r.type === 'payment' ? r.amount : '',
    'ยังไม่จับคู่',
  ];

  const totalRow: (string | number)[] = [
    `รวมทั้งหมด (${rows.length} รายการ)`,
    ...Array(leadingBlanksForTotalRow).fill(''),
    totals.totalReceive,
    totals.totalPayment,
    '',
  ];

  const aoa: (string | number)[][] = [[title], [], headers, ...rows.map(rowToAoa), [], totalRow];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [
    { wch: 14 },
    ...(showDocumentNo ? [{ wch: 18 }] : []),
    ...(showDescription ? [{ wch: 28 }] : []),
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, title.slice(0, 31)); // ชื่อชีทของ Excel ยาวได้สูงสุด 31 ตัวอักษร
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
