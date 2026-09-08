import { describe, expect, it } from 'vitest';
import {
  BackupFileError,
  arrayBufferToBase64,
  base64ToUint8Array,
  buildBackupFileName,
  chunk,
  conflictTargetFor,
  countBackupRows,
  emptyTables,
  formatExportedAt,
  isCompanyScopedTable,
  parseBackupFile,
  prepareRowsForRestore,
  restoreDeleteOrder,
  restoreWriteOrder,
} from './backupLogic';
import { BACKUP_FILE_KIND, BACKUP_FORMAT_VERSION, BACKUP_TABLES } from '@/types/backup';

const TARGET_COMPANY = '11111111-1111-1111-1111-111111111111';

function validFileText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: BACKUP_FILE_KIND,
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: '2026-09-08T03:04:05.000Z',
    source_company_id: '99999999-9999-9999-9999-999999999999',
    exported_by_email: 'newbenz74@gmail.com',
    company: { name: 'บริษัท แอซ เท็ก จำกัด', tax_id: '0105551096598' },
    logo: null,
    tables: { ...emptyTables(), pending_tax_invoices: [{ id: 'a', vendor_name: 'ผู้ขาย' }] },
    ...overrides,
  });
}

describe('parseBackupFile', () => {
  it('อ่านไฟล์ที่ถูกต้องได้ครบทุกส่วน', () => {
    const file = parseBackupFile(validFileText());
    expect(file.source_company_id).toBe('99999999-9999-9999-9999-999999999999');
    expect(file.exported_by_email).toBe('newbenz74@gmail.com');
    expect(file.tables.pending_tax_invoices).toHaveLength(1);
    expect(file.tables.business_partners).toEqual([]);
  });

  it('ปฏิเสธไฟล์ที่ไม่ใช่ JSON', () => {
    expect(() => parseBackupFile('ไม่ใช่ json')).toThrow(BackupFileError);
  });

  it('ปฏิเสธไฟล์ JSON อื่นที่ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้', () => {
    expect(() => parseBackupFile(JSON.stringify({ hello: 'world' }))).toThrow(/ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้/);
  });

  it('ปฏิเสธไฟล์ที่รูปแบบเวอร์ชันใหม่กว่าที่ระบบรองรับ', () => {
    expect(() => parseBackupFile(validFileText({ format_version: BACKUP_FORMAT_VERSION + 1 }))).toThrow(
      /เวอร์ชันใหม่กว่า/
    );
  });

  it('ปฏิเสธไฟล์ที่ข้อมูลตารางไม่ใช่อาร์เรย์', () => {
    expect(() => parseBackupFile(validFileText({ tables: { pending_tax_invoices: 'ไม่ใช่อาร์เรย์' } }))).toThrow(
      /ผิดรูปแบบ/
    );
  });

  it('ไฟล์เก่าที่ไม่มีตารางใหม่ อ่านได้และถือว่าตารางนั้นว่างเปล่า', () => {
    const file = parseBackupFile(validFileText({ tables: { pending_tax_invoices: [] } }));
    for (const table of BACKUP_TABLES) {
      expect(file.tables[table]).toEqual([]);
    }
  });

  it('อ่านโลโก้ base64 ได้ และมองข้ามโลโก้ที่รูปแบบผิด', () => {
    expect(parseBackupFile(validFileText({ logo: { base64: 'QUJD' } })).logo).toEqual({ base64: 'QUJD' });
    expect(parseBackupFile(validFileText({ logo: { base64: '' } })).logo).toBeNull();
    expect(parseBackupFile(validFileText({ logo: 'ไม่ใช่อ็อบเจกต์' })).logo).toBeNull();
  });
});

describe('prepareRowsForRestore', () => {
  it('ตัดคอลัมน์ที่ฐานข้อมูลคำนวณเอง (total_amount) ทิ้ง', () => {
    const [row] = prepareRowsForRestore(
      'pending_tax_invoices',
      [{ id: 'a', amount_excl_vat: 100, vat_amount: 7, total_amount: 107 }],
      TARGET_COMPANY
    );
    expect(row).not.toHaveProperty('total_amount');
    expect(row.amount_excl_vat).toBe(100);
  });

  it('ล้าง created_by/updated_by เป็น null แต่เก็บอีเมลผู้สร้างไว้ครบ', () => {
    const [row] = prepareRowsForRestore(
      'bank_reconcile_reports',
      [{ id: 'r1', created_by: 'user-เก่า', created_by_email: 'a@b.com', updated_by: 'user-เก่า' }],
      TARGET_COMPANY
    );
    expect(row.created_by).toBeNull();
    expect(row.updated_by).toBeNull();
    expect(row.created_by_email).toBe('a@b.com');
  });

  it('เขียน company_id ทับด้วยบริษัทปลายทางเสมอ', () => {
    const [row] = prepareRowsForRestore('business_partners', [{ id: 'c1', company_id: 'บริษัทเก่า' }], TARGET_COMPANY);
    expect(row.company_id).toBe(TARGET_COMPANY);
  });

  it('ไม่ยัด company_id ให้ตารางลูกที่ไม่มีคอลัมน์นี้', () => {
    const [row] = prepareRowsForRestore('bank_reconcile_bank_rows', [{ id: 'b1', report_id: 'r1' }], TARGET_COMPANY);
    expect(row).not.toHaveProperty('company_id');
    expect(row.report_id).toBe('r1');
  });

  it('เก็บ id เดิมไว้เสมอ (ความสัมพันธ์ระหว่างตารางต้องไม่ขาด)', () => {
    const [cert] = prepareRowsForRestore(
      'wht_certificates',
      [{ id: 'cert-1', business_partner_id: 'contact-1' }],
      TARGET_COMPANY
    );
    expect(cert.id).toBe('cert-1');
    expect(cert.business_partner_id).toBe('contact-1');
  });

  it('ไม่แก้ไขแถวต้นฉบับ (ไม่ mutate)', () => {
    const original = { id: 'a', total_amount: 107, created_by: 'u1' };
    prepareRowsForRestore('pending_tax_invoices', [original], TARGET_COMPANY);
    expect(original.total_amount).toBe(107);
    expect(original.created_by).toBe('u1');
  });
});

