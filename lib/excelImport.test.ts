import { describe, expect, it } from 'vitest';
import {
  EXCEL_HEADERS,
  buildTemplateBlob,
  excelRowToWriteInput,
  findDuplicateRowNumbers,
  parseExcelDateCell,
  parseExcelRow,
  parseExcelRows,
  parseVatCell,
  readWorkbookRows,
} from './excelImport';
import type { PendingTaxInvoice } from '@/types/invoice';

// หมายเหตุ: vat_amount default เป็น 70 (ไม่ใช่ค่าว่าง) โดยตั้งใจ — ตั้งแต่ฟีเจอร์ตรวจจับ VAT
// อัตโนมัติ (2026-07-15) ค่าว่างมีความหมายพิเศษ (= "ไม่มี VAT" โดยตรง ไม่ใช่แค่ "ลืมกรอก" อีกต่อไป)
// เทสต์ที่ต้องการทดสอบกรณี VAT ว่าง/0/"-" โดยเฉพาะจะ override ค่านี้เอง (ดู describe จำแนกประเภทภาษี)
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [EXCEL_HEADERS.vendor_name]: 'บริษัท ทดสอบ จำกัด',
    [EXCEL_HEADERS.transaction_date]: '2026-07-01',
    [EXCEL_HEADERS.description]: 'ค่าสินค้า',
    [EXCEL_HEADERS.amount_excl_vat]: 1000,
    [EXCEL_HEADERS.vat_amount]: 70,
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

