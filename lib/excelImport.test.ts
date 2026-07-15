import { describe, expect, it } from 'vitest';
import {
  EXCEL_HEADERS,
  buildTemplateBlob,
  excelRowToWriteInput,
  findDuplicateRowNumbers,
  parseExcelDateCell,
  parseExcelRow,
  parseExcelRows,
  parseTaxTypeCell,
  readWorkbookRows,
} from './excelImport';
import type { PendingTaxInvoice } from '@/types/invoice';

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
      vendor_tax_id: null,
      // ไม่ได้กรอกคอลัมน์ "ประเภทภาษี" มา (row() เป็นข้อมูลแบบก่อนมีฟีเจอร์นี้) ระบบอนุมานจากยอด VAT ที่
      // ถูกเสนอ 7% อัตโนมัติ (70 > 0) ให้เป็น claimable_vat แล้วตั้งสถานะ pending ตามขั้นตอนเดิม
      tax_type: 'claimable_vat',
      status: 'pending',
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

describe('parseTaxTypeCell', () => {
  it('รับป้ายภาษาไทยตรงตัว', () => {
    expect(parseTaxTypeCell('ไม่มี VAT')).toEqual({ kind: 'value', value: 'no_vat' });
    expect(parseTaxTypeCell('มี VAT และใช้เครดิต VAT')).toEqual({ kind: 'value', value: 'claimable_vat' });
    expect(parseTaxTypeCell('มี VAT แต่ไม่ใช้เครดิต VAT')).toEqual({ kind: 'value', value: 'non_claimable_vat' });
  });

  it('รับรหัสภาษาอังกฤษ ไม่สนตัวพิมพ์เล็ก-ใหญ่', () => {
    expect(parseTaxTypeCell('no_vat')).toEqual({ kind: 'value', value: 'no_vat' });
    expect(parseTaxTypeCell('CLAIMABLE_VAT')).toEqual({ kind: 'value', value: 'claimable_vat' });
    expect(parseTaxTypeCell('Non_Claimable_Vat')).toEqual({ kind: 'value', value: 'non_claimable_vat' });
  });

  it('ค่าว่าง/ไม่ได้กรอก คืนค่า blank (ให้ระบบอนุมานต่อ ไม่ใช่ error)', () => {
    expect(parseTaxTypeCell('')).toEqual({ kind: 'blank' });
    expect(parseTaxTypeCell(undefined)).toEqual({ kind: 'blank' });
    expect(parseTaxTypeCell(null)).toEqual({ kind: 'blank' });
  });

  it('ค่าที่ไม่รู้จัก คืนค่า invalid', () => {
    expect(parseTaxTypeCell('ภาษีมูลค่าเพิ่มพิเศษ')).toEqual({ kind: 'invalid', raw: 'ภาษีมูลค่าเพิ่มพิเศษ' });
  });

  it('"มี VAT" สั้นๆ ไม่ชนกับ "มี VAT แต่ไม่ใช้เครดิต VAT" (เทียบแบบ exact match เท่านั้น)', () => {
    expect(parseTaxTypeCell('มี VAT')).toEqual({ kind: 'value', value: 'claimable_vat' });
  });
});

describe('parseExcelRow — ประเภทภาษี', () => {
  it('อ่านประเภทภาษีจากคอลัมน์ได้ตรงตัว', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.tax_type]: 'ไม่มี VAT', [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.taxTypeSource).toBe('column');
  });

  it('ระบุ "ไม่มี VAT" มาพร้อม VAT มากกว่า 0 — เตือน (ไม่ error) แล้วปรับ VAT เป็น 0 ให้อัตโนมัติ', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.tax_type]: 'ไม่มี VAT', [EXCEL_HEADERS.vat_amount]: 100 }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('คอลัมน์ประเภทภาษีว่าง/ไม่มีในไฟล์ — อนุมานจากยอด VAT หลังเสนอ 7% อัตโนมัติแล้ว (VAT > 0 → claimable_vat)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.taxTypeSource).toBe('inferred');
  });

  it('คอลัมน์ประเภทภาษีว่าง และ VAT ระบุเป็น 0 ชัดเจน — อนุมานเป็น no_vat', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 0 }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.taxTypeSource).toBe('inferred');
  });

  it('ระบุ "มี VAT และใช้เครดิต VAT" มาพร้อม VAT เป็น 0 — เตือน (ไม่ error) แต่ยังคงเป็น claimable_vat', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.tax_type]: 'มี VAT และใช้เครดิต VAT', [EXCEL_HEADERS.vat_amount]: 0 }),
      2
    )!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('ระบุ "มี VAT แต่ไม่ใช้เครดิต VAT" — ไม่เตือนแม้ VAT เป็น 0 (ไม่บังคับต้องมี VAT)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.tax_type]: 'มี VAT แต่ไม่ใช้เครดิต VAT', [EXCEL_HEADERS.vat_amount]: 0 }),
      2
    )!;
    expect(result.tax_type).toBe('non_claimable_vat');
    expect(result.warnings).toEqual([]);
  });

  it('ค่าประเภทภาษีที่ไม่รู้จัก — error และ tax_type ยังไม่ถูกกำหนด', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.tax_type]: 'ภาษีมั่วๆ' }), 2)!;
    expect(result.tax_type).toBe('');
    expect(result.errors.some((e) => e.includes('ประเภทภาษีไม่ถูกต้อง'))).toBe(true);
  });

  it('ไม่มี VAT — ล้างวันที่คาดว่าจะได้รับแม้จะกรอกมาในไฟล์ (ไม่มีขั้นตอนรอ)', () => {
    const result = parseExcelRow(
      row({
        [EXCEL_HEADERS.tax_type]: 'ไม่มี VAT',
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.expected_date]: '2026-08-01',
      }),
      2
    )!;
    expect(result.expected_date).toBe('');
  });

  it('เลขประจำตัวผู้เสียภาษีไม่ครบ 13 หลัก — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_tax_id]: '123' }), 2)!;
    expect(result.errors).toContain('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
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
    const parsedRow = parseExcelRow(row(), 2)!; // vendor_name/transaction_date/reference_no ตรงกับ existing, VAT auto-suggest 70 → total 1070 ตรงกัน
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
