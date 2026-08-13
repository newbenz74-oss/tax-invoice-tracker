import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWhtCertificateEmailContent, isEmailSendConfigured } from './whtCertificateEmail';

describe('isEmailSendConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('คืนค่า false ถ้ายังไม่ได้ตั้งค่า env ทั้งสองตัว', () => {
    vi.stubEnv('GMAIL_USER', '');
    vi.stubEnv('GMAIL_APP_PASSWORD', '');
    expect(isEmailSendConfigured()).toBe(false);
  });

  it('คืนค่า false ถ้ามีแค่ GMAIL_USER แต่ไม่มี GMAIL_APP_PASSWORD', () => {
    vi.stubEnv('GMAIL_USER', 'test@gmail.com');
    vi.stubEnv('GMAIL_APP_PASSWORD', '');
    expect(isEmailSendConfigured()).toBe(false);
  });

  it('คืนค่า true ถ้ามีครบทั้งสองตัว', () => {
    vi.stubEnv('GMAIL_USER', 'test@gmail.com');
    vi.stubEnv('GMAIL_APP_PASSWORD', 'app-password-here');
    expect(isEmailSendConfigured()).toBe(true);
  });
});

describe('buildWhtCertificateEmailContent', () => {
  it('ใส่เลขที่ใบ/ชื่อผู้รับ/ชื่อบริษัทลงในหัวเรื่องและเนื้อหาถูกต้อง', () => {
    const { subject, text } = buildWhtCertificateEmailContent('53-6904002', 'บริษัท เอ็น วาย ฟิล์ม จำกัด', 'บริษัท ซีบีซอฟท์ จำกัด');
    expect(subject).toContain('53-6904002');
    expect(text).toContain('บริษัท เอ็น วาย ฟิล์ม จำกัด');
    expect(text).toContain('บริษัท ซีบีซอฟท์ จำกัด');
    expect(text).toContain('53-6904002');
  });
});