describe('parseVatCell', () => {
  it('ตัวเลขปกติ เช่น 7 → ok amount 7', () => {
    expect(parseVatCell(7)).toEqual({ kind: 'ok', amount: 7 });
    expect(parseVatCell(70)).toEqual({ kind: 'ok', amount: 70 });
    expect(parseVatCell(140)).toEqual({ kind: 'ok', amount: 140 });
  });

  it('0 หรือ "0.00" → ok amount 0', () => {
    expect(parseVatCell(0)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell('0.00')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('ค่าว่าง/ไม่มีค่า/ข้อความมีแต่ช่องว่าง → ok amount 0 (ไม่ error)', () => {
    expect(parseVatCell('')).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell(undefined)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell(null)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell('   ')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('เครื่องหมาย "-" → ok amount 0', () => {
    expect(parseVatCell('-')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('ตัวเลขที่มี comma คั่นหลักพัน เช่น "1,400.00" → อ่านเป็น 1400', () => {
    expect(parseVatCell('1,400.00')).toEqual({ kind: 'ok', amount: 1400 });
    expect(parseVatCell('1,400')).toEqual({ kind: 'ok', amount: 1400 });
  });

  it('ข้อความที่ไม่ใช่ตัวเลขเลย เช่น "abc" → invalid', () => {
    expect(parseVatCell('abc')).toEqual({ kind: 'invalid', raw: 'abc' });
  });

  it('ตัวเลขปนตัวอักษร เช่น "12abc" → invalid (ไม่ปัดเป็น 12 เงียบๆ)', () => {
    expect(parseVatCell('12abc')).toEqual({ kind: 'invalid', raw: '12abc' });
  });

  it('ตัวเลขติดลบ → invalid (VAT ติดลบไม่สมเหตุสมผล)', () => {
    expect(parseVatCell(-5)).toEqual({ kind: 'invalid', raw: '-5' });
    expect(parseVatCell('-5')).toEqual({ kind: 'invalid', raw: '-5' });
  });

  it('ไม่มีทางคืนค่า NaN ไม่ว่าอินพุตจะเป็นอะไร', () => {
    const values: unknown[] = [7, 0, '', '-', '1,400.00', 'abc', null, undefined, -5, '   ', 'NaN'];
    for (const v of values) {
      const result = parseVatCell(v);
      if (result.kind === 'ok') expect(Number.isNaN(result.amount)).toBe(false);
    }
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

  it('อ่านค่า VAT ที่กรอกมาตรงๆ ได้ถูกต้อง', () => {
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
    expect(result!.errors.some((e) => e.includes('VAT ไม่ถูกต้อง'))).toBe(true);
  });

  it('วันที่คาดว่าจะได้รับก่อนวันที่ทำรายการ — error (แถวนี้มี VAT จึงมีขั้นตอนรอ/มีความหมายของวันที่นี้)', () => {
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
    const result = parseExcelRow(
      row({
        [EXCEL_HEADERS.vendor_name]: '',
        [EXCEL_HEADERS.transaction_date]: '',
        [EXCEL_HEADERS.description]: '',
        [EXCEL_HEADERS.amount_excl_vat]: '',
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.reference_no]: '',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      }),
      5
    );
    expect(result).toBeNull();
  });

  it('มีหลาย error พร้อมกันได้ในแถวเดียว', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '', [EXCEL_HEADERS.amount_excl_vat]: '' }), 2);
    expect(result!.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('เลขประจำตัวผู้เสียภาษีไม่ครบ 13 หลัก — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_tax_id]: '123' }), 2)!;
    expect(result.errors).toContain('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  });
});

// เทสต์ตาม checklist 10 ข้อที่ผู้ใช้ระบุไว้ (ครอบคลุมข้อ 1-4, 6-8 โดยตรง — ข้อ 5 อยู่ใน describe
// parseVatCell ด้านบน ข้อ 9 อยู่ใน lib/vatReportLogic.test.ts ข้อ 10 ตรวจใน e2e)
describe('parseExcelRow — จำแนกประเภทภาษีจากยอด VAT อัตโนมัติ (ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไป)', () => {
  it('1. VAT = 7 (มากกว่า 0) → ตรวจพบเป็น "มี VAT" (claimable_vat)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 7 }), 2)!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.vat_amount).toBe('7');
    expect(result.errors).toEqual([]);
  });

  it('2. VAT = 0 → ตรวจพบเป็น "ไม่มี VAT" (no_vat)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 0 }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('3. VAT ว่าง → ตรวจพบเป็น "ไม่มี VAT" (ก่อนหน้านี้จะเสนอ 7% อัตโนมัติให้ — เปลี่ยนพฤติกรรมตามที่ระบุ)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('4. VAT = "-" → ตรวจพบเป็น "ไม่มี VAT"', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '-' }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('6. VAT เป็นข้อความผิด เช่น "abc" → error ห้าม import แถวนั้นจนกว่าจะแก้ไข', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 'abc' }), 2)!;
    expect(result.errors.some((e) => e.includes('VAT ไม่ถูกต้อง'))).toBe(true);
    expect(result.tax_type).toBe(''); // ยังจำแนกไม่ได้ — สอดคล้องกับ error ที่ยังค้างอยู่
  });

  it('7. รายการไม่มี VAT ต้องไม่มีขั้นตอนรอใบกำกับภาษี — ล้างวันที่คาดว่าจะได้รับแม้จะกรอกมาในไฟล์', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.vat_amount]: '', [EXCEL_HEADERS.expected_date]: '2026-08-01' }),
      2
    )!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.expected_date).toBe('');
  });

  it('8. รายการมี VAT ต้องเข้าขั้นตอนรอใบกำกับภาษีได้ตามปกติ (ไม่ล้างวันที่คาดว่าจะได้รับ)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.expected_date]: '2026-08-01' }),
      2
    )!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.expected_date).toBe('2026-08-01');
  });

  it('เศษสตางค์ก็จำแนกเป็น "มี VAT" ได้ถูกต้อง (VAT น้อยแค่ไหนก็ยังถือว่า > 0)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 0.01 }), 2)!;
    expect(result.tax_type).toBe('claimable_vat');
  });
});

