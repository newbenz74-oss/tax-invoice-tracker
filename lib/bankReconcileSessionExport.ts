import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import type { PdfReportMode, ReconcileAuditLogEntry, ReconcileSession } from '@/types/bankReconcileSession';
import { RECONCILE_AUDIT_ACTION_LABELS, RECONCILE_SESSION_STATUS_LABELS } from '@/types/bankReconcileSession';
import { MATCH_STATUS_LABELS } from './bankReconcileMatchLogic';
import { MATCH_TYPE_LABELS } from './bankReconcileManualMatchLogic';
import { computeReconcileSessionKpi, RESOLVED_STATUSES } from './bankReconcileKpi';
import { registerThaiFont, THAI_FONT_NAME } from './pdfThaiFont';

/**
 * Export Excel (9 ชีท) + PDF (สรุป/ฉบับเต็ม) ของรอบกระทบยอดธนาคาร — เพิ่มเข้ามา 2026-07-16 สำหรับเฟส 4 ส่วน
 * "13. EXPORT EXCEL" และ "14. EXPORT PDF" ตามธรรมเนียมเดิมของ lib/overduePurchaseTaxExport.ts ทุกประการ
 * (XLSX.utils.aoa_to_sheet + jsPDF + jspdf-autotable + registerThaiFont ตัวเดิม ไม่มีการเพิ่มไฟล์ฟอนต์ใหม่
 * ตามที่สเปกห้ามตรงๆ) — ทั้งสองฟังก์ชันรับ reportDateISO เป็นพารามิเตอร์เข้ามาเสมอ (ไม่เรียก new Date()ในไฟล์
 * นี้เอง) เพื่อให้ทดสอบได้แบบ deterministic เหมือนกับ buildOverduePdfBlob(invoices, today, ...) เดิมทุกประการ
 *
 * ข้อจำกัดของไลบรารี xlsx (^0.18.5) รุ่น community ที่ติดตั้งอยู่: ตรวจสอบซอร์สโค้ดแล้วพบว่ารองรับการเขียน
 * '!autofilter' จริง (ใช้เต็มที่ในไฟล์นี้ทุกชีทที่เป็นตาราง) แต่ "freeze header" (frozen panes) ไม่มีฟังก์ชัน
 * write รองรับเลยในรุ่นนี้ (เป็นฟีเจอร์ระดับ Pro ของ SheetJS) — เลือกไม่เขียน property ที่ไม่มีผลจริงลงไปเพื่อ
 * ไม่ให้ดูเหมือนทำงานได้ทั้งที่ไม่ได้ผล เป็นข้อจำกัดของไลบรารีที่ติดตั้งไว้ก่อนแล้วในโปรเจกต์ (ไม่ใช่ไฟล์ใหม่
 * ตามที่สเปกห้ามเพิ่ม) ระบุไว้ตรงๆ ในสรุปผลตอนส่งมอบด้วย ผู้ใช้ยังกด "Freeze Panes" เองใน Excel ได้ตามปกติ
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

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const THB_NUMBER = new Intl.NumberFormat('th-TH', THB2);

function summarizeBankSide(rows: MatchBankRow[]): { date: string; description: string } {
  if (rows.length === 0) return { date: '-', description: '-' };
  if (rows.length === 1) return { date: formatDateForExport(rows[0].bank_date), description: rows[0].bank_description || '-' };
  return { date: '-', description: `${rows.length} รายการ` };
}

function summarizeGLSide(rows: MatchGLRow[]): { date: string; docNo: string; description: string } {
  if (rows.length === 0) return { date: '-', docNo: '-', description: '-' };
  if (rows.length === 1) {
    const g = rows[0];
    return { date: formatDateForExport(g.gl_date), docNo: g.gl_document_no || '-', description: g.gl_description || '-' };
  }
  return {
    date: '-',
    docNo: `${rows.length} รายการ`,
    description: rows.map((g) => g.gl_document_no || g.gl_description || '-').join(', '),
  };
}

/* ============================== Excel (§13) ============================== */

