import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { detectSourceFileType, getFileExtension, parseFileToRawTable } from './bankReconcileParse';
import { isAcceptedBankReconcileFileType } from './bankReconcileValidation';
import { parseDateCell } from './bankReconcileNormalize';

function buildXlsxFile(rows: unknown[][], fileName = 'test.xlsx'): File {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([arrayBuffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function buildCsvFile(content: string, fileName = 'test.csv'): File {
  return new File([content], fileName, { type: 'text/csv' });
}

describe('getFileExtension', () => {
  it('อ่านนามสกุลไฟล์ได้ถูกต้อง ไม่สนตัวพิมพ์เล็ก/ใหญ่', () => {
    expect(getFileExtension('statement.XLSX')).toBe('.xlsx');
    expect(getFileExtension('data.csv')).toBe('.csv');
    expect(getFileExtension('report.Xls')).toBe('.xls');
  });

  it('ไฟล์ไม่มีนามสกุล คืนค่าว่าง', () => {
    expect(getFileExtension('noextension')).toBe('');
  });

  it('ไฟล์ชื่อมีจุดหลายจุด ใช้นามสกุลตัวสุดท้ายเท่านั้น', () => {
    expect(getFileExtension('bank.statement.july.csv')).toBe('.csv');
  });
});

describe('detectSourceFileType', () => {
  it('แยกประเภทไฟล์จากนามสกุลได้ถูกต้องครบทั้ง 3 ประเภท (excel/csv/pdf) — ใช้ตัดสินใจว่าจะเรียก parser ตัวไหน', () => {
    expect(detectSourceFileType('statement.xlsx')).toBe('excel');
    expect(detectSourceFileType('statement.xls')).toBe('excel');
    expect(detectSourceFileType('statement.csv')).toBe('csv');
    expect(detectSourceFileType('statement.pdf')).toBe('pdf');
  });

  it('ไม่สนตัวพิมพ์เล็ก/ใหญ่ของนามสกุล', () => {
    expect(detectSourceFileType('STATEMENT.XLSX')).toBe('excel');
    expect(detectSourceFileType('STATEMENT.PDF')).toBe('pdf');
  });

  it('นามสกุลที่ไม่รองรับ = null (ให้ชั้นตรวจสอบไฟล์ตัดสินใจแจ้งเตือนเอง)', () => {
    expect(detectSourceFileType('statement.docx')).toBeNull();
    expect(detectSourceFileType('statement')).toBeNull();
  });
});

describe('isAcceptedBankReconcileFileType', () => {
  it('ยอมรับ .xlsx / .xls / .csv / .pdf (ไม่สนตัวพิมพ์เล็ก/ใหญ่) — .pdf เพิ่มเข้ามาตามสเปก rebuild ส่วน "9. SUPPORTED FILES"', () => {
    expect(isAcceptedBankReconcileFileType('a.xlsx')).toBe(true);
    expect(isAcceptedBankReconcileFileType('a.xls')).toBe(true);
    expect(isAcceptedBankReconcileFileType('a.csv')).toBe(true);
    expect(isAcceptedBankReconcileFileType('A.CSV')).toBe(true);
    expect(isAcceptedBankReconcileFileType('a.pdf')).toBe(true);
    expect(isAcceptedBankReconcileFileType('A.PDF')).toBe(true);
  });

  it('ปฏิเสธนามสกุลอื่นๆ ทั้งหมด', () => {
    expect(isAcceptedBankReconcileFileType('a.txt')).toBe(false);
    expect(isAcceptedBankReconcileFileType('a.docx')).toBe(false);
    expect(isAcceptedBankReconcileFileType('a')).toBe(false);
  });
});

describe('parseFileToRawTable', () => {
  it('อ่านไฟล์ .xlsx เป็นตาราง array-of-arrays ถูกต้อง (แถวแรก = header ดิบตามไฟล์จริง)', async () => {
    const file = buildXlsxFile([
      ['วันที่', 'รายละเอียด', 'จำนวนเงิน'],
      ['16/07/2026', 'ค่าสินค้า', 1000],
      ['17/07/2026', 'ค่าบริการ', 2000],
    ]);
    const table = await parseFileToRawTable(file);
    expect(table.headers).toEqual(['วันที่', 'รายละเอียด', 'จำนวนเงิน']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(['16/07/2026', 'ค่าสินค้า', 1000]);
    expect(table.rows[1]).toEqual(['17/07/2026', 'ค่าบริการ', 2000]);
  });

  it('อ่านไฟล์ .csv เป็นตาราง array-of-arrays ถูกต้อง', async () => {
    const file = buildCsvFile('Date,Description,Amount\n2026-07-16,Payment A,1500\n2026-07-17,Payment B,2500');
    const table = await parseFileToRawTable(file);
    expect(table.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(table.rows).toHaveLength(2);
    // หมายเหตุสำคัญ: SheetJS วิเคราะห์ประเภทข้อมูลจากข้อความ CSV ให้อัตโนมัติ (date sniffing) — ข้อความ
    // ที่หน้าตาเหมือนวันที่ ("2026-07-16") จะถูกแปลงเป็นเลข serial ของ Excel ไม่ใช่ string ดิบๆ เหมือนที่
    // อาจคาดไว้ ซึ่งไม่ใช่ปัญหาเพราะ parseDateCell ใน lib/bankReconcileNormalize.ts รองรับทั้งเลข serial
    // และ string อยู่แล้ว (ดู bankReconcileNormalize.test.ts) — เทสต์นี้ยืนยัน pipeline ปลายทางถูกต้อง
    expect(typeof table.rows[0][0]).toBe('number');
    expect(parseDateCell(table.rows[0][0])).toBe('2026-07-16');
    expect(table.rows[0][1]).toBe('Payment A');
    expect(table.rows[0][2]).toBe(1500);
  });

  it('หัวคอลัมน์ที่เป็นค่าว่าง/ตัวเลขถูกแปลงเป็น string เสมอ', async () => {
    const file = buildXlsxFile([
      ['', 'Col2', 123],
      ['a', 'b', 'c'],
    ]);
    const table = await parseFileToRawTable(file);
    expect(table.headers).toEqual(['', 'Col2', '123']);
  });

  it('ไฟล์ที่ไม่มีข้อมูลใดๆ เลย (แม้แต่แถวหัวคอลัมน์) คืน headers/rows ว่างเปล่าทั้งคู่', async () => {
    const file = buildXlsxFile([]);
    const table = await parseFileToRawTable(file);
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  it('ไฟล์ .xlsx ที่มี zip signature นำหน้าแต่โครงสร้างภายในเสียหายจริงๆ — โยน error ออกไปให้ผู้เรียก (BankReconcileUploadCard) จัดการเป็นข้อความแจ้งเตือน', async () => {
    // 0x50 0x4B 0x03 0x04 คือ magic bytes ของไฟล์ zip (.xlsx คือไฟล์ zip ภายใน) ตามด้วยขยะที่ไม่ใช่
    // โครงสร้าง zip จริง — SheetJS จะพยายามแตกไฟล์ zip แล้วล้มเหลว โยน error ออกมาจริง (ต่างจากการยัด
    // ข้อความธรรมดาเข้าไปเฉยๆ ซึ่ง SheetJS จะพยายาม parse เป็นข้อมูล delimited text แบบ best-effort แทน
    // การโยน error — กรณีนั้นจึงต้องกันด้วย validateParsedTable ที่ชั้นถัดไป ไม่ใช่หน้าที่ของ parse โดยตรง)
    const corruptedZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const file = new File([corruptedZipBytes], 'broken.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await expect(parseFileToRawTable(file)).rejects.toThrow();
  });
});
