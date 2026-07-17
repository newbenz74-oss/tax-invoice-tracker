import * as XLSX from 'xlsx';
import {
  BANK_MATCH_STATUS_LABELS,
  GL_ONLY_STATUS_LABEL,
  TRANSACTION_DIRECTION_LABELS,
} from '@/types/bankReconcile';
import type { BankReviewFlags, GLReviewFlags, ReconcileMatchOutput } from '@/types/bankReconcile';
import { computeReconcileSessionKpi } from './bankReconcileKpi';
import { RECONCILE_SESSION_STATUS_LABELS } from '@/types/bankReconcileSession';
import type { ReconcileSession } from '@/types/bankReconcileSession';

/**
 * Export Excel ของรอบกระทบยอดธนาคาร — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูลทั้งโมดูล ตาม
 * สเปกส่วน "19. EXPORT EXCEL" ตรงๆ (6 ชีท: Summary, Found in GL, Bank Not Found in GL, GL Not Found in
 * Bank, Bank Raw Data, GL Raw Data) — ตัด PDF export ออกทั้งหมด (สเปกใหม่ไม่มีส่วนไหนขอ PDF export เลย ต่าง
 * จากสเปกเฟส 4 เดิมที่มีส่วน "14. EXPORT PDF" ชัดเจน — jspdf/pdfThaiFont ยังใช้อยู่ในโมดูล VAT report ของ
 * ระบบตามเดิม ไม่ได้ถูกลบทิ้ง แค่ไม่ถูกอ้างอิงจากไฟล์นี้อีกต่อไป)
 *
 * รายชื่อคอลัมน์แต่ละชีทอิงตามคอลัมน์ที่สเปกระบุไว้ตรงๆ ในส่วน "15. PRIMARY RESULT TABLE" (Found in GL/Bank
 * Not Found)/"16. GL-ONLY TABLE" (GL Not Found in Bank) ตัดคอลัมน์ "การจัดการ" ออกเสมอ (เป็นปุ่มกดของ UI
 * ล้วนๆ ไม่มีความหมายในไฟล์ Excel) — ชีท "Bank Raw Data"/"GL Raw Data" ใช้หัวคอลัมน์ทั่วไป "คอลัมน์ N" แทน
 * ชื่อคอลัมน์จริงจากไฟล์ต้นฉบับ (ไม่ได้บันทึกชื่อคอลัมน์ต้นฉบับแยกไว้ในฐานข้อมูล เก็บเฉพาะค่าดิบของแต่ละแถว
 * ผ่าน rawRow เท่านั้น) — ค่าข้อมูลทุกเซลล์ยังคงเป็นค่าดิบต้นฉบับ 100% ไม่ถูกแก้ไข เพียงแต่ป้ายหัวคอลัมน์ไม่ใช่
 * ชื่อจริงจากไฟล์เท่านั้น เป็นดุลยพินิจที่ตัดสินใจเอง (ระบุไว้ในสรุปผลตอนส่งมอบด้วย) เนื่องจากสเปกระบุแค่ "6
 * sheets ... with exact field lists" โดยไม่ได้ระบุรายชื่อคอลัมน์ทีละตัวของชีท raw data ไว้
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDateForExport(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '-';
  return `${d}/${m}/${y}`;
}

function formatDateTimeForExport(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/** สร้าง worksheet ตารางมาตรฐานหนึ่งชีท — หัวคอลัมน์ + แถวข้อมูล + แถวรวม (ถ้ามี) + ความกว้างคอลัมน์อ่านง่าย +
 * autofilter ที่แถวหัวคอลัมน์เสมอ — คัดลอกรูปแบบเดิมจาก lib/overduePurchaseTaxExport.ts (ไลบรารี xlsx รุ่น
 * community ที่ติดตั้งอยู่ไม่รองรับ frozen panes — ผู้ใช้กด "Freeze Panes" เองใน Excel ได้ตามปกติ) */
function buildTableSheet(headers: string[], rows: (string | number)[][], totalsRow?: (string | number)[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [headers, ...rows];
  if (totalsRow) aoa.push(totalsRow);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(String(h).length + 2, 14) }));
  const lastCol = XLSX.utils.encode_col(headers.length - 1);
  ws['!autofilter'] = { ref: `A1:${lastCol}1` };
  return ws;
}

