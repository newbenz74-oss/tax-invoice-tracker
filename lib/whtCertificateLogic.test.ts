import { describe, expect, it } from 'vitest';
import {
  buildPayeeSnapshot,
  buildPayerSnapshot,
  findPayeeCandidates,
  formTypeForEntityType,
  formatWhtCertNumber,
} from './whtCertificateLogic';
import type { Company } from './companyApi';
import type { BusinessPartner } from '@/types/contact';

const testCompany: Company = {
  id: 'company-1',
  name: 'บริษัท ซีบีซอฟท์ จำกัด',
  tax_id: '0125566036499',
  branch_type: 'head_office',
  branch_number: null,
  address: 'เลขที่ 98/402 หมู่ 4',
  subdistrict: 'ตำบลบางใหญ่',
  district: 'อำเภอบางใหญ่',
  province: 'จังหวัดนนทบุรี',
  postal_code: '11140',
  default_signer_name: 'SAKKARIN',
  logo_url: null,
};

function makePartner(overrides: Partial<BusinessPartner>): BusinessPartner {
  return {
    id: 'partner-1',
    company_id: 'company-1',
    partner_type: 'vendor',
    contact_code: 'VEN0001',
    entity_type: 'company',
    company_name: 'บริษัท เอ็น วาย ฟิล์ม จำกัด',
    first_name: null,
    last_name: null,
    tax_id: '0105538041181',
    branch_type: 'head_office',
    branch_number: null,
    address: 'เลขที่ 3 ซอย ราชพฤกษ์ 4',
    subdistrict: 'แขวงบางจาก',
    district: 'เขตภาษีเจริญ',
    province: 'กรุงเทพมหานคร',
    postal_code: '10160',
    phone: null,
    email: null,
    contact_person: null,
    note: null,
    status: 'active',
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('formTypeForEntityType', () => {
  it('นิติบุคคล -> รหัสฟอร์ม 53', () => {
    expect(formTypeForEntityType('company')).toBe('53');
  });

  it('บุคคลธรรมดา -> รหัสฟอร์ม 03', () => {
    expect(formTypeForEntityType('individual')).toBe('03');
  });
});

describe('formatWhtCertNumber', () => {
  it('ประกอบเลขที่ตามตัวอย่างที่ผู้ใช้ระบุ (53-6908001)', () => {
    expect(formatWhtCertNumber('53', 2569, 8, 1)).toBe('53-6908001');
  });

  it('ประกอบเลขที่ตามตัวอย่างไฟล์จริงที่ผู้ใช้ส่งมา (53-6904002)', () => {
    expect(formatWhtCertNumber('53', 2569, 4, 2)).toBe('53-6904002');
  });

  it('รหัสฟอร์ม 03 (บุคคลธรรมดา)', () => {
    expect(formatWhtCertNumber('03', 2569, 8, 1)).toBe('03-6908001');
  });

  it('เดือนเลขหลักเดียว เติม 0 นำหน้าเป็น 2 หลักเสมอ', () => {
    expect(formatWhtCertNumber('53', 2569, 1, 1)).toBe('53-6901001');
  });

  it('ลำดับที่เกิน 99 ยังคง padding ถูกต้อง (3 หลักขึ้นไป)', () => {
    expect(formatWhtCertNumber('53', 2569, 8, 123)).toBe('53-6908123');
  });

  it('ลำดับที่เกิน 999 ไม่ตัดทอน (แสดงเกิน 3 หลักตามจริง แทนที่จะโกหกเลขที่)', () => {
    expect(formatWhtCertNumber('53', 2569, 8, 1000)).toBe('53-69081000');
  });

  it('ตัดปี พ.ศ. เต็ม 4 หลัก เหลือ 2 หลักท้ายเสมอ', () => {
    expect(formatWhtCertNumber('53', 2570, 12, 5)).toBe('53-7012005');
  });
});

describe('buildPayerSnapshot', () => {
  it('คัดลอกฟิลด์จาก Company ตรงๆ ตามชื่อฟิลด์เดียวกัน', () => {
    expect(buildPayerSnapshot(testCompany)).toEqual({
      name: 'บริษัท ซีบีซอฟท์ จำกัด',
      tax_id: '0125566036499',
      branch_type: 'head_office',
      branch_number: null,
      address: 'เลขที่ 98/402 หมู่ 4',
      subdistrict: 'ตำบลบางใหญ่',
      district: 'อำเภอบางใหญ่',
      province: 'จังหวัดนนทบุรี',
      postal_code: '11140',
    });
  });
});

describe('buildPayeeSnapshot', () => {
  it('นิติบุคคล — ใช้ company_name เป็นชื่อ (ผ่าน getContactDisplayName)', () => {
    const snapshot = buildPayeeSnapshot(makePartner({}));
    expect(snapshot.name).toBe('บริษัท เอ็น วาย ฟิล์ม จำกัด');
    expect(snapshot.entity_type).toBe('company');
    expect(snapshot.tax_id).toBe('0105538041181');
  });

  it('บุคคลธรรมดา — ใช้ชื่อ+นามสกุลรวมกัน', () => {
    const snapshot = buildPayeeSnapshot(
      makePartner({ entity_type: 'individual', company_name: null, first_name: 'สมชาย', last_name: 'ใจดี' })
    );
    expect(snapshot.name).toBe('สมชาย ใจดี');
    expect(snapshot.entity_type).toBe('individual');
  });
});

describe('findPayeeCandidates', () => {
  it('จับคู่ชื่อตรงกันเป๊ะๆ -> เจอ 1 รายการ', () => {
    const contacts = [makePartner({ id: 'p1' })];
    expect(findPayeeCandidates('บริษัท เอ็น วาย ฟิล์ม จำกัด', contacts)).toEqual([contacts[0]]);
  });

  it('ไม่มีชื่อตรงกันเลย -> array ว่าง', () => {
    const contacts = [makePartner({ id: 'p1' })];
    expect(findPayeeCandidates('บริษัท ไม่มีจริง จำกัด', contacts)).toEqual([]);
  });

  it('ชื่อว่าง (trim แล้วว่าง) -> array ว่างเสมอ ไม่จับคู่มั่วๆ', () => {
    const contacts = [makePartner({ id: 'p1', entity_type: 'individual', company_name: null })];
    expect(findPayeeCandidates('   ', contacts)).toEqual([]);
  });

  it('ไม่จับคู่ partner_type customer แม้ชื่อตรงกัน', () => {
    const contacts = [makePartner({ id: 'p1', partner_type: 'customer' })];
    expect(findPayeeCandidates('บริษัท เอ็น วาย ฟิล์ม จำกัด', contacts)).toEqual([]);
  });

  it('ไม่จับคู่รายชื่อที่ปิดใช้งาน (status inactive)', () => {
    const contacts = [makePartner({ id: 'p1', status: 'inactive' })];
    expect(findPayeeCandidates('บริษัท เอ็น วาย ฟิล์ม จำกัด', contacts)).toEqual([]);
  });

  it('ชื่อซ้ำกันในสมุดรายชื่อ -> คืนทั้งหมดที่ตรง (ให้ผู้ใช้เลือกเอง)', () => {
    const contacts = [makePartner({ id: 'p1' }), makePartner({ id: 'p2', contact_code: 'VEN0002' })];
    expect(findPayeeCandidates('บริษัท เอ็น วาย ฟิล์ม จำกัด', contacts)).toHaveLength(2);
  });

  it('ตัดช่องว่างหน้า-หลังของ vendor_name ก่อนเทียบ', () => {
    const contacts = [makePartner({ id: 'p1' })];
    expect(findPayeeCandidates('  บริษัท เอ็น วาย ฟิล์ม จำกัด  ', contacts)).toEqual([contacts[0]]);
  });
});
