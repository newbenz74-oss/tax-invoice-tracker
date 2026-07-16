import { describe, expect, it } from 'vitest';
import {
  CONTACT_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  PARTNER_TYPE_LABELS,
  computeContactCounts,
  filterContacts,
  formatBranchLabel,
  generateNextContactCode,
  getContactDisplayName,
  normalizeContactCode,
  validateContactForm,
} from './contactLogic';
import type { BusinessPartner, ContactFormInput } from '@/types/contact';

function makeContact(overrides: Partial<BusinessPartner> = {}): BusinessPartner {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
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
    created_by: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

const emptyForm: ContactFormInput = {
  partner_type: '',
  contact_code: '',
  entity_type: '',
  company_name: '',
  first_name: '',
  last_name: '',
  tax_id: '',
  branch_type: 'head_office',
  branch_number: '',
  address: '',
  subdistrict: '',
  district: '',
  province: '',
  postal_code: '',
  phone: '',
  email: '',
  contact_person: '',
  note: '',
  status: 'active',
};

describe('normalizeContactCode', () => {
  it('ตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์ใหญ่', () => {
    expect(normalizeContactCode('  cus0001  ')).toBe('CUS0001');
  });

  it('รหัสที่เป็นตัวพิมพ์ใหญ่อยู่แล้วไม่เปลี่ยนแปลง', () => {
    expect(normalizeContactCode('VEN0002')).toBe('VEN0002');
  });
});

describe('generateNextContactCode', () => {
  it('ไม่มีรายชื่อเดิมเลย — เริ่มที่ 0001', () => {
    expect(generateNextContactCode('customer', [])).toBe('CUS0001');
    expect(generateNextContactCode('vendor', [])).toBe('VEN0001');
  });

  it('เรียงเลขถัดไปจากรหัสมากที่สุดที่มีอยู่ (prefix เดียวกัน)', () => {
    const existing = [
      makeContact({ contact_code: 'CUS0001' }),
      makeContact({ contact_code: 'CUS0003' }),
      makeContact({ contact_code: 'CUS0002' }),
    ];
    expect(generateNextContactCode('customer', existing)).toBe('CUS0004');
  });

  it('นับแยกตาม prefix — ลูกค้ากับผู้จัดจำหน่ายไม่ปนกัน', () => {
    const existing = [makeContact({ contact_code: 'CUS0005' }), makeContact({ partner_type: 'vendor', contact_code: 'VEN0001' })];
    expect(generateNextContactCode('vendor', existing)).toBe('VEN0002');
    expect(generateNextContactCode('customer', existing)).toBe('CUS0006');
  });

  it('ไม่สนตัวพิมพ์เล็ก/ใหญ่ของรหัสเดิมตอนหาค่ามากที่สุด', () => {
    const existing = [makeContact({ contact_code: 'cus0007' })];
    expect(generateNextContactCode('customer', existing)).toBe('CUS0008');
  });

  it('รหัสเดิมที่ผู้ใช้แก้ไขเป็นรูปแบบแปลกไป (ไม่ใช่ตัวเลขต่อท้าย) ไม่ทำให้พัง — ข้ามไปเฉยๆ', () => {
    const existing = [makeContact({ contact_code: 'CUS-SPECIAL' }), makeContact({ contact_code: 'CUS0002' })];
    expect(generateNextContactCode('customer', existing)).toBe('CUS0003');
  });

  it('เติม 0 ให้ครบ 4 หลักเสมอ', () => {
    const existing = Array.from({ length: 9 }, (_, i) => makeContact({ contact_code: `CUS000${i + 1}` }));
    expect(generateNextContactCode('customer', existing)).toBe('CUS0010');
  });
});

describe('getContactDisplayName', () => {
  it('นิติบุคคล — ใช้ชื่อบริษัท', () => {
    expect(getContactDisplayName({ entity_type: 'company', company_name: 'บริษัท เอบีซี จำกัด', first_name: null, last_name: null })).toBe(
      'บริษัท เอบีซี จำกัด'
    );
  });

  it('บุคคลธรรมดา — ใช้ชื่อ + นามสกุล', () => {
    expect(getContactDisplayName({ entity_type: 'individual', company_name: null, first_name: 'สมชาย', last_name: 'ใจดี' })).toBe(
      'สมชาย ใจดี'
    );
  });

  it('นิติบุคคลที่ไม่มีชื่อบริษัท (ข้อมูลไม่ครบ) — คืนค่า "-"', () => {
    expect(getContactDisplayName({ entity_type: 'company', company_name: null, first_name: null, last_name: null })).toBe('-');
  });

  it('บุคคลธรรมดาที่ไม่มีทั้งชื่อและนามสกุล — คืนค่า "-"', () => {
    expect(getContactDisplayName({ entity_type: 'individual', company_name: null, first_name: null, last_name: null })).toBe('-');
  });
});

describe('formatBranchLabel', () => {
  it('สำนักงานใหญ่', () => {
    expect(formatBranchLabel({ branch_type: 'head_office', branch_number: null })).toBe('สำนักงานใหญ่');
  });

  it('สาขาที่ พร้อมเลขสาขา', () => {
    expect(formatBranchLabel({ branch_type: 'branch', branch_number: '00001' })).toBe('สาขาที่ 00001');
  });

  it('สาขาที่ ไม่มีเลขสาขา (ข้อมูลไม่ครบ) — ยังคงแสดงป้าย "สาขาที่" ได้โดยไม่พัง', () => {
    expect(formatBranchLabel({ branch_type: 'branch', branch_number: null })).toBe('สาขาที่');
  });
});

describe('validateContactForm', () => {
  it('ฟอร์มว่างเปล่าต้องมี error หลายฟิลด์', () => {
    const errors = validateContactForm(emptyForm, { existing: [] });
    expect(errors.partner_type).toBeDefined();
    expect(errors.entity_type).toBeDefined();
    expect(errors.contact_code).toBeDefined();
  });

  it('ฟอร์มนิติบุคคลที่ถูกต้องครบ — ไม่มี error', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท เอบีซี จำกัด' },
      { existing: [] }
    );
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('ฟอร์มบุคคลธรรมดาที่ถูกต้องครบ — ไม่มี error', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'individual', first_name: 'สมชาย', last_name: 'ใจดี' },
      { existing: [] }
    );
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('นิติบุคคลไม่กรอกชื่อบริษัท — error เฉพาะ company_name', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company' },
      { existing: [] }
    );
    expect(errors.company_name).toBeDefined();
    expect(errors.first_name).toBeUndefined();
  });

  it('บุคคลธรรมดาไม่กรอกชื่อหรือนามสกุล — error ทั้งคู่', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'individual' },
      { existing: [] }
    );
    expect(errors.first_name).toBeDefined();
    expect(errors.last_name).toBeDefined();
  });

  it('บุคคลธรรมดากรอกแค่ชื่อ ไม่กรอกนามสกุล — error เฉพาะนามสกุล', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'individual', first_name: 'สมชาย' },
      { existing: [] }
    );
    expect(errors.first_name).toBeUndefined();
    expect(errors.last_name).toBeDefined();
  });

  it('รหัสซ้ำกับรายชื่ออื่นที่มีอยู่แล้ว — error', () => {
    const existing = [makeContact({ id: 'existing-1', contact_code: 'CUS0001' })];
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท ใหม่' },
      { existing }
    );
    expect(errors.contact_code).toBeDefined();
  });

  it('รหัสซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ก็ต้อง error เช่นกัน', () => {
    const existing = [makeContact({ id: 'existing-1', contact_code: 'CUS0001' })];
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'cus0001', entity_type: 'company', company_name: 'บริษัท ใหม่' },
      { existing }
    );
    expect(errors.contact_code).toBeDefined();
  });

  it('แก้ไขรายชื่อของตัวเอง — รหัสเดิมไม่ถือว่าซ้ำ (ยกเว้น editingId ออกจากการตรวจสอบ)', () => {
    const existing = [makeContact({ id: 'self-1', contact_code: 'CUS0001' })];
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท เอบีซี จำกัด' },
      { existing, editingId: 'self-1' }
    );
    expect(errors.contact_code).toBeUndefined();
  });

  it('เลขประจำตัวผู้เสียภาษีไม่ครบ 13 หลัก — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        tax_id: '123',
      },
      { existing: [] }
    );
    expect(errors.tax_id).toBeDefined();
  });

  it('เลขประจำตัวผู้เสียภาษีเป็นค่าว่างได้ (ไม่บังคับ)', () => {
    const errors = validateContactForm(
      { ...emptyForm, partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท เอบีซี จำกัด', tax_id: '' },
      { existing: [] }
    );
    expect(errors.tax_id).toBeUndefined();
  });

  it('เลือก "สาขาที่" แต่ไม่กรอกเลขสาขา — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        branch_type: 'branch',
        branch_number: '',
      },
      { existing: [] }
    );
    expect(errors.branch_number).toBeDefined();
  });

  it('เลือก "สาขาที่" กรอกเลขสาขาไม่ครบ 5 หลัก — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        branch_type: 'branch',
        branch_number: '123',
      },
      { existing: [] }
    );
    expect(errors.branch_number).toBeDefined();
  });

  it('เลือก "สาขาที่" กรอกเลขสาขาครบ 5 หลัก — ไม่ error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        branch_type: 'branch',
        branch_number: '00001',
      },
      { existing: [] }
    );
    expect(errors.branch_number).toBeUndefined();
  });

  it('สำนักงานใหญ่ไม่ต้องกรอกเลขสาขา — ไม่ error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        branch_type: 'head_office',
        branch_number: '',
      },
      { existing: [] }
    );
    expect(errors.branch_number).toBeUndefined();
  });

  it('รหัสไปรษณีย์ไม่ครบ 5 หลัก — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        postal_code: '101',
      },
      { existing: [] }
    );
    expect(errors.postal_code).toBeDefined();
  });

  it('อีเมลรูปแบบผิด — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        email: 'ไม่ใช่อีเมล',
      },
      { existing: [] }
    );
    expect(errors.email).toBeDefined();
  });

  it('อีเมลรูปแบบถูกต้อง — ไม่ error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        email: 'contact@example.com',
      },
      { existing: [] }
    );
    expect(errors.email).toBeUndefined();
  });

  it('เบอร์โทรศัพท์มีตัวอักษรปน — error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        phone: '02-abc-4567',
      },
      { existing: [] }
    );
    expect(errors.phone).toBeDefined();
  });

  it('เบอร์โทรศัพท์ที่มีขีด/ช่องว่าง/เครื่องหมายบวก — ไม่ error', () => {
    const errors = validateContactForm(
      {
        ...emptyForm,
        partner_type: 'customer',
        contact_code: 'CUS0001',
        entity_type: 'company',
        company_name: 'บริษัท เอบีซี จำกัด',
        phone: '+66 2-123 4567',
      },
      { existing: [] }
    );
    expect(errors.phone).toBeUndefined();
  });
});