/** สร้าง worksheet ตารางมาตรฐานหนึ่งชีท — หัวคอลัมน์ + แถวข้อมูล + แถวรวม (ถ้ามี) + ความกว้างคอลัมน์อ่านง่าย +
 * autofilter ที่แถวหัวคอลัมน์เสมอ (ดูหมายเหตุข้อจำกัด freeze header ที่ header ไฟล์นี้) */
function buildTableSheet(
  headers: string[],
  rows: (string | number)[][],
  totalsRow?: (string | number)[]
): XLSX.WorkSheet {
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
    ['ธนาคาร', session.bank_name ?? '-'],
    ['เลขที่บัญชี', session.bank_account_no ?? '-'],
    ['วันที่เริ่มต้น', formatDateForExport(session.period_start)],
    ['วันที่สิ้นสุด', formatDateForExport(session.period_end)],
    ['ไฟล์ Bank Statement', session.bank_file_name],
    ['ไฟล์ GL', session.gl_file_name],
    ['จำนวนรายการ Bank', kpi.bank_row_count],
    ['จำนวนรายการ GL', kpi.gl_row_count],
    ['กระทบยอดแล้ว', kpi.matched_count],
    ['มีข้อเสนอแนะรอยืนยัน', kpi.suggested_count],
    ['ยืนยันด้วยตนเอง', kpi.manual_match_count],
    ['ต้องตรวจสอบ', kpi.review_count],
    ['ไม่พบใน GL', kpi.unmatched_bank_count],
    ['GL ไม่พบใน Bank', kpi.unmatched_gl_count],
    ['ยอด Bank รวม', kpi.bank_total],
    ['ยอด GL รวม', kpi.gl_total],
    ['ยอด Bank ที่กระทบยอดแล้ว', kpi.matched_bank_total],
    ['ยอด GL ที่กระทบยอดแล้ว', kpi.matched_gl_total],
    ['ยอด Bank ที่ยังไม่กระทบยอด', kpi.unmatched_bank_total],
    ['ยอด GL ที่ยังไม่กระทบยอด', kpi.unmatched_gl_total],
    ['ผลต่างสุทธิ', kpi.net_difference],
    ['ค่าคลาดเคลื่อนวันที่ (วัน)', session.date_tolerance_days],
    ['ค่าคลาดเคลื่อนยอดเงิน', session.amount_tolerance],
    ['สถานะ', RECONCILE_SESSION_STATUS_LABELS[session.status]],
    ['ผู้สร้าง', session.created_by_email ?? '-'],
    ['วันที่สร้าง', formatDateTimeForExport(session.created_at)],
    ['อัปเดตล่าสุดโดย', session.updated_by_email ?? '-'],
    ['วันที่อัปเดตล่าสุด', formatDateTimeForExport(session.updated_at)],
    ['ผู้ปิดรอบ', session.completed_by_email ?? '-'],
    ['วันที่ปิดรอบ', session.completed_at ? formatDateTimeForExport(session.completed_at) : '-'],
    ['หมายเหตุการปิดรอบ', session.completion_note ?? '-'],
  ];
  const aoa: (string | number)[][] = [['สรุปรอบกระทบยอดธนาคาร'], [], ['หัวข้อ', 'ค่า'], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 40 }];
  ws['!autofilter'] = { ref: 'A3:B3' };
  return ws;
}

function buildBankStatementSheet(reconcileRows: ReconcileRow[]): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอด', 'ยอดคงเหลือ', 'สถานะ'];
  const rows = reconcileRows.map((r, i) => [
    i + 1,
    formatDateForExport(r.bank.bank_date),
    r.bank.bank_description || '-',
    r.bank.bank_money_in,
    r.bank.bank_money_out,
    r.bank.bank_amount,
    r.bank.bank_balance,
    MATCH_STATUS_LABELS[r.status],
  ]);
  const totals = [
    '',
    '',
    'รวม',
    round2(reconcileRows.reduce((s, r) => s + r.bank.bank_money_in, 0)),
    round2(reconcileRows.reduce((s, r) => s + r.bank.bank_money_out, 0)),
    round2(reconcileRows.reduce((s, r) => s + r.bank.bank_amount, 0)),
    '',
    '',
  ];
  return buildTableSheet(headers, rows, totals);
}

