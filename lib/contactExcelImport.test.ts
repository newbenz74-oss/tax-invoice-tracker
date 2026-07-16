import { describe, expect, it } from 'vitest';
import {
  CONTACT_EXCEL_HEADERS,
  annotateDuplicateCodeErrors,
  buildContactTemplateBlob,
  contactRowToWriteInput,
  findDuplicateCodesInFile,
  findDuplicateCodesVsExisting,
  parseContactRow,
  parseContactRows,
  readContactWorkbookRows,
} from './contactExcelImport';
import type { BusinessPartner } from '@/types/contact';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [CONTACT_EXCEL_HEADERS.partner_type]: 'ลูกค้า',
    [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001',
    [CONTACT_EXCEL_HEADERS.entity_type]: 'นิติบุคคล',
    [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท ทดสอบ จำกัด',
    [CONTACT_EXCEL_HEADERS.first_name]: '',
    [CONTACT_EXCEL_HEADERS.last_name]: '',
    [CONTACT_EXCEL_HEADERS.tax_id]: '',
    [CONTACT_EXCEL_HEADERS.branch_type]: 'สำนักงานใหญ่',
    [CONTACT_EXCEL_HEADERS.branch_number]: '',
    [CONTACT_EXCEL_HEADERS.address]: '',
    [CONTACT_EXCEL_HEADERS.subdistrict]: '',
    [CONTACT_EXCEL_HEADERS.district]: '',
    [CONTACT_EXCEL_HEADERS.province]: '',
    [CONTACT_EXCEL_HEADERS.postal_code]: '',
    [CONTACT_EXCEL_HEADERS.phone]: '',
    [CONTACT_EXCEL_HEADERS.email]: '',
    [CONTACT_EXCEL_HEADERS.contact_person]: '',
    [CONTACT_EXCEL_HEADERS.note]: '',
    [CONTACT_EXCEL_HEADERS.status]: 'เปิดใช้งาน',
    ...overrides,
  };
}