describe('filterContacts', () => {
  const contacts = [
    makeContact({ id: '1', partner_type: 'customer', contact_code: 'CUS0001', company_name: 'ABC จำกัด' }),
    makeContact({
      id: '2',
      partner_type: 'vendor',
      contact_code: 'VEN0001',
      entity_type: 'individual',
      company_name: null,
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      phone: '081-111-2222',
      email: 'somchai@example.com',
      tax_id: '1234567890123',
    }),
    makeContact({ id: '3', partner_type: 'customer', contact_code: 'CUS0002', company_name: 'DEF จำกัด' }),
  ];

  it('กรองตามประเภท', () => {
    expect(filterContacts(contacts, { partnerType: 'customer' })).toHaveLength(2);
    expect(filterContacts(contacts, { partnerType: 'vendor' })).toHaveLength(1);
  });

  it('partnerType "all" คืนค่าทั้งหมด', () => {
    expect(filterContacts(contacts, { partnerType: 'all' })).toHaveLength(3);
  });

  it('ค้นหาจากรหัส', () => {
    expect(filterContacts(contacts, { search: 'CUS0001' })).toHaveLength(1);
  });

  it('ค้นหาจากชื่อบริษัท (ไม่สนตัวพิมพ์เล็กใหญ่)', () => {
    expect(filterContacts(contacts, { search: 'abc' })).toHaveLength(1);
  });

  it('ค้นหาจากชื่อ/นามสกุล', () => {
    expect(filterContacts(contacts, { search: 'สมชาย' })).toHaveLength(1);
    expect(filterContacts(contacts, { search: 'ใจดี' })).toHaveLength(1);
  });

  it('ค้นหาจากเลขประจำตัวผู้เสียภาษี', () => {
    expect(filterContacts(contacts, { search: '1234567890123' })).toHaveLength(1);
  });

  it('ค้นหาจากเบอร์โทรศัพท์', () => {
    expect(filterContacts(contacts, { search: '081-111-2222' })).toHaveLength(1);
  });

  it('ค้นหาจาก Email', () => {
    expect(filterContacts(contacts, { search: 'somchai@example.com' })).toHaveLength(1);
  });

  it('กรองประเภทและค้นหาพร้อมกัน', () => {
    expect(filterContacts(contacts, { partnerType: 'customer', search: 'ABC' })).toHaveLength(1);
    expect(filterContacts(contacts, { partnerType: 'vendor', search: 'ABC' })).toHaveLength(0);
  });

  it('ค้นหาคำที่ไม่พบคืนค่าว่าง', () => {
    expect(filterContacts(contacts, { search: 'ไม่มีทางเจอ' })).toHaveLength(0);
  });
});