function buildGLExpressSheet(matchGLRows: MatchGLRow[], usedGlIds: Set<string>): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต', 'ยอด', 'สถานะการใช้งาน'];
  const rows = matchGLRows.map((g, i) => [
    i + 1,
    formatDateForExport(g.gl_date),
    g.gl_document_no || '-',
    g.gl_description || '-',
    g.gl_debit,
    g.gl_credit,
    g.gl_amount,
    usedGlIds.has(g.gl_row_id) ? 'จับคู่แล้ว' : 'ยังไม่จับคู่',
  ]);
  const totals = [
    '',
    '',
    '',
    'รวม',
    round2(matchGLRows.reduce((s, g) => s + g.gl_debit, 0)),
    round2(matchGLRows.reduce((s, g) => s + g.gl_credit, 0)),
    round2(matchGLRows.reduce((s, g) => s + g.gl_amount, 0)),
    '',
  ];
  return buildTableSheet(headers, rows, totals);
}

function buildMatchedSheet(reconcileRows: ReconcileRow[]): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่ Bank', 'รายละเอียด Bank', 'ยอด Bank', 'วันที่ GL', 'เลขที่เอกสาร GL', 'รายละเอียด GL', 'ยอด GL', 'ผลต่าง', 'สถานะ'];
  const matched = reconcileRows.filter((r) => RESOLVED_STATUSES.includes(r.status));
  const rows = matched.map((r, i) => {
    const gl = summarizeGLSide(r.matchedGLRows);
    const glTotal = round2(r.matchedGLRows.reduce((s, g) => s + g.gl_amount, 0));
    return [
      i + 1,
      formatDateForExport(r.bank.bank_date),
      r.bank.bank_description || '-',
      r.bank.bank_amount,
      gl.date,
      gl.docNo,
      gl.description,
      glTotal,
      r.amountDifference ?? 0,
      MATCH_STATUS_LABELS[r.status],
    ];
  });
  return buildTableSheet(headers, rows);
}

function buildManualMatchSheet(matchGroups: MatchGroup[], bankById: Map<string, MatchBankRow>, glById: Map<string, MatchGLRow>): XLSX.WorkSheet {
  const headers = [
    'Match Group ID',
    'ประเภทการจับคู่',
    'จำนวนรายการ Bank',
    'จำนวนรายการ GL',
    'วันที่ Bank',
    'รายละเอียด Bank',
    'ยอด Bank',
    'วันที่ GL',
    'เลขที่เอกสาร GL',
    'รายละเอียด GL',
    'ยอด GL',
    'ผลต่าง',
    'วันที่ต่างกัน (วัน)',
    'คะแนนจับคู่อัตโนมัติ',
    'เหตุผลจับคู่อัตโนมัติ',
    'สถานะ',
    'ผู้ยืนยัน',
    'วันที่ยืนยัน',
    'หมายเหตุ',
  ];
  const rows = matchGroups.map((g) => {
    const bankRows = g.bank_transaction_ids.map((id) => bankById.get(id)).filter((x): x is MatchBankRow => Boolean(x));
    const glRows = g.gl_transaction_ids.map((id) => glById.get(id)).filter((x): x is MatchGLRow => Boolean(x));
    const bankSide = summarizeBankSide(bankRows);
    const glSide = summarizeGLSide(glRows);
    return [
      g.match_group_id,
      MATCH_TYPE_LABELS[g.match_type],
      g.bank_transaction_ids.length,
      g.gl_transaction_ids.length,
      bankSide.date,
      bankSide.description,
      g.bank_total,
      glSide.date,
      glSide.docNo,
      glSide.description,
      g.gl_total,
      g.amount_difference,
      g.date_difference_days ?? '-',
      g.auto_match_score ?? '-',
      g.auto_match_reason ?? '-',
      MATCH_STATUS_LABELS[g.status],
      g.matched_by,
      formatDateTimeForExport(g.matched_at),
      g.note || '-',
    ];
  });
  return buildTableSheet(headers, rows);
}