function buildSummarySheet(session: ReconcileSession, kpi: ReturnType<typeof computeReconcileSessionKpi>): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['ชื่อรอบกระทบยอด', session.session_name],
    ['ไฟล์ Bank Statement', session.bank_file_name],
    ['ไฟล์ GL', session.gl_file_name],
    ['รายการ Bank ทั้งหมด', kpi.bank_row_count],
    ['พบใน GL', kpi.found_count],
    ['ไม่พบใน GL', kpi.bank_not_found_count],
    ['รายการ GL ทั้งหมด', kpi.gl_row_count],
    ['GL ที่ไม่พบใน Bank', kpi.gl_not_found_count],
    ['ยอดรับเงิน Bank', kpi.bank_income_total],
    ['ยอดจ่ายเงิน Bank', kpi.bank_payment_total],
    ['ยอดรับเงิน GL', kpi.gl_income_total],
    ['ยอดจ่ายเงิน GL', kpi.gl_payment_total],
    ['ผลต่างรายการรับ', kpi.income_difference],
    ['ผลต่างรายการจ่าย', kpi.payment_difference],
    ['สถานะ', RECONCILE_SESSION_STATUS_LABELS[session.status]],
    ['ผู้สร้าง', session.created_by_email ?? '-'],
    ['วันที่สร้าง', formatDateTimeForExport(session.created_at)],
    ['อัปเดตล่าสุดโดย', session.updated_by_email ?? '-'],
    ['วันที่อัปเดตล่าสุด', formatDateTimeForExport(session.updated_at)],
  ];
  const aoa: (string | number)[][] = [['สรุปรอบกระทบยอดธนาคาร'], [], ['หัวข้อ', 'ค่า'], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 40 }];
  ws['!autofilter'] = { ref: 'A3:B3' };
  return ws;
}

function buildFoundInGLSheet(matchOutput: ReconcileMatchOutput, bankFlags: Record<string, BankReviewFlags>): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่ Bank', 'รายละเอียด Bank', 'ประเภท', 'ยอด Bank', 'วันที่ GL', 'เลขที่เอกสาร GL', 'รายละเอียด GL', 'ยอด GL', 'ผลต่าง', 'สถานะ', 'หมายเหตุ'];
  const found = matchOutput.bankResults.filter((r) => r.status === 'found_in_gl');
  const rows = found.map((r, i) => [
    i + 1,
    formatDateForExport(r.bank.date),
    r.bank.description || '-',
    TRANSACTION_DIRECTION_LABELS[r.bank.direction!],
    r.bank.amount,
    formatDateForExport(r.matchedGL!.date),
    r.matchedGL!.docNo || '-',
    r.matchedGL!.description || '-',
    r.matchedGL!.amount,
    r.difference,
    BANK_MATCH_STATUS_LABELS[r.status],
    bankFlags[r.bank.id]?.reviewNote || '-',
  ]);
  return buildTableSheet(headers, rows);
}

function buildBankNotFoundSheet(matchOutput: ReconcileMatchOutput, bankFlags: Record<string, BankReviewFlags>): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'รายละเอียด', 'ประเภท', 'ยอด', 'ต้องบันทึก GL เพิ่ม', 'ตรวจสอบแล้ว', 'หมายเหตุ'];
  const notFound = matchOutput.bankResults.filter((r) => r.status === 'not_found_in_gl');
  const rows = notFound.map((r, i) => {
    const flags = bankFlags[r.bank.id];
    return [
      i + 1,
      formatDateForExport(r.bank.date),
      r.bank.description || '-',
      TRANSACTION_DIRECTION_LABELS[r.bank.direction!],
      r.bank.amount,
      flags?.needsGlEntry ? 'ใช่' : '-',
      flags?.reviewed ? 'ใช่' : '-',
      flags?.reviewNote || '-',
    ];
  });
  const totals = ['', '', '', 'รวม', round2(notFound.reduce((s, r) => s + r.bank.amount, 0)), '', '', ''];
  return buildTableSheet(headers, rows, totals);
}