describe('computeContactCounts', () => {
  it('นับจำนวนตามประเภทได้ถูกต้อง (รวมทุกสถานะ)', () => {
    const contacts = [
      makeContact({ id: '1', partner_type: 'customer', status: 'active' }),
      makeContact({ id: '2', partner_type: 'customer', status: 'inactive' }),
      makeContact({ id: '3', partner_type: 'vendor', status: 'active' }),
    ];
    const counts = computeContactCounts(contacts);
    expect(counts.all).toBe(3);
    expect(counts.customer).toBe(2);
    expect(counts.vendor).toBe(1);
  });

  it('ไม่มีรายชื่อเลย — ทุกค่าเป็นศูนย์', () => {
    expect(computeContactCounts([])).toEqual({ all: 0, customer: 0, vendor: 0 });
  });
});

describe('label maps ครบทุกค่าของ enum', () => {
  it('PARTNER_TYPE_LABELS ครบทั้ง 2 ประเภท', () => {
    expect(Object.keys(PARTNER_TYPE_LABELS).sort()).toEqual(['customer', 'vendor']);
  });

  it('ENTITY_TYPE_LABELS ครบทั้ง 2 ประเภท', () => {
    expect(Object.keys(ENTITY_TYPE_LABELS).sort()).toEqual(['company', 'individual']);
  });

  it('CONTACT_STATUS_LABELS ครบทั้ง 2 สถานะ', () => {
    expect(Object.keys(CONTACT_STATUS_LABELS).sort()).toEqual(['active', 'inactive']);
  });
});