function buildUnmatchedBankSheet(reconcileRows: ReconcileRow[]): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอด', 'สถานะ', 'หมายเหตุ'];
  const unmatched = reconcileRows.filter((r) => !RESOLVED_STATUSES.includes(r.status));
  const rows = unmatched.map((r, i) => [
    i + 1,
    formatDateForExport(r.bank.bank_date),
    r.bank.bank_description || '-',
    r.bank.bank_money_in,
    r.bank.bank_money_out,
    r.bank.bank_amount,
    MATCH_STATUS_LABELS[r.status],
    r.note?.note || '-',
  ]);
  const totals = ['', '', 'รวม', '', '', round2(unmatched.reduce((s, r) => s + r.bank.bank_amount, 0)), '', ''];
  return buildTableSheet(headers, rows, totals);
}

function buildUnmatchedGLSheet(matchGLRows: MatchGLRow[], usedGlIds: Set<string>): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต', 'ยอด'];
  const unmatched = matchGLRows.filter((g) => !usedGlIds.has(g.gl_row_id));
  const rows = unmatched.map((g, i) => [
    i + 1,
    formatDateForExport(g.gl_date),
    g.gl_document_no || '-',
    g.gl_description || '-',
    g.gl_debit,
    g.gl_credit,
    g.gl_amount,
  ]);
  const totals = ['', '', '', 'รวม', round2(unmatched.reduce((s, g) => s + g.gl_debit, 0)), round2(unmatched.reduce((s, g) => s + g.gl_credit, 0)), round2(unmatched.reduce((s, g) => s + g.gl_amount, 0))];
  return buildTableSheet(headers, rows, totals);
}

function buildReviewRequiredSheet(reconcileRows: ReconcileRow[]): XLSX.WorkSheet {
  const headers = ['ลำดับ', 'วันที่', 'รายละเอียด', 'ยอด', 'สถานะ', 'ผู้ทำเครื่องหมาย', 'วันที่ทำเครื่องหมาย', 'หมายเหตุ'];
  const flagged = reconcileRows.filter((r) => r.reviewFlag !== null);
  const rows = flagged.map((r, i) => [
    i + 1,
    formatDateForExport(r.bank.bank_date),
    r.bank.bank_description || '-',
    r.bank.bank_amount,
    MATCH_STATUS_LABELS[r.status],
    r.reviewFlag?.reviewed_by || '-',
    r.reviewFlag ? formatDateTimeForExport(r.reviewFlag.reviewed_at) : '-',
    r.note?.note || '-',
  ]);
  return buildTableSheet(headers, rows);
}

function buildAuditLogSheet(auditLog: ReconcileAuditLogEntry[]): XLSX.WorkSheet {
  const headers = ['วันและเวลา', 'ผู้ดำเนินการ', 'รายการที่ทำ', 'ค่าเดิม', 'ค่าใหม่', 'หมายเหตุ'];
  const rows = auditLog.map((entry) => [
    formatDateTimeForExport(entry.performed_at),
    entry.performed_by_email || '-',
    RECONCILE_AUDIT_ACTION_LABELS[entry.action_type] ?? entry.action_type,
    entry.old_value ? JSON.stringify(entry.old_value) : '-',
    entry.new_value ? JSON.stringify(entry.new_value) : '-',
    entry.action_note || '-',
  ]);
  return buildTableSheet(headers, rows);
}

/** สร้างไฟล์ Excel ของรอบกระทบยอดธนาคารครบ 9 ชีทตามสเปกส่วน "13. EXPORT EXCEL" — รับข้อมูลที่โหลดจากฐานข้อมูล
 * จริงเข้ามาตรงๆ (ไม่ใช่ state บนจอ ตามที่สเปกกำหนด "exports the currently-opened session from saved data,
 * not screen-only state" — ผู้เรียกต้อง fetchSessionDetail()/fetchReconcileAuditLog() สดๆ ก่อนเรียกฟังก์ชันนี้
 * เสมอ ดู components/BankReconcileResults.tsx) */
