import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildBankReconcileHistoryExcelBlob,
  buildBankReconcileHistoryPdfBlob,
  buildUnmatchedTableExcelBlob,
  summarizeBankReconcileHistoryRows,
  type BankReconcileHistoryExportRow,
  type UnmatchedTableExportRow,
} from './bankReconcileHistoryExport';

const ROWS: BankReconcileHistoryExportRow[] = [
  { date: '2026-07-01', type: 'receive', amount: 1000, glDocumentNos: ['DOC-001'] },
  { date: '2026-07-02', type: 'payment', amount: 300, glDocumentNos: ['DOC-002', 'DOC-003'] }, // จับคู่เอง N:M
  { date: '2026-07-10', type: 'receive', amount: 777, glDocumentNos: [] }, // ยังไม่จับคู่
  { date: '2026-07-11', type: 'payment', amount: 200, glDocumentNos: [] }, // ยังไม่จับคู่
];

describe('summarizeBankReconcileHistoryRows', () => {
  it('แยกยอดรวม รับ/จ่าย เป็น 3 ระดับ (ทั้งหมด/กระทบยอดสำเร็จ/ยังไม่จับคู่) ถูกต้อง — สองอันหลังรวมกันเท่ากับอันแรกเสมอ', () => {
    const summary = summarizeBankReconcileHistoryRows(ROWS);
    expect(summary.totalReceive).toBe(1777); // 1000 + 777
    expect(summary.totalPayment).toBe(500); // 300 + 200
    expect(summary.matchedReceive).toBe(1000);
    expect(summary.matchedPayment).toBe(300);
    expect(summary.unmatchedReceive).toBe(777);
    expect(summary.unmatchedPayment).toBe(200);
    // ยืนยันว่าไม่มีแถวไหนตกหล่นไปจากผลรวม
    expect(summary.matchedReceive + summary.unmatchedReceive).toBe(summary.totalReceive);
    expect(summary.matchedPayment + summary.unmatchedPayment).toBe(summary.totalPayment);
  });

  it('รายการว่างคืนค่ายอดรวมเป็นศูนย์ทั้งหมด', () => {
    const summary = summarizeBankReconcileHistoryRows([]);
    expect(summary).toEqual({
      totalReceive: 0,
      totalPayment: 0,
      matchedReceive: 0,
      matchedPayment: 0,
      unmatchedReceive: 0,
      unmatchedPayment: 0,
    });
  });
});

