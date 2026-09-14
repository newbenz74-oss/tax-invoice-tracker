import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  actorLabel,
  collectActorEmails,
  describeChanges,
  describeEntry,
  describeSnapshot,
  fieldLabel,
  formatAuditTimestamp,
  formatFieldValue,
  tableLabel,
} from './auditLogLogic';
import type { AuditLogEntry } from '@/types/auditLog';

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    company_id: 'c1',
    table_name: 'pending_tax_invoices',
    record_id: 'r1',
    record_label: 'บริษัท เทนเซ็นต์ (ประเทศไทย) จำกัด',
    action: 'update',
    changed_fields: null,
    old_values: null,
    new_values: null,
    actor_id: 'u1',
    actor_email: 'somchai@example.com',
    created_at: '2026-09-14T03:30:00.000Z',
    ...overrides,
  };
}

describe('tableLabel', () => {
  it('แปลงชื่อตารางเป็นชื่อที่ผู้ใช้เห็นในเมนู', () => {
    expect(tableLabel('pending_tax_invoices')).toBe('ใบกำกับภาษี');
    expect(tableLabel('wht_certificates')).toBe('ใบหัก ณ ที่จ่าย');
    expect(tableLabel('company_members')).toBe('สมาชิกบริษัท');
  });

  it("'-' คือเหตุการณ์ระดับบริษัท ไม่ใช่ชื่อตาราง", () => {
    expect(tableLabel('-')).toBe('ทั้งบริษัท');
  });

  it('ตารางที่ยังไม่ได้ตั้งชื่อไทยไว้ คืนชื่อจริงตรงๆ ไม่ throw', () => {
    expect(tableLabel('some_new_table')).toBe('some_new_table');
  });
});

describe('actionLabel', () => {
  it('แปลงชนิดการกระทำครบทุกแบบ', () => {
    expect(actionLabel('insert')).toBe('เพิ่ม');
    expect(actionLabel('update')).toBe('แก้ไข');
    expect(actionLabel('delete')).toBe('ลบ');
    expect(actionLabel('restore_begin')).toBe('เริ่มกู้คืนข้อมูล');
    expect(actionLabel('restore_end')).toBe('กู้คืนข้อมูลสำเร็จ');
  });
});

describe('fieldLabel', () => {
  it('แปลงชื่อคอลัมน์เป็นภาษาไทย', () => {
    expect(fieldLabel('vendor_name')).toBe('ชื่อผู้ขาย');
    expect(fieldLabel('total_wht_amount')).toBe('ยอดภาษีที่หัก');
  });

  it('คอลัมน์ที่ไม่รู้จัก คืนชื่อจริง (ดีกว่าซ่อนจนผู้ใช้ไม่รู้ว่ามีอะไรเปลี่ยน)', () => {
    expect(fieldLabel('brand_new_column')).toBe('brand_new_column');
  });
});