function makeContact(overrides: Partial<BusinessPartner> = {}): BusinessPartner {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    partner_type: 'customer',
    contact_code: 'CUS0099',
    entity_type: 'company',
    company_name: 'บริษัท เดิม จำกัด',
    first_name: null,
    last_name: null,
    tax_id: null,
    branch_type: 'head_office',
    branch_number: null,
    address: null,
    subdistrict: null,
    district: null,
    province: null,
    postal_code: null,
    phone: null,
    email: null,
    contact_person: null,
    note: null,
    status: 'active',
    created_by: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

describe('parseContactRow', () => {
  it('แถวข้อมูลนิติบุคคลถูกต้องครบ — ไม่มี error', () => {
    const result = parseContactRow(row(), 2)!;
    expect(result.errors).toEqual([]);
    expect(result.partner_type).toBe('customer');
    expect(result.entity_type).toBe('company');
    expect(result.company_name).toBe('บริษัท ทดสอบ จำกัด');
    expect(result.branch_type).toBe('head_office');
    expect(result.status).toBe('active');
    expect(result.rowNumber).toBe(2);
  });

  it('แถวข้อมูลบุคคลธรรมดาถูกต้องครบ — ไม่มี error', () => {
    const result = parseContactRow(
      row({
        [CONTACT_EXCEL_HEADERS.partner_type]: 'ผู้จัดจำหน่าย',
        [CONTACT_EXCEL_HEADERS.entity_type]: 'บุคคลธรรมดา',
        [CONTACT_EXCEL_HEADERS.company_name]: '',
        [CONTACT_EXCEL_HEADERS.first_name]: 'สมชาย',
        [CONTACT_EXCEL_HEADERS.last_name]: 'ใจดี',
      }),
      2
    )!;
    expect(result.errors).toEqual([]);
    expect(result.partner_type).toBe('vendor');
    expect(result.entity_type).toBe('individual');
  });

  it('ไม่ได้ระบุประเภท — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.partner_type]: '' }), 2)!;
    expect(result.errors).toContain('ไม่ได้ระบุประเภท (ลูกค้า/ผู้จัดจำหน่าย)');
  });

  it('ประเภทเป็นค่าที่ไม่รู้จัก — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.partner_type]: 'ไม่รู้จัก' }), 2)!;
    expect(result.errors.some((e) => e.includes('ประเภท'))).toBe(true);
  });

  it('ไม่ได้กรอกรหัส — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.contact_code]: '' }), 2)!;
    expect(result.errors).toContain('ไม่ได้กรอกรหัส');
  });

  it('นิติบุคคลไม่กรอกชื่อบริษัท — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.company_name]: '' }), 2)!;
    expect(result.errors).toContain('นิติบุคคลต้องกรอกชื่อบริษัท');
  });

  it('บุคคลธรรมดาไม่กรอกชื่อ/นามสกุล — error', () => {
    const result = parseContactRow(
      row({ [CONTACT_EXCEL_HEADERS.entity_type]: 'บุคคลธรรมดา', [CONTACT_EXCEL_HEADERS.company_name]: '' }),
      2
    )!;
    expect(result.errors).toContain('บุคคลธรรมดาต้องกรอกชื่อและนามสกุล');
  });

  it('เลขประจำตัวผู้เสียภาษีไม่ครบ 13 หลัก — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.tax_id]: '123' }), 2)!;
    expect(result.errors).toContain('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  });

  it('เลือก "สาขาที่" แต่ไม่กรอกเลขสาขา — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.branch_type]: 'สาขาที่' }), 2)!;
    expect(result.errors).toContain('เลือก "สาขาที่" ต้องกรอกเลขสาขาด้วย');
  });

  it('เลือก "สาขาที่" กรอกเลขสาขาไม่ครบ 5 หลัก — error', () => {
    const result = parseContactRow(
      row({ [CONTACT_EXCEL_HEADERS.branch_type]: 'สาขาที่', [CONTACT_EXCEL_HEADERS.branch_number]: '123' }),
      2
    )!;
    expect(result.errors).toContain('เลขสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001');
  });

  it('เลือก "สาขาที่" กรอกเลขสาขาครบ 5 หลัก — ไม่ error', () => {
    const result = parseContactRow(
      row({ [CONTACT_EXCEL_HEADERS.branch_type]: 'สาขาที่', [CONTACT_EXCEL_HEADERS.branch_number]: '00001' }),
      2
    )!;
    expect(result.errors).toEqual([]);
    expect(result.branch_type).toBe('branch');
    expect(result.branch_number).toBe('00001');
  });

  it('รหัสไปรษณีย์ไม่ครบ 5 หลัก — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.postal_code]: '101' }), 2)!;
    expect(result.errors).toContain('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
  });

  it('อีเมลรูปแบบผิด — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.email]: 'ไม่ใช่อีเมล' }), 2)!;
    expect(result.errors).toContain('รูปแบบอีเมลไม่ถูกต้อง');
  });

  it('สถานะเป็นค่าที่ไม่รู้จัก — error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.status]: 'ไม่รู้จัก' }), 2)!;
    expect(result.errors.some((e) => e.includes('สถานะ'))).toBe(true);
  });

  it('ไม่กรอกสถานะ — default เป็น "active" ไม่ error', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.status]: '' }), 2)!;
    expect(result.status).toBe('active');
    expect(result.errors).toEqual([]);
  });

  it('สถานะ "ไม่ใช้งาน" อ่านถูกต้อง', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.status]: 'ไม่ใช้งาน' }), 2)!;
    expect(result.status).toBe('inactive');
  });

  it('แถวว่างทั้งแถวคืนค่า null (ข้ามได้)', () => {
    const emptyRow = Object.fromEntries(Object.values(CONTACT_EXCEL_HEADERS).map((h) => [h, '']));
    expect(parseContactRow(emptyRow, 5)).toBeNull();
  });

  it('มีหลาย error พร้อมกันได้ในแถวเดียว', () => {
    const result = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.contact_code]: '', [CONTACT_EXCEL_HEADERS.company_name]: '' }), 2)!;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseContactRows', () => {
  it('ข้ามแถวว่างไปอัตโนมัติ และเลขแถวตรงกับตำแหน่งจริงในไฟล์ (แถว 1 = header)', () => {
    const emptyRow = Object.fromEntries(Object.values(CONTACT_EXCEL_HEADERS).map((h) => [h, '']));
    const rows = parseContactRows([row(), emptyRow, row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0002' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(4);
    expect(rows[1].contact_code).toBe('CUS0002');
  });

  it('ไฟล์ไม่มีแถวข้อมูลเลย คืน array ว่าง', () => {
    expect(parseContactRows([])).toEqual([]);
  });
});

