import { describe, expect, it } from 'vitest';
import {
  EXCEL_HEADERS,
  buildTemplateBlob,
  excelRowToWriteInput,
  parseExcelDateCell,
  parseExcelRow,
  parseExcelRows,
  readWorkbookRows,
} from './excelImport';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [EXCEL_HEADERS.vendor_name]: 'บริษัท ทดสอบ จำกัด',
    [EXCEL_HEADERS.transaction_date]: '2026-07-01',
    [EXCEL_HEADERS.description]: 'ค่าสินค้า',
    [EXCEL_HEADERS.amount_excl_vat]: 1000,
    [EXCEL_HEADERS.vat_amount]: '',
    [EXCEL_HEADERS.reference_no]: 'PO-001',
    [EXCEL_HEADERS.expected_date]: '',
    [EXCEL_HEADERS.notes]: '',
    ...overrides,
  };
}

describe('parseExcelDateCell', () => {
  it('รับ Date object และแปลงเป็น ISO', () => {
    expect(parseExcelDateCell(new Date(2026, 6, 13))).toBe('2026-07-13');
  });

  it('รับ string แบบ YYYY-MM-DD', () => {
    expect(parseExcelDateCell('2026-07-13')).toBe('2026-07-13');
  });

  it('รับ string แบบ DD/MM/YYYY', () => {
    expect(parseExcelDateCell('13/7/2026')).toBe('2026-07-13');
  });

  it('รับเลข serial ของ Excel', () => {
    // 46216 = 2026-07-13 ใน Excel serial date
    expect(parseExcelDateCell(46216)).toBe('2026-07-13');
  });

  it('คืนค่า null สำหรับค่าว่าง/ไม่ถูกต้อง', () => {
    expect(parseExcelDateCell('')).toBeNull();
    expect(parseExcelDateCell(null)).toBeNull();
    expect(parseExcelDateCell(undefined)).toBeNull();
    expect(parseExcelDateCell('ไม่ใช่วันที่')).toBeNull();
    expect(parseExcelDateCell('2026-13-99')).toBeNull();
    expect(parseExcelDateCell('35/13/2026')).toBeNull();
    expect(parseExcelDateCell('30/2/2026')).toBeNull(); // กุมภาพันธ์ไม่มีวันที่ 30
  });
});