export function buildReconcileSessionExcelBlob(
  session: ReconcileSession,
  reconcileRows: ReconcileRow[],
  matchGLRows: MatchGLRow[],
  matchGroups: MatchGroup[],
  auditLog: ReconcileAuditLogEntry[]
): Blob {
  const kpi = computeReconcileSessionKpi(reconcileRows, matchGLRows, matchGroups);
  const usedGlIds = new Set(matchGroups.flatMap((g) => g.gl_transaction_ids));
  const bankById = new Map(reconcileRows.map((r) => [r.bank.bank_row_id, r.bank] as const));
  const glById = new Map(matchGLRows.map((g) => [g.gl_row_id, g] as const));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(session, kpi), 'Summary');
  XLSX.utils.book_append_sheet(workbook, buildBankStatementSheet(reconcileRows), 'Bank Statement');
  XLSX.utils.book_append_sheet(workbook, buildGLExpressSheet(matchGLRows, usedGlIds), 'GL Express');
  XLSX.utils.book_append_sheet(workbook, buildMatchedSheet(reconcileRows), 'Matched');
  XLSX.utils.book_append_sheet(workbook, buildManualMatchSheet(matchGroups, bankById, glById), 'Manual Match');
  XLSX.utils.book_append_sheet(workbook, buildUnmatchedBankSheet(reconcileRows), 'Unmatched Bank');
  XLSX.utils.book_append_sheet(workbook, buildUnmatchedGLSheet(matchGLRows, usedGlIds), 'Unmatched GL');
  XLSX.utils.book_append_sheet(workbook, buildReviewRequiredSheet(reconcileRows), 'Review Required');
  XLSX.utils.book_append_sheet(workbook, buildAuditLogSheet(auditLog), 'Audit Log');

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ============================== PDF (§14) ============================== */

const PDF_ROW_CAP_SUMMARY = 50;

function addPageBreakIfNeeded(doc: jsPDF, cursorY: number, needed = 30): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (cursorY > pageHeight - needed) {
    doc.addPage();
    return 15;
  }
  return cursorY;
}

function getLastAutoTableFinalY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? last.finalY + 8 : fallback;
}

/** สร้างไฟล์ PDF รายงานการกระทบยอดธนาคารตามสเปกส่วน "14. EXPORT PDF" — mode='summary' ตัดจำนวนแถวของตาราง
 * รายการไม่พบใน GL/GL ไม่พบใน Bank/ต้องตรวจสอบไว้ที่ PDF_ROW_CAP_SUMMARY แถวแรก (พร้อมข้อความแจ้งจำนวนที่ถูก
 * ตัดไว้ท้ายตาราง — ไม่ตัดแบบเงียบๆ) และไม่แสดงตาราง "รายการที่กระทบยอดแล้วทั้งหมด" เลย ตามสเปกตรงๆ ("Don't
 * include every matched row by default if too many") mode='full' แสดงทุกแถวทุกตารางรวมถึงภาคผนวกรายการที่
 * กระทบยอดแล้วทั้งหมดด้วย */
