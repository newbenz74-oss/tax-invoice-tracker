import { describe, expect, it } from 'vitest';
import { validateCompanySettingsForm } from './companyLogic';
import type { CompanySettingsInput } from './companyApi';

const emptyForm: CompanySettingsInput = {
  tax_id: '',
  branch_type: 'head_office',
  branch_number: '',
  address: '',
  subdistrict: '',
  district: '',
  province: '',
  postal_code: '',
  default_signer_name: '',
  email: '',
};

describe('validateCompanySettingsForm', () => {
  it('ฟอร์มว่างเปล่าไม่มี error (ทุกฟิลด์ไม่บังคับกรอกยกเว้นเลขที่สาขาตอนเลือกสาขา)', () => {
    const errors = validateCompanySettingsForm(emptyForm);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('ปฏิเสธเลขผู้เสียภาษีที่ไม่ครบ 13 หลัก', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, tax_id: '123' });
    expect(errors.tax_id).toBeDefined();
  });

  it('ยอมรับเลขผู้เสียภาษี 13 หลักที่ถูกต้อง', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, tax_id: '0125566036499' });
    expect(errors.tax_id).toBeUndefined();
  });

  it('เลือก "สาขา" แต่ไม่กรอกเลขที่สาขา — error', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, branch_type: 'branch' });
    expect(errors.branch_number).toBeDefined();
  });

  it('เลือก "สาขา" กรอกเลขที่สาขาไม่ครบ 5 หลัก — error', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, branch_type: 'branch', branch_number: '123' });
    expect(errors.branch_number).toBeDefined();
  });

  it('เลือก "สาขา" กรอกเลขที่สาขาถูกต้อง — ไม่ error', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, branch_type: 'branch', branch_number: '00001' });
    expect(errors.branch_number).toBeUndefined();
  });

  it('เลือก "สำนักงานใหญ่" ไม่ต้องกรอกเลขที่สาขา — ไม่ error', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, branch_type: 'head_office' });
    expect(errors.branch_number).toBeUndefined();
  });

  it('ปฏิเสธรหัสไปรษณีย์ที่ไม่ครบ 5 หลัก', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, postal_code: '111' });
    expect(errors.postal_code).toBeDefined();
  });

  it('ยอมรับรหัสไปรษณีย์ 5 หลักที่ถูกต้อง', () => {
    const errors = validateCompanySettingsForm({ ...emptyForm, postal_code: '11140' });
    expect(errors.postal_code).toBeUndefined();
  });
});

/** อีเมลบริษัท (เพิ่มเข้ามา 2026-10-11) — ค่านี้ถูกใส่เป็น CC ของอีเมลใบหัก ณ ที่จ่ายทุกฉบับ ถ้าพิมพ์ผิดจะทำให้
 * "ส่งไม่ออกทั้งฉบับ" ไม่ใช่แค่สำเนาไม่ถึง จึงต้องดักตั้งแต่หน้าตั้งค่า */
describe('validateCompanySettingsForm — อีเมลบริษัท', () => {
  it('เว้นว่างได้ ไม่ใช่ช่องบังคับ', () => {
    expect(validateCompanySettingsForm({ ...emptyForm, email: '' }).email).toBeUndefined();
    expect(validateCompanySettingsForm({ ...emptyForm, email: '   ' }).email).toBeUndefined();
  });

  it('ยอมรับอีเมลที่ใช้งานได้จริง', () => {
    for (const email of ['accounting@company.co.th', 'a.b-c+tag@sub.domain.com', 'ฝ่ายบัญชี@บริษัท.ไทย']) {
      expect(validateCompanySettingsForm({ ...emptyForm, email }).email).toBeUndefined();
    }
  });

  it('ปฏิเสธรูปแบบที่ผิดชัดเจน', () => {
    for (const email of ['accounting', 'accounting@', '@company.co.th', 'a b@company.co.th', 'a@b']) {
      expect(validateCompanySettingsForm({ ...emptyForm, email }).email).toBe(
        'รูปแบบอีเมลไม่ถูกต้อง เช่น accounting@company.co.th'
      );
    }
  });

  it('ตัดช่องว่างหัวท้ายก่อนตรวจ (ผู้ใช้ก๊อปมาวางมักติดช่องว่างมาด้วย)', () => {
    expect(validateCompanySettingsForm({ ...emptyForm, email: '  accounting@company.co.th  ' }).email).toBeUndefined();
  });
});
