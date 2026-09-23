import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * เทสต์ route ส่งอีเมลใบหัก ณ ที่จ่าย (เพิ่มเข้ามา 2026-09-23 — เดิม route นี้ไม่มีเทสต์เลยแม้แต่ตัวเดียว)
 *
 * เน้นคุมพฤติกรรม 3 อย่างที่เพิ่ง fix รอบนี้ ซึ่งทั้งหมดเป็นเรื่องที่ "พังแล้วไม่มีใครรู้" ถ้าไม่มีเทสต์:
 *   1. ใบที่ถูกยกเลิกแล้วต้องส่งไม่ได้ (เดิมกันไว้แค่ที่ UI ซึ่งข้ามได้ด้วยการยิง API ตรง)
 *   2. ทุกครั้งที่กดส่งต้องถูกบันทึกลงประวัติ ทั้งที่สำเร็จและล้มเหลว (เดิมบันทึกเฉพาะตอนสำเร็จ)
 *   3. ข้อความ error ดิบจาก SMTP ต้องไม่หลุดกลับไปที่หน้าเว็บ แต่ต้องถูกเก็บลงประวัติให้ผู้ดูแลระบบอ่านได้
 *
 * mock Supabase ทั้งตัวเพราะ route นี้คุยกับฐานข้อมูลจริงล้วนๆ — สิ่งที่อยากทดสอบคือ "ลำดับการตัดสินใจ"
 * ของ route (เช็คอะไรก่อน ปฏิเสธด้วยรหัสอะไร บันทึกอะไรลงไป) ไม่ใช่ตัว RLS หรือ SQL ซึ่งมีเทสต์คนละชั้น
 */

const mocks = vi.hoisted(() => ({
  isEmailSendConfigured: vi.fn(),
  sendWhtCertificateEmail: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/whtCertificateEmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whtCertificateEmail')>();
  return {
    ...actual,
    isEmailSendConfigured: mocks.isEmailSendConfigured,
    sendWhtCertificateEmail: mocks.sendWhtCertificateEmail,
  };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

const { POST } = await import('./route');

const CERT_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

const VALID_PDF_BASE64 = Buffer.from('%PDF-1.4\nจำลองไฟล์ PDF สำหรับเทสต์\n%%EOF').toString('base64');

interface StubOptions {
  certStatus?: 'issued' | 'voided';
  certMissing?: boolean;
  partnerEmail?: string | null;
}

interface StubResult {
  sendLogInserts: Record<string, unknown>[];
  certUpdates: Record<string, unknown>[];
}

/** สร้าง Supabase client ปลอมที่ตอบเฉพาะ query ที่ route นี้ยิงจริง — คืน array ที่เก็บสิ่งที่ถูกเขียนลงไป
 * เพื่อให้เทสต์ตรวจได้ว่า "บันทึกประวัติแล้วจริงไหม บันทึกอะไรลงไป" */
function stubSupabase(options: StubOptions = {}): StubResult {
  const { certStatus = 'issued', certMissing = false, partnerEmail = 'payee@example.com' } = options;
  const result: StubResult = { sendLogInserts: [], certUpdates: [] };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: ACTOR_ID, email: 'actor@example.com' } }, error: null }),
    },
    from(table: string) {
      if (table === 'wht_certificates') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                certMissing
                  ? { data: null, error: { message: 'not found' } }
                  : {
                      data: {
                        id: CERT_ID,
                        cert_number: '53-6904002',
                        payee_name: 'บริษัท เอ็น วาย ฟิล์ม จำกัด',
                        business_partner_id: PARTNER_ID,
                        company_id: COMPANY_ID,
                        status: certStatus,
                      },
                      error: null,
                    },
            }),
          }),
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              result.certUpdates.push(values);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'business_partners') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { email: partnerEmail }, error: null }) }) }) };
      }
      if (table === 'companies') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'บริษัท ซีบีซอฟท์ จำกัด' }, error: null }) }) }) };
      }
      if (table === 'wht_certificate_send_logs') {
        return {
          insert: async (row: Record<string, unknown>) => {
            result.sendLogInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`เทสต์ยังไม่ได้เตรียม stub ของตาราง ${table}`);
    },
  };

  mocks.createClient.mockReturnValue(client);
  return result;
}