describe('buildBankReconcileHistoryExcelBlob', () => {
  it('สร้างไฟล์ Excel ที่อ่านกลับมาได้ โดยมีชื่อรายงาน หัวคอลัมน์ ข้อมูล และแถวสรุปยอดรวม 3 ระดับครบ', async () => {
    const summary = summarizeBankReconcileHistoryRows(ROWS);
    const blob = buildBankReconcileHistoryExcelBlob(ROWS, summary, 'กระทบยอดเดือนกรกฎาคม 2569');
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(String(aoa[0][0])).toContain('ประวัติการกระทบยอด');
    expect(String(aoa[0][0])).toContain('กระทบยอดเดือนกรกฎาคม 2569');

    expect(aoa[2]).toEqual(['วันที่', 'รับ', 'จ่าย', 'จับคู่กับ GL เลขที่', 'สถานะ']);

    // แถวข้อมูล — แถวจับคู่เอง N:M ต้องรวมเลขที่เอกสารทั้งสองด้วยจุลภาค
    expect(aoa[3][1]).toBe(1000); // รับ
    expect(aoa[3][3]).toBe('DOC-001');
    expect(aoa[3][4]).toBe('จับคู่สำเร็จ');
    expect(aoa[4][2]).toBe(300); // จ่าย
    expect(aoa[4][3]).toBe('DOC-002, DOC-003');
    expect(aoa[5][3]).toBe('-'); // ยังไม่จับคู่ ไม่มีเลขที่เอกสาร
    expect(aoa[5][4]).toBe('ยังไม่จับคู่');

    // แถวสรุปยอดรวม 3 ระดับท้ายไฟล์
    const rowsText = aoa.map((r) => r.join('|'));
    expect(rowsText.some((r) => r.includes('Bank Statement (ทั้งหมด)') && r.includes('1777') && r.includes('500'))).toBe(
      true
    );
    expect(rowsText.some((r) => r.includes('กระทบยอดสำเร็จ') && r.includes('1000') && r.includes('300'))).toBe(true);
    expect(rowsText.some((r) => r.includes('ยังไม่จับคู่') && r.includes('777') && r.includes('200'))).toBe(true);
  });

  it('รายการว่างยังสร้างไฟล์ได้โดยไม่ error', () => {
    const summary = summarizeBankReconcileHistoryRows([]);
    const blob = buildBankReconcileHistoryExcelBlob([], summary, 'ทั้งปี 2569');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildBankReconcileHistoryPdfBlob', () => {
  it('สร้างไฟล์ PDF ได้โดยไม่ error และคืนค่าเป็น Blob ที่มีขนาดมากกว่า 0', () => {
    const summary = summarizeBankReconcileHistoryRows(ROWS);
    const blob = buildBankReconcileHistoryPdfBlob(ROWS, summary, 'กระทบยอดเดือนกรกฎาคม 2569');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('รายการว่างยังสร้างไฟล์ PDF ได้โดยไม่ error', () => {
    const summary = summarizeBankReconcileHistoryRows([]);
    const blob = buildBankReconcileHistoryPdfBlob([], summary, 'ทั้งปี 2569');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildUnmatchedTableExcelBlob', () => {
  const UNMATCHED_ROWS: UnmatchedTableExportRow[] = [
    { date: '2026-07-01', type: 'receive', amount: 1000 },
    { date: '2026-07-10', type: 'receive', amount: 300 },
    { date: '2026-07-02', type: 'payment', amount: 500 },
  ];

  it('ไม่มีคอลัมน์เลขที่เอกสาร เมื่อ showDocumentNo=false (เช่น "Bank Statement ไม่สำเร็จ") — ยอดรวมต้องมาจากแถวในไฟล์เท่านั้น', async () => {
    const totals = { totalReceive: 1300, totalPayment: 500 }; // 1000+300 รับ, 500 จ่าย — ตรงกับ UNMATCHED_ROWS ข้างบนเป๊ะ
    const blob = buildUnmatchedTableExcelBlob(UNMATCHED_ROWS, totals, 'Bank Statement ไม่สำเร็จ', false);
    expect(blob.size).toBeGreaterThan(0);

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(String(aoa[0][0])).toBe('Bank Statement ไม่สำเร็จ');
    expect(aoa[2]).toEqual(['วันที่', 'รับ', 'จ่าย', 'สถานะ']);
    expect(aoa[3]).toEqual(['01/07/2026', 1000, '', 'ยังไม่จับคู่']);
    expect(aoa[4]).toEqual(['10/07/2026', 300, '', 'ยังไม่จับคู่']);
    expect(aoa[5]).toEqual(['02/07/2026', '', 500, 'ยังไม่จับคู่']);

    // แถวสรุปยอดรวมท้ายไฟล์ — คำนวณจากผลรวมของ 3 แถวข้อมูลข้างบนเป๊ะ (1000+300=1300 รับ, 500 จ่าย) ไม่ใช่
    // ตัวเลขจากที่อื่น (ยืนยันตามที่ผู้ใช้ระบุว่า "ผลรวมจะต้องมาจากในตารางเท่านั้น")
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow[0]).toContain('3 รายการ');
    expect(lastRow[1]).toBe(1300);
    expect(lastRow[2]).toBe(500);
  });

  it('มีคอลัมน์เลขที่เอกสาร เมื่อ showDocumentNo=true (เช่น "GL ไม่สำเร็จ")', async () => {
    const rows: UnmatchedTableExportRow[] = [{ date: '2026-07-20', type: 'payment', amount: 900, documentNo: 'DOC-003' }];
    const totals = { totalReceive: 0, totalPayment: 900 };
    const blob = buildUnmatchedTableExcelBlob(rows, totals, 'GL ไม่สำเร็จ', true);

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(aoa[2]).toEqual(['วันที่', 'เลขที่เอกสาร', 'รับ', 'จ่าย', 'สถานะ']);
    expect(aoa[3]).toEqual(['20/07/2026', 'DOC-003', '', 900, 'ยังไม่จับคู่']);
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow[0]).toContain('1 รายการ');
    expect(lastRow[2]).toBe(0);
    expect(lastRow[3]).toBe(900);
  });

  it('ตารางว่างยังสร้างไฟล์ได้โดยไม่ error พร้อมยอดรวมเป็นศูนย์', async () => {
    const blob = buildUnmatchedTableExcelBlob([], { totalReceive: 0, totalPayment: 0 }, 'Bank Statement ไม่สำเร็จ', false);
    expect(blob.size).toBeGreaterThan(0);

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow[0]).toContain('0 รายการ');
    expect(lastRow[1]).toBe(0);
    expect(lastRow[2]).toBe(0);
  });

  it('มีคอลัมน์คำอธิบาย ต่อจากเลขที่เอกสาร เมื่อ showDescription=true (เพิ่มเข้ามา 2026-08-07)', async () => {
    const rows: UnmatchedTableExportRow[] = [
      { date: '2026-07-20', type: 'payment', amount: 900, documentNo: 'DOC-003', description: 'จ่ายค่าไฟฟ้า' },
      { date: '2026-07-21', type: 'receive', amount: 100, documentNo: 'DOC-004' }, // ไม่มีคำอธิบาย
    ];
    const totals = { totalReceive: 100, totalPayment: 900 };
    const blob = buildUnmatchedTableExcelBlob(rows, totals, 'GL ไม่สำเร็จ', true, true);

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

    expect(aoa[2]).toEqual(['วันที่', 'เลขที่เอกสาร', 'คำอธิบาย', 'รับ', 'จ่าย', 'สถานะ']);
    expect(aoa[3]).toEqual(['20/07/2026', 'DOC-003', 'จ่ายค่าไฟฟ้า', '', 900, 'ยังไม่จับคู่']);
    expect(aoa[4]).toEqual(['21/07/2026', 'DOC-004', '-', 100, '', 'ยังไม่จับคู่']);
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow[0]).toContain('2 รายการ');
    expect(lastRow[1]).toBe('');
    expect(lastRow[2]).toBe('');
    expect(lastRow[3]).toBe(100);
    expect(lastRow[4]).toBe(900);
  });
});