describe('ลำดับการเขียน/ลบ', () => {
  it('เขียนตารางแม่ก่อนตารางลูกเสมอ', () => {
    const order = restoreWriteOrder();
    expect(order.indexOf('business_partners')).toBeLessThan(order.indexOf('wht_certificates'));
    expect(order.indexOf('bank_reconcile_reports')).toBeLessThan(order.indexOf('bank_reconcile_match_groups'));
    expect(order.indexOf('bank_reconcile_match_groups')).toBeLessThan(order.indexOf('bank_reconcile_bank_rows'));
  });

  it('ลบย้อนลำดับการเขียน (ลูกก่อนแม่)', () => {
    expect(restoreDeleteOrder()).toEqual([...restoreWriteOrder()].reverse());
  });
});

describe('conflictTargetFor', () => {
  it('ใช้ id เป็นคีย์ปกติ', () => {
    expect(conflictTargetFor('pending_tax_invoices')).toBe('id');
  });

  it('ตัวนับเลขที่ใบหัก ณ ที่จ่ายใช้ composite key เพราะไม่มีคอลัมน์ id', () => {
    expect(conflictTargetFor('wht_certificate_counters')).toBe('company_id,form_type,period_year,period_month');
  });
});

describe('isCompanyScopedTable', () => {
  it('ตารางระดับบนผูกกับบริษัทโดยตรง ส่วนตารางลูกผูกผ่านรายงาน', () => {
    expect(isCompanyScopedTable('pending_tax_invoices')).toBe(true);
    expect(isCompanyScopedTable('bank_reconcile_reports')).toBe(true);
    expect(isCompanyScopedTable('bank_reconcile_gl_rows')).toBe(false);
  });
});

describe('buildBackupFileName', () => {
  it('ใส่ชื่อบริษัทและเวลาแบบเรียงลำดับได้', () => {
    const name = buildBackupFileName('บริษัท แอซ เท็ก จำกัด', new Date(2026, 8, 8, 9, 5, 3));
    expect(name).toBe('backup-บริษัท แอซ เท็ก จำกัด-20260908-090503.json');
  });

  it('ตัดอักขระที่ตั้งชื่อไฟล์ไม่ได้ออก', () => {
    const name = buildBackupFileName('A/B:C*?"<>|', new Date(2026, 0, 2, 3, 4, 5));
    expect(name).toBe('backup-ABC-20260102-030405.json');
  });

  it('ชื่อบริษัทที่เหลือแต่อักขระต้องห้าม ใช้ชื่อสำรองแทน', () => {
    expect(buildBackupFileName('///', new Date(2026, 0, 2, 3, 4, 5))).toBe('backup-company-20260102-030405.json');
  });
});

describe('countBackupRows', () => {
  it('นับรวมทุกตาราง', () => {
    const tables = emptyTables();
    tables.pending_tax_invoices = [{ id: 'a' }, { id: 'b' }];
    tables.business_partners = [{ id: 'c' }];
    expect(countBackupRows(tables)).toBe(3);
  });

  it('ตารางว่างทั้งหมดได้ศูนย์', () => {
    expect(countBackupRows(emptyTables())).toBe(0);
  });
});

describe('chunk', () => {
  it('แบ่งเป็นก้อนตามขนาดที่กำหนด ก้อนสุดท้ายสั้นกว่าได้', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('อาร์เรย์ว่างได้ผลลัพธ์ว่าง', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('ขนาดก้อนต้องมากกว่าศูนย์', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('base64', () => {
  it('แปลงไปกลับแล้วได้ไบต์เดิมครบ', () => {
    const source = new Uint8Array([0, 1, 2, 137, 80, 78, 71, 255]);
    const base64 = arrayBufferToBase64(source.buffer);
    expect(Array.from(base64ToUint8Array(base64))).toEqual(Array.from(source));
  });

  it('รองรับข้อมูลใหญ่กว่าขนาดก้อนภายใน (ไม่ทำให้ call stack ล้น)', () => {
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(base64ToUint8Array(arrayBufferToBase64(big.buffer)).length).toBe(big.length);
  });
});

describe('formatExportedAt', () => {
  it('แสดงเป็นวันที่แบบไทย พ.ศ.', () => {
    expect(formatExportedAt(new Date(2026, 8, 8, 14, 30).toISOString())).toBe('08/09/2569 14:30 น.');
  });

  it('ค่าว่างหรือวันที่ไม่ถูกต้องคืนสตริงว่าง', () => {
    expect(formatExportedAt('')).toBe('');
    expect(formatExportedAt('ไม่ใช่วันที่')).toBe('');
  });
});