describe('parseExcelRow', () => {
  it('แถวข้อมูลถูกต้องครบ ไม่มี error', () => {
    const result = parseExcelRow(row(), 2);
    expect(result).not.toBeNull();
    expect(result!.errors).toEqual([]);
    expect(result!.vendor_name).toBe('บริษัท ทดสอบ จำกัด');
    expect(result!.transaction_date).toBe('2026-07-01');
    expect(result!.amount_excl_vat).toBe('1000');
    expect(result!.rowNumber).toBe(2);
  });

  it('ไม่กรอก VAT — เสนอ 7% อัตโนมัติจากยอดก่อน VAT', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: '' }), 2);
    expect(result!.vat_amount).toBe('70');
    expect(result!.errors).toEqual([]);
  });

  it('กรอก VAT เองมา — ใช้ค่าที่กรอกแทนการเสนออัตโนมัติ', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 50 }), 2);
    expect(result!.vat_amount).toBe('50');
    expect(result!.errors).toEqual([]);
  });

  it('ไม่กรอกผู้ขาย — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '' }), 2);
    expect(result!.errors).toContain('ไม่ได้กรอกผู้ขาย');
  });

  it('วันที่ทำรายการว่าง — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: '' }), 2);
    expect(result!.errors).toContain('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');
  });

  it('วันที่ทำรายการรูปแบบผิด — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: 'สิบสามกรกฎา' }), 2);
    expect(result!.errors).toContain('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');
  });

  it('ยอดก่อน VAT ว่าง — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: '' }), 2);
    expect(result!.errors).toContain('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');
  });

  it('ยอดก่อน VAT เป็น 0 หรือติดลบ — error', () => {
    expect(parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 0 }), 2)!.errors).toContain(
      'ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0'
    );
    expect(parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: -5 }), 2)!.errors).toContain(
      'ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0'
    );
  });

  it('ยอดก่อน VAT เป็นตัวหนังสือ — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 'พันบาท' }), 2);
    expect(result!.errors).toContain('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');
  });

  it('ยอดก่อน VAT มี comma คั่นหลักพันก็อ่านได้ (เช่น "1,000")', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: '1,000' }), 2);
    expect(result!.amount_excl_vat).toBe('1000');
    expect(result!.errors).toEqual([]);
  });

  it('VAT ติดลบ — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: -1 }), 2);
    expect(result!.errors).toContain('VAT ไม่ถูกต้อง');
  });

  it('วันที่คาดว่าจะได้รับก่อนวันที่ทำรายการ — error', () => {
    const result = parseExcelRow(
      row({
        [EXCEL_HEADERS.transaction_date]: '2026-07-10',
        [EXCEL_HEADERS.expected_date]: '2026-07-01',
      }),
      2
    );
    expect(result!.errors).toContain('วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่ทำรายการ');
  });

  it('วันที่คาดว่าจะได้รับไม่ได้กรอก — ไม่ error (เป็น optional)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.expected_date]: '' }), 2);
    expect(result!.errors).toEqual([]);
    expect(result!.expected_date).toBe('');
  });

  it('แถวว่างทั้งแถวคืนค่า null (ข้ามได้)', () => {
    const result = parseExcelRow(row({
      [EXCEL_HEADERS.vendor_name]: '',
      [EXCEL_HEADERS.transaction_date]: '',
      [EXCEL_HEADERS.description]: '',
      [EXCEL_HEADERS.amount_excl_vat]: '',
      [EXCEL_HEADERS.vat_amount]: '',
      [EXCEL_HEADERS.reference_no]: '',
      [EXCEL_HEADERS.expected_date]: '',
      [EXCEL_HEADERS.notes]: '',
    }), 5);
    expect(result).toBeNull();
  });

  it('มีหลาย error พร้อมกันได้ในแถวเดียว', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.vendor_name]: '', [EXCEL_HEADERS.amount_excl_vat]: '' }),
      2
    );
    expect(result!.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseExcelRows', () => {
  it('ข้ามแถวว่างไปอัตโนมัติ และเลขแถวตรงกับตำแหน่งจริงในไฟล์ (แถว 1 = header)', () => {
    const emptyRow = Object.fromEntries(Object.values(EXCEL_HEADERS).map((h) => [h, '']));
    const rows = parseExcelRows([row(), emptyRow, row({ [EXCEL_HEADERS.vendor_name]: 'ผู้ขาย 2' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(4); // แถวที่ 3 (idx 1) เป็นแถวว่างถูกข้าม แถวถัดไปคือแถวที่ 4
    expect(rows[1].vendor_name).toBe('ผู้ขาย 2');
  });

  it('ไฟล์ไม่มีแถวข้อมูลเลย คืน array ว่าง', () => {
    expect(parseExcelRows([])).toEqual([]);
  });
});

describe('excelRowToWriteInput', () => {
  it('แปลงแถวที่ผ่านการตรวจสอบแล้วเป็น payload พร้อมบันทึก', () => {
    const parsed = parseExcelRow(row(), 2)!;
    const input = excelRowToWriteInput(parsed);
    expect(input).toEqual({
      vendor_name: 'บริษัท ทดสอบ จำกัด',
      transaction_date: '2026-07-01',
      description: 'ค่าสินค้า',
      amount_excl_vat: 1000,
      vat_amount: 70,
      reference_no: 'PO-001',
      expected_date: null,
      notes: null,
    });
  });

  it('ฟิลด์ optional ที่เป็นค่าว่างแปลงเป็น null', () => {
    const parsed = parseExcelRow(
      row({ [EXCEL_HEADERS.description]: '', [EXCEL_HEADERS.reference_no]: '', [EXCEL_HEADERS.notes]: '' }),
      2
    )!;
    const input = excelRowToWriteInput(parsed);
    expect(input.description).toBeNull();
    expect(input.reference_no).toBeNull();
    expect(input.notes).toBeNull();
  });
});

describe('buildTemplateBlob + readWorkbookRows (round-trip)', () => {
  it('เทมเพลตที่สร้างขึ้นอ่านกลับมาได้ และแถวตัวอย่างผ่านการตรวจสอบ', async () => {
    const blob = buildTemplateBlob();
    expect(blob.size).toBeGreaterThan(0);
    const arrayBuffer = await blob.arrayBuffer();
    const rawRows = readWorkbookRows(arrayBuffer);
    expect(rawRows.length).toBeGreaterThanOrEqual(1);
    const parsed = parseExcelRows(rawRows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].errors).toEqual([]);
    expect(parsed[0].vendor_name).toBe('บริษัท ตัวอย่าง จำกัด');
  });
});