function buildGLNotFoundSheet(matchOutput: ReconcileMatchOutput, glFlags: Record<string, GLReviewFlags>): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่ GL', 'เลขที่เอกสาร', 'รายละเอียด', 'ประเภท', 'ยอด GL', 'สถานะ', 'ต้องตรวจสอบ GL', 'ตรวจสอบแล้ว', 'หมายเหตุ'];
  const rows = matchOutput.glOnlyResults.map((r, i) => {
    const flags = glFlags[r.gl.id];
    return [
      i + 1,
      formatDateForExport(r.gl.date),
      r.gl.docNo || '-',
      r.gl.description || '-',
      TRANSACTION_DIRECTION_LABELS[r.gl.direction!],
      r.gl.amount,
      GL_ONLY_STATUS_LABEL,
      flags?.needsGlReview ? 'ใช่' : '-',
      flags?.reviewed ? 'ใช่' : '-',
      flags?.reviewNote || '-',
    ];
  });
  const totals = ['', '', '', '', 'รวม', round2(matchOutput.glOnlyResults.reduce((s, r) => s + r.gl.amount, 0)), '', '', '', ''];
  return buildTableSheet(headers, rows, totals);
}

/** ชีทข้อมูลดิบ — ทุกแถว (รวมแถวที่ถูกยกเว้นด้วย ไม่ใช่แค่แถวที่ใช้กระทบยอด) เพื่อให้ตรวจสอบย้อนหลังได้ครบถ้วน
 * ตามสเปกส่วน "23. IMPORTANT RULES" ("Keep raw and normalized data separate") — ใช้หัวคอลัมน์ทั่วไป "คอลัมน์
 * N" (ดูเหตุผลที่หัวไฟล์) ขนาดเท่ากับแถวที่มีจำนวนคอลัมน์มากที่สุดในชุดข้อมูล */
function buildRawDataSheet(rawRows: unknown[][]): XLSX.WorkSheet {
  const colCount = rawRows.reduce((max, r) => Math.max(max, r.length), 1);
  const headers = ['ลำดับ', ...Array.from({ length: colCount }, (_, i) => `คอลัมน์ ${i + 1}`)];
  const rows = rawRows.map((r, i) => [i + 1, ...Array.from({ length: colCount }, (_, c) => (r[c] === undefined || r[c] === null ? '' : String(r[c])))]);
  return buildTableSheet(headers, rows);
}

/** สร้างไฟล์ Excel ของรอบกระทบยอดธนาคารครบ 6 ชีทตามสเปกส่วน "19. EXPORT EXCEL" — รับข้อมูลที่โหลดจากฐานข้อมูล
 * จริงเข้ามาตรงๆ เสมอ (ไม่ใช่ state บนจอที่อาจยังไม่ได้บันทึก — ดู exportReconcileSessionExcel ใน
 * lib/bankReconcileSessionApi.ts) bankRows/glRows ที่ใช้สร้าง "Bank Raw Data"/"GL Raw Data" มาจาก matchOutput
 * ทางอ้อม (ผ่าน bankResults/glOnlyResults) จึงไม่รวมแถวที่ถูกยกเว้นไว้ตั้งแต่ขั้นตอนพรีวิว — เป็นไปตามเจตนาของ
 * ผู้ใช้ที่ไม่ต้องการให้แถวเหล่านั้นเป็นส่วนหนึ่งของรอบกระทบยอดนี้อีกต่อไป (เช่นเดียวกับ KPI ทั้งหมด) */
export function buildReconcileSessionExcelBlob(
  session: ReconcileSession,
  matchOutput: ReconcileMatchOutput,
  bankReviewFlags: Record<string, BankReviewFlags>,
  glReviewFlags: Record<string, GLReviewFlags>
): Blob {
  const kpi = computeReconcileSessionKpi(matchOutput);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(session, kpi), 'Summary');
  XLSX.utils.book_append_sheet(workbook, buildFoundInGLSheet(matchOutput, bankReviewFlags), 'Found in GL');
  XLSX.utils.book_append_sheet(workbook, buildBankNotFoundSheet(matchOutput, bankReviewFlags), 'Bank Not Found in GL');
  XLSX.utils.book_append_sheet(workbook, buildGLNotFoundSheet(matchOutput, glReviewFlags), 'GL Not Found in Bank');
  XLSX.utils.book_append_sheet(
    workbook,
    buildRawDataSheet(matchOutput.bankResults.map((r) => r.bank.rawRow)),
    'Bank Raw Data'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildRawDataSheet([...matchOutput.bankResults.filter((r) => r.matchedGL).map((r) => r.matchedGL!.rawRow), ...matchOutput.glOnlyResults.map((r) => r.gl.rawRow)]),
    'GL Raw Data'
  );

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