function makeRequest(body: unknown, withAuth = true): Request {
  return new Request('http://localhost/api/wht-certificate/send', {
    method: 'POST',
    headers: withAuth ? { Authorization: 'Bearer test-access-token' } : {},
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { certId: CERT_ID, pdfBase64: VALID_PDF_BASE64, filename: 'cert.pdf' };

beforeEach(() => {
  mocks.isEmailSendConfigured.mockReset().mockReturnValue(true);
  mocks.sendWhtCertificateEmail.mockReset().mockResolvedValue(undefined);
  mocks.createClient.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/wht-certificate/send — ด่านตรวจก่อนส่ง', () => {
  it('คืน 503 ถ้ายังไม่ได้ตั้งค่า GMAIL_USER/GMAIL_APP_PASSWORD (เช็คก่อนแตะฐานข้อมูลด้วยซ้ำ)', async () => {
    mocks.isEmailSendConfigured.mockReturnValue(false);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'not_configured' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('คืน 401 ถ้าไม่มี Bearer token', async () => {
    const res = await POST(makeRequest(VALID_BODY, false));
    expect(res.status).toBe(401);
    expect(mocks.sendWhtCertificateEmail).not.toHaveBeenCalled();
  });

  it('คืน 403 ถ้าหาใบไม่เจอหรือไม่มีสิทธิ์ (RLS กรองออก) และไม่บันทึกประวัติ เพราะยังไม่รู้ด้วยซ้ำว่าเป็นบริษัทไหน', async () => {
    const db = stubSupabase({ certMissing: true });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(db.sendLogInserts).toHaveLength(0);
    expect(mocks.sendWhtCertificateEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/wht-certificate/send — ใบที่ถูกยกเลิกแล้ว', () => {
  it('ปฏิเสธด้วย 409 ไม่ส่งอีเมล และบันทึกความพยายามนั้นลงประวัติ', async () => {
    const db = stubSupabase({ certStatus: 'voided' });
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'certificate_voided' });
    // สำคัญที่สุดของเทสต์นี้: ต้องไม่มีอีเมลออกไปหาผู้ถูกหักภาษีเด็ดขาด เพราะเขาอาจเอาไปยื่นภาษีจริง
    expect(mocks.sendWhtCertificateEmail).not.toHaveBeenCalled();
    expect(db.sendLogInserts).toHaveLength(1);
    expect(db.sendLogInserts[0]).toMatchObject({
      certificate_id: CERT_ID,
      company_id: COMPANY_ID,
      status: 'failed',
      error_code: 'certificate_voided',
      actor_id: ACTOR_ID,
      actor_email: 'actor@example.com',
    });
  });
});

describe('POST /api/wht-certificate/send — กรณีที่ส่งไม่ออก', () => {
  it('ผู้ขายยังไม่มีอีเมลในสมุดรายชื่อ: 400 + บันทึกประวัติโดย sent_to เป็น null (ยังไม่รู้ปลายทาง)', async () => {
    const db = stubSupabase({ partnerEmail: null });
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'no_recipient_email' });
    expect(db.sendLogInserts[0]).toMatchObject({ status: 'failed', error_code: 'no_recipient_email', sent_to: null });
  });

  it('ไฟล์แนบไม่ใช่ PDF จริง: 400 + บันทึกประวัติ และไม่ส่งอะไรออกจากอีเมลบริษัท', async () => {
    const db = stubSupabase();
    const notPdf = Buffer.from('<html>ไม่ใช่ PDF</html>').toString('base64');
    const res = await POST(makeRequest({ ...VALID_BODY, pdfBase64: notPdf }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_pdf' });
    expect(mocks.sendWhtCertificateEmail).not.toHaveBeenCalled();
    expect(db.sendLogInserts[0]).toMatchObject({ status: 'failed', error_code: 'invalid_pdf' });
  });

  it('SMTP ล้มเหลว: 502 โดยไม่หลุดข้อความดิบกลับไปหน้าเว็บ แต่เก็บลงประวัติให้ผู้ดูแลระบบอ่านได้', async () => {
    const db = stubSupabase();
    mocks.sendWhtCertificateEmail.mockRejectedValue(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'));
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(502);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe('send_failed');
    expect(data.message).toBeUndefined(); // เดิม route ส่ง err.message กลับมาด้วย ขัดกับคอมเมนต์ของตัวเอง

    expect(db.sendLogInserts[0]).toMatchObject({
      status: 'failed',
      error_code: 'send_failed',
      sent_to: 'payee@example.com',
    });
    expect(String(db.sendLogInserts[0].error_message)).toContain('Username and Password not accepted');
    // ส่งไม่สำเร็จต้องไม่ไปแตะ email_sent_at ของใบ ไม่งั้นตารางจะโชว์ว่า "ส่งแล้ว" ทั้งที่ไม่ถึงผู้รับ
    expect(db.certUpdates).toHaveLength(0);
  });

  it('ตัดข้อความ error ที่ยาวมากก่อนเขียนลงฐานข้อมูล (กันแถวประวัติบวมจนหน้า UI โหลดช้า)', async () => {
    const db = stubSupabase();
    mocks.sendWhtCertificateEmail.mockRejectedValue(new Error('x'.repeat(5000)));
    await POST(makeRequest(VALID_BODY));
    expect(String(db.sendLogInserts[0].error_message)).toHaveLength(500);
  });
});

describe('POST /api/wht-certificate/send — ส่งสำเร็จ', () => {
  it('ส่งอีเมล อัปเดตวันที่ส่งล่าสุด และบันทึกประวัติเป็น success', async () => {
    const db = stubSupabase();
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, sentTo: 'payee@example.com' });

    // ปลายทางต้องมาจากฐานข้อมูลเสมอ ไม่ใช่ค่าที่ client ส่งมา (client ไม่ได้ส่ง to มาด้วยซ้ำ)
    expect(mocks.sendWhtCertificateEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhtCertificateEmail.mock.calls[0][0]).toMatchObject({ to: 'payee@example.com', filename: 'cert.pdf' });

    expect(db.certUpdates).toHaveLength(1);
    expect(db.certUpdates[0]).toMatchObject({ email_sent_to: 'payee@example.com' });

    expect(db.sendLogInserts).toHaveLength(1);
    expect(db.sendLogInserts[0]).toMatchObject({
      status: 'success',
      sent_to: 'payee@example.com',
      error_code: null,
      error_message: null,
    });
  });

  it('หัวเรื่องอีเมลมีเลขที่ใบจริงเสมอ (ประกอบจากข้อมูลในฐานข้อมูล ไม่ใช่จาก client)', async () => {
    stubSupabase();
    await POST(makeRequest(VALID_BODY));
    expect(mocks.sendWhtCertificateEmail.mock.calls[0][0].subject).toContain('53-6904002');
  });
});