describe('findDuplicateCodesInFile', () => {
  it('ตรวจพบรหัสซ้ำกันเองภายในไฟล์ (ทั้งสองแถว)', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' }), row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    const dup = findDuplicateCodesInFile(rows);
    expect(dup.has(2)).toBe(true);
    expect(dup.has(3)).toBe(true);
  });

  it('ไม่สนตัวพิมพ์เล็ก/ใหญ่ — "cus0001" ซ้ำกับ "CUS0001"', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' }), row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'cus0001' })]);
    expect(findDuplicateCodesInFile(rows).size).toBe(2);
  });

  it('รหัสไม่ซ้ำกันเลย — ไม่มีอะไรถูกตีว่าซ้ำ', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' }), row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0002' })]);
    expect(findDuplicateCodesInFile(rows)).toEqual(new Set());
  });
});

describe('findDuplicateCodesVsExisting', () => {
  it('ตรวจพบรหัสที่ซ้ำกับข้อมูลเดิมในระบบ', () => {
    const existing = [makeContact({ contact_code: 'CUS0001' })];
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    expect(findDuplicateCodesVsExisting(rows, existing).has(2)).toBe(true);
  });

  it('ไม่สนตัวพิมพ์เล็ก/ใหญ่', () => {
    const existing = [makeContact({ contact_code: 'cus0001' })];
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    expect(findDuplicateCodesVsExisting(rows, existing).has(2)).toBe(true);
  });

  it('ไม่มีข้อมูลเดิมในระบบเลย — ไม่มีอะไรถูกตีว่าซ้ำ', () => {
    const rows = parseContactRows([row()]);
    expect(findDuplicateCodesVsExisting(rows, [])).toEqual(new Set());
  });
});

describe('annotateDuplicateCodeErrors', () => {
  it('เติม error รหัสซ้ำภายในไฟล์ให้ทั้งสองแถว', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' }), row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    const annotated = annotateDuplicateCodeErrors(rows, []);
    expect(annotated[0].errors).toContain('รหัสนี้ซ้ำกับแถวอื่นในไฟล์เดียวกัน');
    expect(annotated[1].errors).toContain('รหัสนี้ซ้ำกับแถวอื่นในไฟล์เดียวกัน');
  });

  it('เติม error รหัสซ้ำกับข้อมูลเดิม', () => {
    const existing = [makeContact({ contact_code: 'CUS0001' })];
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    const annotated = annotateDuplicateCodeErrors(rows, existing);
    expect(annotated[0].errors).toContain('รหัสนี้มีอยู่แล้วในระบบ');
  });

  it('ไม่มีรหัสซ้ำเลย — ไม่เพิ่ม error ใดๆ (แถวที่ไม่มี error เดิมยังคง error ว่างเปล่า)', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' }), row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0002' })]);
    const annotated = annotateDuplicateCodeErrors(rows, []);
    expect(annotated[0].errors).toEqual([]);
    expect(annotated[1].errors).toEqual([]);
  });

  it('ไม่แก้ไข error เดิมที่มีอยู่แล้วจากการ parse ทิ้ง (แค่เพิ่มเข้าไป)', () => {
    const rows = parseContactRows([row({ [CONTACT_EXCEL_HEADERS.contact_code]: '' })]);
    const annotated = annotateDuplicateCodeErrors(rows, []);
    expect(annotated[0].errors).toContain('ไม่ได้กรอกรหัส');
  });
});

