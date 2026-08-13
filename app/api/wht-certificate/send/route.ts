import { createClient } from '@supabase/supabase-js';
import { buildWhtCertificateEmailContent, isEmailSendConfigured, sendWhtCertificateEmail } from '@/lib/whtCertificateEmail';

/**
 * Route Handler ส่งอีเมลใบหัก ณ ที่จ่าย (เพิ่มเข้ามา 2026-08-11) — client (WhtCertificateHistoryPage.tsx)
 * สร้าง PDF เองฝั่ง browser ด้วย buildWhtCertificatePdf ตัวเดิม (โค้ดเดียวกับปุ่ม "ดาวน์โหลด PDF" เป๊ะๆ ไม่มี
 * โค้ดสร้าง PDF ซ้ำซ้อนฝั่ง server) แล้วส่งไบต์มาเป็น base64 — endpoint นี้แค่ตรวจสิทธิ์ + หาอีเมลผู้รับจริง
 * จากฐานข้อมูล (ไม่เชื่อที่อยู่อีเมลที่ client ส่งมาโดยตรง กันกรณีมีคนแก้ request เปลี่ยนปลายทาง) + ส่ง SMTP
 *
 * ตรวจสิทธิ์ด้วยการสร้าง Supabase client ใหม่ฝั่ง server ผูก Authorization header ของผู้เรียก (access_token
 * จาก session ฝั่ง client) แล้ว query ผ่าน client ตัวนี้ตรงๆ — RLS ปกติของตาราง wht_certificates/
 * business_partners/companies (is_company_member) จะกรองให้อยู่แล้วว่าเห็นได้แค่ข้อมูลบริษัทตัวเอง ไม่ต้อง
 * เขียนเช็คสิทธิ์ซ้ำเองที่ชั้นนี้ — ถ้า query ไม่เจอแถวเลย แปลว่าไม่มีสิทธิ์ (หรือไม่มีอยู่จริง) ปฏิเสธเหมือนกัน
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// กันไฟล์แนบใหญ่เกินไปโดยไม่ตั้งใจ (Gmail เองก็จำกัดไฟล์แนบรวมไว้ที่ 25MB) — PDF ใบหัก ณ ที่จ่ายจริงมีขนาด
// แค่หลักหมื่น-แสนไบต์เท่านั้น (~100KB) ต่อให้แนบหน้ารายละเอียดหลายสิบรายการก็ยังห่างไกลจากขีดจำกัดนี้มาก
const MAX_PDF_BASE64_LENGTH = 8 * 1024 * 1024; // ~6MB หลัง decode

interface SendRequestBody {
  certId?: unknown;
  pdfBase64?: unknown;
  filename?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!isEmailSendConfigured()) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!accessToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: SendRequestBody;
  try {
    body = (await request.json()) as SendRequestBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const certId = typeof body.certId === 'string' ? body.certId.trim() : '';
  const pdfBase64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64 : '';
  const filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : 'wht-certificate.pdf';

  if (!certId || !pdfBase64) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (pdfBase64.length > MAX_PDF_BASE64_LENGTH) {
    return Response.json({ error: 'file_too_large' }, { status: 413 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: cert, error: certError } = await supabase
    .from('wht_certificates')
    .select('id, cert_number, payee_name, business_partner_id, company_id')
    .eq('id', certId)
    .single();

  if (certError || !cert) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const [{ data: partner }, { data: company }] = await Promise.all([
    supabase.from('business_partners').select('email').eq('id', cert.business_partner_id).single(),
    supabase.from('companies').select('name').eq('id', cert.company_id).single(),
  ]);

  const recipientEmail = partner?.email?.trim();
  if (!recipientEmail) {
    return Response.json({ error: 'no_recipient_email' }, { status: 400 });
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = Buffer.from(pdfBase64, 'base64');
  } catch {
    return Response.json({ error: 'invalid_pdf' }, { status: 400 });
  }
  if (pdfBuffer.length === 0) {
    return Response.json({ error: 'invalid_pdf' }, { status: 400 });
  }

  const { subject, text } = buildWhtCertificateEmailContent(cert.cert_number, cert.payee_name, company?.name ?? '');

  try {
    await sendWhtCertificateEmail({ to: recipientEmail, subject, text, filename, pdfBuffer });
  } catch (err) {
    // พิมพ์ error จริงจาก nodemailer ออก terminal ฝั่ง server เสมอ (เช่น "Invalid login", "Username and
    // Password not accepted" ฯลฯ) — ไม่ส่งข้อความนี้ตรงๆ กลับไปโชว์ที่หน้าเว็บ (อาจมีรายละเอียดเทคนิคที่ไม่
    // ควรโชว์ผู้ใช้ทั่วไป) แต่จำเป็นมากสำหรับ debug ตอนตั้งค่าครั้งแรก
    console.error('[wht-certificate/send] ส่งอีเมลไม่สำเร็จ:', err);
    return Response.json({ error: 'send_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  // บันทึกว่าส่งไปแล้วเมื่อไร/ถึงใคร (เพิ่มเข้ามาตามที่ผู้ใช้ขอ 2026-08-11 — ดู migration_017) เขียนหลัง
  // ส่งอีเมลสำเร็จเท่านั้น ถ้าอัปเดตแถวนี้ไม่สำเร็จก็ไม่ถือว่าทั้ง request ล้มเหลว (อีเมลถึงผู้รับแล้วจริง
  // แก้ไม่ได้แล้ว แค่ "วันที่ส่งล่าสุด" ที่โชว์ในตารางจะไม่อัปเดตรอบนี้เฉยๆ ไม่กระทบการทำงานหลัก)
  const sentAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('wht_certificates')
    .update({ email_sent_at: sentAt, email_sent_to: recipientEmail })
    .eq('id', certId);
  if (updateError) {
    console.error('[wht-certificate/send] ส่งอีเมลสำเร็จ แต่บันทึกวันที่ส่งไม่สำเร็จ:', updateError);
  }

  return Response.json({ ok: true, sentTo: recipientEmail, sentAt });
}
