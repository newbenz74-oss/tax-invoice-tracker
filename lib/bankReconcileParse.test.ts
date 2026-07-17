import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBankFile, parseBankRows, parseGLFile, parseGLRows } from './bankReconcileParse';

function makeExcelFile(rows: Record<string, unknown>[], fileName = 'test.xlsx'): File {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([arrayBuffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeCsvFile(csvText: string, fileName = 'test.csv'): File {
  return new File([csvText], fileName, { type: 'text/csv' });
}

describe('parseBankRows — การหาคอลัมน์อัตโนมัติ', () => {
  it('รู้จักหัวคอลัมน์ภาษาไทย (วันที่ / รับ / จ่าย)', () => {
    const result = parseBankRows([{ วันที่: '01/07/2026', รับ: 1000, จ่าย: '' }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', type: 'receive', amount: 1000 });
  });

  it('รู้จักหัวคอลัมน์ภาษาอังกฤษ (Date / Receive / Payment)', () => {
    const result = parseBankRows([{ Date: '2026-07-02', Receive: '', Payment: 500 }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-02', type: 'payment', amount: 500 });
  });

  it('ทนต่อความแตกต่างของช่องว่าง/ตัวพิมพ์เล็กใหญ่/เครื่องหมายจุดในหัวคอลัมน์', () => {
    const result = parseBankRows([{ ' transaction date ': '2026-07-03', ' Deposit ': 200, Withdraw: '' }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-03', type: 'receive', amount: 200 });
  });

  it('คืนค่า error ระดับไฟล์เมื่อหาคอลัมน์ที่จำเป็นไม่เจอ', () => {
    const result = parseBankRows([{ Foo: 'bar', Baz: 123 }]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('วันที่');
  });

  it('คืนค่า error เมื่อไฟล์ไม่มีแถวข้อมูลเลย', () => {
    const result = parseBankRows([]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('ข้ามแถวที่มีทั้งรับและจ่ายพร้อมกัน พร้อม warning', () => {
    const result = parseBankRows([{ วันที่: '2026-07-01', รับ: 100, จ่าย: 200 }]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBe(1);
  });

  it('ข้ามแถวที่วันที่ไม่ถูกต้อง พร้อม warning', () => {
    const result = parseBankRows([{ วันที่: 'ไม่ใช่วันที่', รับ: 100, จ่าย: '' }]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBe(1);
  });

  it('ข้ามแถวว่างทั้งแถวแบบเงียบๆ ไม่มี warning', () => {
    const result = parseBankRows([
      { วันที่: '2026-07-01', รับ: 100, จ่าย: '' },
      { วันที่: '', รับ: '', จ่าย: '' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('ข้ามแถวที่ไม่มีทั้งรับและจ่าย (ทั้งคู่ว่างหรือ 0) แบบเงียบๆ', () => {
    const result = parseBankRows([{ วันที่: '2026-07-01', รับ: 0, จ่าย: 0 }]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('รองรับรูปแบบวันที่ DD/MM/YYYY', () => {
    const result = parseBankRows([{ วันที่: '15/07/2026', รับ: 500, จ่าย: '' }]);
    expect(result.rows[0].date).toBe('2026-07-15');
  });

  it('รองรับจำนวนเงินที่มี comma คั่นหลักพัน', () => {
    const result = parseBankRows([{ วันที่: '2026-07-01', รับ: '1,234.56', จ่าย: '' }]);
    expect(result.rows[0].amount).toBe(1234.56);
  });
});

describe('parseGLRows — เพิ่มเติมเรื่องเลขที่เอกสาร', () => {
  it('อ่านเลขที่เอกสารได้เมื่อมีคอลัมน์ที่ตรงกับ alias', () => {
    const result = parseGLRows([{ 'เลขที่เอกสาร': 'DOC-001', วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ documentNo: 'DOC-001', type: 'receive', amount: 1000 });
  });

  it('คืนค่า error เมื่อไม่พบคอลัมน์เลขที่เอกสาร (บังคับสำหรับ GL เท่านั้น)', () => {
    const result = parseGLRows([{ วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain('เลขที่เอกสาร');
  });
});

describe('parseBankFile / parseGLFile — อ่านไฟล์จริง (Excel / CSV)', () => {
  it('อ่านไฟล์ .xlsx ได้ถูกต้อง', async () => {
    const file = makeExcelFile([
      { วันที่: '2026-07-01', รับ: 1000, จ่าย: '' },
      { วันที่: '2026-07-02', รับ: '', จ่าย: 200 },
    ]);
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
  });

  it('อ่านไฟล์ .csv ได้ถูกต้อง', async () => {
    const csv = 'วันที่,รับ,จ่าย\n2026-07-01,1000,\n2026-07-02,,200\n';
    const file = makeCsvFile(csv);
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', type: 'receive', amount: 1000 });
  });

  it('อ่านไฟล์ GL แบบ .csv พร้อมเลขที่เอกสารได้ถูกต้อง', async () => {
    const csv = 'Document No,Date,Receive,Payment\nDOC-100,2026-07-01,1000,\nDOC-101,2026-07-02,,200\n';
    const file = makeCsvFile(csv, 'gl.csv');
    const result = await parseGLFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].documentNo).toBe('DOC-100');
  });

  it('คืนค่า error แบบ graceful เมื่อไฟล์เสียหาย/อ่านไม่ออก ไม่ throw ออกไปนอกฟังก์ชัน', async () => {
    const file = new File(['not a real excel file at all'], 'broken.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const result = await parseBankFile(file);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