describe('parseExcelRow — ตรวจสอบยอดรวมเทียบกับที่คำนวณได้ (เตือนเท่านั้น ไม่เขียนทับ/ไม่ error)', () => {
  it('ยอดรวมในไฟล์ตรงกับที่คำนวณได้ (ยอดก่อน VAT + VAT) — ไม่มีคำเตือน', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 1070 }),
      2
    )!;
    expect(result.warnings).toEqual([]);
  });

  it('ยอดรวมในไฟล์ไม่ตรงกับที่คำนวณได้ — เตือน แต่ไม่ error และไม่บล็อกการนำเข้า', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 9999 }),
      2
    )!;
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('ยอดรวม'))).toBe(true);
  });

  it('ไม่กรอกยอดรวมมาเลย — ไม่มีคำเตือน (ไม่บังคับกรอก เพราะเป็นคอลัมน์คำนวณอัตโนมัติอยู่แล้ว)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: '' }),
      2
    )!;
    expect(result.warnings).toEqual([]);
  });

  it('ไม่เตือนถ้ายอดก่อน VAT หรือ VAT เองมี error อยู่แล้ว (ผลรวมที่จะเทียบไม่น่าเชื่อถืออยู่ดี)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: '', [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 9999 }),
      2
    )!;
    expect(result.warnings).toEqual([]);
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
  it('แถวมี VAT แปลงเป็น payload พร้อมบันทึก — สถานะ pending (รอรับใบกำกับภาษี) ตามขั้นตอนเดิม', () => {
    const parsed = parseExcelRow(row(), 2)!; // row() default VAT=70 > 0 → มี VAT
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
      vendor_tax_id: null,
      tax_type: 'claimable_vat',
      status: 'pending',
    });
  });

  it('แถวไม่มี VAT (VAT ว่าง) แปลงเป็น payload สถานะ received ทันที ไม่มีขั้นตอนรอ', () => {
    const parsed = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    const input = excelRowToWriteInput(parsed);
    expect(input.tax_type).toBe('no_vat');
    expect(input.vat_amount).toBe(0);
    expect(input.expected_date).toBeNull();
    expect(input.status).toBe('received');
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
  it('เทมเพลตที่สร้างขึ้นอ่านกลับมาได้ และแถวตัวอย่างทั้งสองแถว (มี VAT / ไม่มี VAT) ผ่านการตรวจสอบ', async () => {
    const blob = buildTemplateBlob();
    expect(blob.size).toBeGreaterThan(0);
    const arrayBuffer = await blob.arrayBuffer();
    const rawRows = readWorkbookRows(arrayBuffer);
    expect(rawRows.length).toBeGreaterThanOrEqual(2);
    const parsed = parseExcelRows(rawRows);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((r) => r.errors.length === 0)).toBe(true);
    expect(parsed[0].vendor_name).toBe('บริษัท ตัวอย่าง จำกัด');
    expect(parsed[0].tax_type).toBe('claimable_vat'); // ตัวอย่างแถวแรก: กรอก VAT มา → มี VAT
    expect(parsed[1].vendor_name).toBe('ร้านค้า ตัวอย่าง 2');
    expect(parsed[1].tax_type).toBe('no_vat'); // ตัวอย่างแถวสอง: เว้นว่างช่อง VAT → ไม่มี VAT
  });
});

describe('findDuplicateRowNumbers', () => {
  function makeExistingInvoice(overrides: Partial<PendingTaxInvoice> = {}): PendingTaxInvoice {
    return {
      id: overrides.id ?? Math.random().toString(36).slice(2),
      vendor_name: 'บริษัท ทดสอบ จำกัด',
      transaction_date: '2026-07-01',
      description: null,
      amount_excl_vat: 1000,
      vat_amount: 70,
      total_amount: 1070,
      reference_no: 'PO-001',
      expected_date: null,
      status: 'pending',
      received_date: null,
      tax_invoice_number: null,
      notes: null,
      created_by: null,
      created_by_email: null,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      vendor_tax_id: null,
      tax_invoice_date: null,
      vat_claim_month: null,
      vat_claim_year: null,
      tax_type: 'claimable_vat',
      ...overrides,
    };
  }

  it('ตรวจพบรายการซ้ำเมื่อผู้ขาย/วันที่/เลขที่อ้างอิง/ยอดรวมตรงกันทั้งหมด', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row(), 2)!; // vendor_name/transaction_date/reference_no ตรงกับ existing, VAT=70 (row() default) → total 1070 ตรงกัน
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(true);
  });

  it('ไม่ตรวจพบซ้ำถ้ายอดรวมต่างกัน', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 2000 }), 2)!;
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ไม่ตรวจพบซ้ำถ้าเลขที่อ้างอิงต่างกัน', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.reference_no]: 'PO-999' }), 2)!;
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ข้ามแถวที่มี error อยู่แล้ว ไม่ตรวจสอบซ้ำ', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '' }), 2)!; // error: ไม่ได้กรอกผู้ขาย
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ไม่มีรายการเดิมในระบบเลย — ไม่มีอะไรถูกตีว่าซ้ำ', () => {
    const parsedRow = parseExcelRow(row(), 2)!;
    expect(findDuplicateRowNumbers([parsedRow], [])).toEqual(new Set());
  });
});