describe('contactRowToWriteInput', () => {
  it('แถวนิติบุคคลแปลงเป็น payload ครบถ้วน', () => {
    const parsed = parseContactRow(row(), 2)!;
    const input = contactRowToWriteInput(parsed);
    expect(input).toEqual({
      partner_type: 'customer',
      contact_code: 'CUS0001',
      entity_type: 'company',
      company_name: 'บริษัท ทดสอบ จำกัด',
      first_name: null,
      last_name: null,
      tax_id: null,
      branch_type: 'head_office',
      branch_number: null,
      address: null,
      subdistrict: null,
      district: null,
      province: null,
      postal_code: null,
      phone: null,
      email: null,
      contact_person: null,
      note: null,
      status: 'active',
    });
  });

  it('รหัส normalize เป็นตัวพิมพ์ใหญ่เสมอ', () => {
    const parsed = parseContactRow(row({ [CONTACT_EXCEL_HEADERS.contact_code]: 'cus0001' }), 2)!;
    expect(contactRowToWriteInput(parsed).contact_code).toBe('CUS0001');
  });

  it('เลือกสำนักงานใหญ่ — branch_number เป็น null เสมอแม้ในไฟล์จะมีค่าเลขสาขาติดมา', () => {
    const parsed = parseContactRow(
      row({ [CONTACT_EXCEL_HEADERS.branch_type]: 'สำนักงานใหญ่', [CONTACT_EXCEL_HEADERS.branch_number]: '00099' }),
      2
    )!;
    expect(contactRowToWriteInput(parsed).branch_number).toBeNull();
  });

  it('เลือกสาขาที่ — เก็บเลขสาขาไว้', () => {
    const parsed = parseContactRow(
      row({ [CONTACT_EXCEL_HEADERS.branch_type]: 'สาขาที่', [CONTACT_EXCEL_HEADERS.branch_number]: '00002' }),
      2
    )!;
    expect(contactRowToWriteInput(parsed).branch_number).toBe('00002');
  });
});

describe('buildContactTemplateBlob + readContactWorkbookRows (round-trip)', () => {
  it('เทมเพลตที่สร้างขึ้นอ่านกลับมาได้ และแถวตัวอย่างทั้งสองแถว (นิติบุคคล/บุคคลธรรมดา) ผ่านการตรวจสอบ', async () => {
    const blob = buildContactTemplateBlob();
    expect(blob.size).toBeGreaterThan(0);
    const arrayBuffer = await blob.arrayBuffer();
    const rawRows = readContactWorkbookRows(arrayBuffer);
    expect(rawRows.length).toBeGreaterThanOrEqual(2);
    const parsed = parseContactRows(rawRows);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((r) => r.errors.length === 0)).toBe(true);
    expect(parsed[0].entity_type).toBe('company');
    expect(parsed[0].contact_code).toBe('CUS0001');
    expect(parsed[1].entity_type).toBe('individual');
    expect(parsed[1].contact_code).toBe('VEN0001');
  });

  it('สองแถวตัวอย่างในเทมเพลตไม่ซ้ำรหัสกันเอง', async () => {
    const blob = buildContactTemplateBlob();
    const rawRows = readContactWorkbookRows(await blob.arrayBuffer());
    const parsed = parseContactRows(rawRows);
    expect(findDuplicateCodesInFile(parsed)).toEqual(new Set());
  });
});