describe('formatFieldValue', () => {
  it('ค่าว่าง/null แสดงเป็น (ว่าง) ไม่ใช่ช่องว่างเปล่าที่ดูเหมือนระบบพัง', () => {
    expect(formatFieldValue('notes', null)).toBe('(ว่าง)');
    expect(formatFieldValue('notes', undefined)).toBe('(ว่าง)');
    expect(formatFieldValue('notes', '')).toBe('(ว่าง)');
  });

  it('แปลงค่า enum เป็นคำไทยตามคอลัมน์', () => {
    expect(formatFieldValue('status', 'pending')).toBe('รอรับใบกำกับภาษี');
    expect(formatFieldValue('status', 'complete')).toBe('เสร็จสมบูรณ์');
    expect(formatFieldValue('partner_type', 'vendor')).toBe('ผู้จัดจำหน่าย');
    expect(formatFieldValue('form_type', '53')).toBe('ภ.ง.ด.53');
  });

  it('ตัวเลขจำนวนเงินใส่คอมมาคั่นหลักพัน (รับทั้ง number และ string จาก numeric ของ Postgres)', () => {
    expect(formatFieldValue('total_amount', 171445.89)).toBe('171,445.89');
    expect(formatFieldValue('total_amount', '171445.89')).toBe('171,445.89');
  });

  it('ปีและลำดับที่ต้องไม่มีคอมมา ไม่งั้น 2569 จะกลายเป็น 2,569', () => {
    expect(formatFieldValue('period_year', 2569)).toBe('2569');
    expect(formatFieldValue('sequence_number', 1042)).toBe('1042');
  });

  it('สถานะของใบหัก ณ ที่จ่ายก็ต้องแปลเป็นไทย ไม่ใช่โผล่ issued/voided ดิบๆ', () => {
    expect(formatFieldValue('status', 'issued')).toBe('ออกแล้ว');
    expect(formatFieldValue('status', 'voided')).toBe('ยกเลิกแล้ว');
  });

  it('เลขที่เป็น "รหัส" ห้ามใส่คอมมาและห้ามตัดศูนย์นำหน้า', () => {
    // เลขผู้เสียภาษี 13 หลักที่ขึ้นต้นด้วย 0 — ถ้าจัดรูปแบบเป็นตัวเลขจะกลายเป็น "105,558,012,345" ซึ่งผิดจน
    // ใช้อ้างอิงกับสรรพากรไม่ได้เลย เป็นบั๊กที่อันตรายที่สุดของหน้านี้ถ้าหลุดไป
    expect(formatFieldValue('tax_id', '0105558012345')).toBe('0105558012345');
    expect(formatFieldValue('postal_code', '10110')).toBe('10110');
    expect(formatFieldValue('phone', '021234567')).toBe('021234567');
    expect(formatFieldValue('branch_number', '00001')).toBe('00001');
    expect(formatFieldValue('cert_number', '25690001')).toBe('25690001');
    expect(formatFieldValue('reference_no', '1234567')).toBe('1234567');
  });

  it('boolean แปลงเป็นคำไทย', () => {
    expect(formatFieldValue('is_active', true)).toBe('ใช่');
    expect(formatFieldValue('is_active', false)).toBe('ไม่ใช่');
  });

  it('ข้อความธรรมดาคืนค่าเดิม', () => {
    expect(formatFieldValue('vendor_name', 'บริษัท ก จำกัด')).toBe('บริษัท ก จำกัด');
  });
});

describe('describeChanges', () => {
  it('คืนรายการ ก่อน → หลัง ของทุกคอลัมน์ที่เปลี่ยน', () => {
    const changes = describeChanges(
      makeEntry({
        action: 'update',
        changed_fields: ['status', 'total_amount'],
        old_values: { status: 'pending', total_amount: '1000' },
        new_values: { status: 'received', total_amount: '1200.50' },
      }),
    );

    expect(changes).toEqual([
      { field: 'status', label: 'สถานะ', before: 'รอรับใบกำกับภาษี', after: 'ได้รับแล้ว' },
      { field: 'total_amount', label: 'ยอดรวม', before: '1,000', after: '1,200.5' },
    ]);
  });

  it('ซ่อนคอลัมน์ที่ระบบจัดการเอง ไม่ใช่สิ่งที่ผู้ใช้ตั้งใจแก้', () => {
    const changes = describeChanges(
      makeEntry({
        action: 'update',
        changed_fields: ['updated_at', 'updated_by_email', 'id', 'vendor_name'],
        old_values: { vendor_name: 'ก' },
        new_values: { vendor_name: 'ข' },
      }),
    );

    expect(changes.map((c) => c.field)).toEqual(['vendor_name']);
  });

  it('การเพิ่ม/ลบไม่มีรายการ ก่อน→หลัง (ทั้งแถวเกิดใหม่หรือหายไปทั้งแถว)', () => {
    expect(describeChanges(makeEntry({ action: 'insert', changed_fields: ['vendor_name'] }))).toEqual([]);
    expect(describeChanges(makeEntry({ action: 'delete', changed_fields: ['vendor_name'] }))).toEqual([]);
  });

  it('update ที่ไม่มี changed_fields (ข้อมูลเก่า) ไม่ throw', () => {
    expect(describeChanges(makeEntry({ action: 'update', changed_fields: null }))).toEqual([]);
  });
});