export function buildReconcileSessionPdfBlob(
  session: ReconcileSession,
  reconcileRows: ReconcileRow[],
  matchGLRows: MatchGLRow[],
  matchGroups: MatchGroup[],
  mode: PdfReportMode,
  preparedByEmail: string,
  reportDateISO: string
): Blob {
  const kpi = computeReconcileSessionKpi(reconcileRows, matchGLRows, matchGroups);
  const unmatchedBank = reconcileRows.filter((r) => !RESOLVED_STATUSES.includes(r.status));
  const unmatchedGlIds = new Set(matchGroups.flatMap((g) => g.gl_transaction_ids));
  const unmatchedGL = matchGLRows.filter((g) => !unmatchedGlIds.has(g.gl_row_id));
  const reviewRequired = reconcileRows.filter((r) => r.reviewFlag !== null);
  const matchedRows = reconcileRows.filter((r) => RESOLVED_STATUSES.includes(r.status));

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 15;

  doc.setFontSize(16);
  doc.text('รายงานการกระทบยอดธนาคาร', 14, cursorY);
  cursorY += 8;

  doc.setFontSize(10);
  const headerLines = [
    `ชื่อรอบกระทบยอด: ${session.session_name}`,
    `ธนาคาร: ${session.bank_name ?? '-'}    เลขที่บัญชี: ${session.bank_account_no ?? '-'}`,
    `ช่วงวันที่: ${formatDateForExport(session.period_start)} - ${formatDateForExport(session.period_end)}`,
    `วันที่ออกรายงาน: ${formatDateForExport(reportDateISO)}    ผู้จัดทำ: ${preparedByEmail || '-'}`,
    `สถานะรอบ: ${RECONCILE_SESSION_STATUS_LABELS[session.status]}    รูปแบบรายงาน: ${mode === 'full' ? 'รายงานฉบับเต็ม' : 'รายงานสรุป'}`,
  ];
  for (const line of headerLines) {
    doc.text(line, 14, cursorY);
    cursorY += 5.5;
  }
  cursorY += 2;

  // KPI summary แถวเดียว 6 คอลัมน์ตามสเปกตรงๆ
  autoTable(doc, {
    startY: cursorY,
    head: [['Bank ทั้งหมด', 'กระทบยอดเรียบร้อย', 'Manual Match', 'ไม่พบใน GL', 'GL ไม่พบใน Bank', 'ผลต่างสุทธิ']],
    body: [
      [
        kpi.bank_row_count.toLocaleString('th-TH'),
        kpi.matched_count.toLocaleString('th-TH'),
        kpi.manual_match_count.toLocaleString('th-TH'),
        kpi.unmatched_bank_count.toLocaleString('th-TH'),
        kpi.unmatched_gl_count.toLocaleString('th-TH'),
        THB_NUMBER.format(kpi.net_difference),
      ],
    ],
    theme: 'grid',
    styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 9, cellPadding: 2, halign: 'center' },
    headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [47, 167, 226], textColor: 255 },
    margin: { left: 14, right: 14 },
  });
  cursorY = getLastAutoTableFinalY(doc, cursorY + 20);

  // ส่วนที่ 1: สรุปผลการกระทบยอด
  cursorY = addPageBreakIfNeeded(doc, cursorY);
  doc.setFontSize(12);
  doc.text('1. สรุปผลการกระทบยอด', 14, cursorY);
  cursorY += 4;
  autoTable(doc, {
    startY: cursorY,
    head: [['หัวข้อ', 'จำนวน/ยอดเงิน']],
    body: [
      ['จำนวนรายการ Bank', kpi.bank_row_count.toLocaleString('th-TH')],
      ['จำนวนรายการ GL', kpi.gl_row_count.toLocaleString('th-TH')],
      ['กระทบยอดแล้ว', kpi.matched_count.toLocaleString('th-TH')],
      ['ยืนยันด้วยตนเอง', kpi.manual_match_count.toLocaleString('th-TH')],
      ['ต้องตรวจสอบ', kpi.review_count.toLocaleString('th-TH')],
      ['ยอด Bank รวม', THB_NUMBER.format(kpi.bank_total)],
      ['ยอด GL รวม', THB_NUMBER.format(kpi.gl_total)],
      ['ยอด Bank ที่ยังไม่กระทบยอด', THB_NUMBER.format(kpi.unmatched_bank_total)],
      ['ยอด GL ที่ยังไม่กระทบยอด', THB_NUMBER.format(kpi.unmatched_gl_total)],
      ['ผลต่างสุทธิ', THB_NUMBER.format(kpi.net_difference)],
    ],
    theme: 'striped',
    styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 8.5, cellPadding: 1.5 },
    headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [47, 167, 226], textColor: 255 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  cursorY = getLastAutoTableFinalY(doc, cursorY + 60);

  function renderRowsTable(
    title: string,
    headers: string[],
    allRows: (string | number)[][]
  ) {
    cursorY = addPageBreakIfNeeded(doc, cursorY);
    doc.setFontSize(12);
    doc.text(title, 14, cursorY);
    cursorY += 4;
    const capped = mode === 'summary' ? allRows.slice(0, PDF_ROW_CAP_SUMMARY) : allRows;
    if (capped.length === 0) {
      doc.setFontSize(9);
      doc.text('ไม่มีรายการ', 14, cursorY + 4);
      cursorY += 10;
      return;
    }
    autoTable(doc, {
      startY: cursorY,
      head: [headers],
      body: capped,
      theme: 'grid',
      styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 7.5, cellPadding: 1.3 },
      headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [47, 167, 226], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    cursorY = getLastAutoTableFinalY(doc, cursorY + 20);
    if (mode === 'summary' && allRows.length > PDF_ROW_CAP_SUMMARY) {
      doc.setFontSize(8);
      doc.text(`และอีก ${(allRows.length - PDF_ROW_CAP_SUMMARY).toLocaleString('th-TH')} รายการ (ดูฉบับเต็มใน Export Excel หรือเลือก "รายงานฉบับเต็ม")`, 14, cursorY);
      cursorY += 8;
    }
  }

  // ส่วนที่ 2: รายการ Bank ที่ไม่พบใน GL
  renderRowsTable(
    '2. รายการ Bank ที่ไม่พบใน GL',
    ['วันที่', 'รายละเอียด', 'ยอด', 'สถานะ'],
    unmatchedBank.map((r) => [formatDateForExport(r.bank.bank_date), r.bank.bank_description || '-', THB_NUMBER.format(r.bank.bank_amount), MATCH_STATUS_LABELS[r.status]])
  );

  // ส่วนที่ 3: รายการ GL ที่ไม่พบใน Bank
  renderRowsTable(
    '3. รายการ GL ที่ไม่พบใน Bank',
    ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'ยอด'],
    unmatchedGL.map((g) => [formatDateForExport(g.gl_date), g.gl_document_no || '-', g.gl_description || '-', THB_NUMBER.format(g.gl_amount)])
  );

  // ส่วนที่ 4: รายการที่ต้องตรวจสอบ
  renderRowsTable(
    '4. รายการที่ต้องตรวจสอบ',
    ['วันที่', 'รายละเอียด', 'ยอด', 'สถานะ', 'ผู้ทำเครื่องหมาย'],
    reviewRequired.map((r) => [formatDateForExport(r.bank.bank_date), r.bank.bank_description || '-', THB_NUMBER.format(r.bank.bank_amount), MATCH_STATUS_LABELS[r.status], r.reviewFlag?.reviewed_by || '-'])
  );

  // ส่วนที่ 5: หมายเหตุการปิดรอบ
  cursorY = addPageBreakIfNeeded(doc, cursorY);
  doc.setFontSize(12);
  doc.text('5. หมายเหตุการปิดรอบ', 14, cursorY);
  cursorY += 6;
  doc.setFontSize(9);
  if (session.status === 'completed' || session.status === 'reopened') {
    doc.text(`ผู้ปิดรอบ: ${session.completed_by_email ?? '-'}    วันที่ปิดรอบ: ${session.completed_at ? formatDateTimeForExport(session.completed_at) : '-'}`, 14, cursorY);
    cursorY += 5.5;
    doc.text(`หมายเหตุ: ${session.completion_note || '-'}`, 14, cursorY);
  } else {
    doc.text('ยังไม่ปิดรอบกระทบยอดนี้', 14, cursorY);
  }
  cursorY += 10;

  // ภาคผนวก (เฉพาะ mode='full'): รายการที่กระทบยอดแล้วทั้งหมด
  if (mode === 'full') {
    renderRowsTable(
      'ภาคผนวก: รายการที่กระทบยอดแล้วทั้งหมด',
      ['วันที่ Bank', 'รายละเอียด Bank', 'ยอด Bank', 'สถานะ'],
      matchedRows.map((r) => [formatDateForExport(r.bank.bank_date), r.bank.bank_description || '-', THB_NUMBER.format(r.bank.bank_amount), MATCH_STATUS_LABELS[r.status]])
    );
  }

  void pageWidth;
  return doc.output('blob');
}
