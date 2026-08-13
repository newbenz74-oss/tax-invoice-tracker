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