describe('describeSnapshot', () => {
  it('การเพิ่ม: แสดงค่าทั้งแถวจาก new_values', () => {
    const values = describeSnapshot(
      makeEntry({
        action: 'insert',
        new_values: { vendor_name: 'บริษัท ก จำกัด', status: 'pending', id: 'x', company_id: 'c1' },
      }),
    );
    expect(values.map((v) => v.field).sort()).toEqual(['status', 'vendor_name']);
    expect(values.find((v) => v.field === 'status')?.value).toBe('รอรับใบกำกับภาษี');
  });

  it('การลบ: แสดงค่าทั้งแถวจาก old_values (ค่าสุดท้ายก่อนหายไป)', () => {
    const values = describeSnapshot(
      makeEntry({ action: 'delete', old_values: { vendor_name: 'บริษัท ข จำกัด' }, new_values: null }),
    );
    expect(values).toEqual([{ field: 'vendor_name', label: 'ชื่อผู้ขาย', value: 'บริษัท ข จำกัด' }]);
  });

  it('ตัดคอลัมน์ที่ว่างออก ไม่ให้รายการยาวเหยียดด้วยคำว่า (ว่าง)', () => {
    const values = describeSnapshot(
      makeEntry({ action: 'insert', new_values: { vendor_name: 'ก', notes: null, reference_no: '' } }),
    );
    expect(values.map((v) => v.field)).toEqual(['vendor_name']);
  });

  it('ไม่มีข้อมูลก็ไม่ throw', () => {
    expect(describeSnapshot(makeEntry({ action: 'insert', new_values: null }))).toEqual([]);
  });
});

describe('describeEntry', () => {
  it('ประกอบประโยคจากการกระทำ + ชนิดข้อมูล + ชื่อรายการ', () => {
    expect(describeEntry(makeEntry({ action: 'delete' }))).toBe(
      'ลบใบกำกับภาษี "บริษัท เทนเซ็นต์ (ประเทศไทย) จำกัด"',
    );
    expect(
      describeEntry(makeEntry({ action: 'insert', table_name: 'business_partners', record_label: 'บริษัท ข จำกัด' })),
    ).toBe('เพิ่มสมุดรายชื่อ "บริษัท ข จำกัด"');
  });

  it('ไม่มีชื่อรายการก็ยังอ่านรู้เรื่อง ไม่โผล่เครื่องหมายคำพูดเปล่าๆ', () => {
    expect(describeEntry(makeEntry({ action: 'update', record_label: null }))).toBe('แก้ไขใบกำกับภาษี');
    expect(describeEntry(makeEntry({ action: 'update', record_label: '   ' }))).toBe('แก้ไขใบกำกับภาษี');
  });

  it('เหตุการณ์กู้คืนข้อมูลใช้ข้อความสรุปที่เขียนมาจากฐานข้อมูลตรงๆ', () => {
    expect(
      describeEntry(
        makeEntry({
          action: 'restore_end',
          table_name: '-',
          record_label: 'กู้คืนแบบเขียนทับ 1,248 รายการ จาก 8 ตาราง',
        }),
      ),
    ).toBe('กู้คืนแบบเขียนทับ 1,248 รายการ จาก 8 ตาราง');
  });
});

describe('actorLabel', () => {
  it('แสดงอีเมลผู้ทำ', () => {
    expect(actorLabel(makeEntry())).toBe('somchai@example.com');
  });

  it('ไม่มีอีเมล = เกิดนอกระบบ ไม่ใช่ "ไม่รู้ว่าใคร"', () => {
    expect(actorLabel(makeEntry({ actor_email: null }))).toBe('ระบบ / ผู้ดูแลฐานข้อมูล');
  });
});

describe('collectActorEmails', () => {
  it('รวมอีเมลไม่ซ้ำ เรียงตามตัวอักษร', () => {
    const emails = collectActorEmails([
      makeEntry({ actor_email: 'somsri@example.com' }),
      makeEntry({ actor_email: 'anan@example.com' }),
      makeEntry({ actor_email: 'somsri@example.com' }),
      makeEntry({ actor_email: null }),
    ]);
    expect(emails).toEqual(['anan@example.com', 'somsri@example.com']);
  });

  it('ชุดว่างคืนอาร์เรย์ว่าง', () => {
    expect(collectActorEmails([])).toEqual([]);
  });
});

describe('formatAuditTimestamp', () => {
  it('คืนค่าเดิมถ้าแปลงวันที่ไม่ได้ ไม่ throw และไม่แสดงคำว่า Invalid Date', () => {
    expect(formatAuditTimestamp('ไม่ใช่วันที่')).toBe('ไม่ใช่วันที่');
  });

  it('วันที่ถูกต้องต้องได้ข้อความที่มีทั้งวันและเวลา', () => {
    const text = formatAuditTimestamp('2026-09-14T03:30:00.000Z');
    expect(text).not.toBe('2026-09-14T03:30:00.000Z');
    expect(text.length).toBeGreaterThan(0);
  });
});
