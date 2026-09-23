import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWhtCertificateEmailContent, isEmailSendConfigured, shouldVerifyTlsCertificate } from './whtCertificateEmail';

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

/**
 * เทสต์ชุดนี้คุมพฤติกรรมความปลอดภัยที่แก้เมื่อ 2026-09-23 — เดิมโค้ดตั้ง tls.rejectUnauthorized = false ตายตัว
 * ซึ่งแปลว่ายอมรับใบรับรองปลอมจากใครก็ได้ที่แทรกกลางเส้นทาง (รหัส App Password ของ Gmail หลุดไปกับการ
 * เชื่อมต่อนั้นได้เลย) โค้ดชุดเดียวกันนี้รันบน Vercel ด้วย ไม่ใช่แค่เครื่อง dev
 *
 * กฎที่ต้องไม่ถูกทำให้หลวมลงโดยไม่ตั้งใจในอนาคต: บน production ต้องตรวจใบรับรองเสมอ ต่อให้มีคนเผลอไปตั้ง
 * SMTP_ALLOW_SELF_SIGNED=true ที่ Vercel ไว้ก็ตาม
 */
describe('shouldVerifyTlsCertificate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ตรวจใบรับรองเสมอถ้าไม่ได้ตั้ง SMTP_ALLOW_SELF_SIGNED ไว้', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SMTP_ALLOW_SELF_SIGNED', '');
    expect(shouldVerifyTlsCertificate()).toBe(true);
  });

  it('ยอมข้ามการตรวจได้เฉพาะตอน dev และต้องตั้ง SMTP_ALLOW_SELF_SIGNED=true ตรงตัวเท่านั้น', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SMTP_ALLOW_SELF_SIGNED', 'true');
    expect(shouldVerifyTlsCertificate()).toBe(false);
  });

  it('ค่าอื่นที่ไม่ใช่ "true" เป๊ะๆ ไม่ปิดการตรวจ (เช่น "1"/"yes" ที่คนมักพิมพ์)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SMTP_ALLOW_SELF_SIGNED', '1');
    expect(shouldVerifyTlsCertificate()).toBe(true);
  });

  it('บน production ตรวจใบรับรองเสมอ แม้จะตั้ง SMTP_ALLOW_SELF_SIGNED=true ไว้', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_ALLOW_SELF_SIGNED', 'true');
    expect(shouldVerifyTlsCertificate()).toBe(true);
  });
});
