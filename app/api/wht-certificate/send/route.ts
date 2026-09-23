import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildWhtCertificateEmailContent, isEmailSendConfigured, sendWhtCertificateEmail } from '@/lib/whtCertificateEmail';

/**
 * Route Handler ส่งอีเมลใบหัก ณ ที่จ่าย (เพิ่มเข้ามา 2026-08-11) — client (WhtCertificateHistoryPage.tsx)
 * สร้าง PDF เองฝั่ง browser ด้วย buildWhtCertificatePdfForEmail (โค้ดเดียวกับปุ่ม "ดาวน์โหลด PDF" ไม่มีโค้ด
 * สร้าง PDF ซ้ำซ้อนฝั่ง server) แล้วส่งไบต์มาเป็น base64 — endpoint นี้แค่ตรวจสิทธิ์ + หาอีเมลผู้รับจริงจาก
 * ฐานข้อมูล (ไม่เชื่อที่อยู่อีเมลที่ client ส่งมาโดยตรง กันกรณีมีคนแก้ request เปลี่ยนปลายทาง) + ส่ง SMTP
 *
 * ตรวจสิทธิ์ด้วยการสร้าง Supabase client ใหม่ฝั่ง server ผูก Authorization header ของผู้เรียก (access_token
 * จาก session ฝั่ง client) แล้ว query ผ่าน client ตัวนี้ตรงๆ — RLS ปกติของตาราง wht_certificates/
 * business_partners/companies (is_company_member) จะกรองให้อยู่แล้วว่าเห็นได้แค่ข้อมูลบริษัทตัวเอง ไม่ต้อง
 * เขียนเช็คสิทธิ์ซ้ำเองที่ชั้นนี้ — ถ้า query ไม่เจอแถวเลย แปลว่าไม่มีสิทธิ์ (หรือไม่มีอยู่จริง) ปฏิเสธเหมือนกัน
 *
 * ปรับปรุงรอบ 2026-09-23 (ดู supabase/migration_029_wht_send_logs.sql):
 *   - บันทึกทุกครั้งที่พยายามส่งลง wht_certificate_send_logs ทั้งที่สำเร็จและล้มเหลว (เดิมบันทึกเฉพาะตอน
 *     สำเร็จ ครั้งที่ล้มเหลวหายไปเงียบๆ เหลือแค่ console.error ที่ terminal ซึ่งผู้ใช้ไม่มีทางเห็น)
 *   - ปฏิเสธใบที่ถูกยกเลิกแล้ว (status = 'voided') ที่ชั้น API ด้วย เดิมกันไว้แค่ที่ UI (ซ่อนปุ่ม) ซึ่งข้ามได้
 *     ด้วยการยิง API ตรงๆ — ใบที่ยกเลิกแล้วไม่ควรถูกส่งออกไปหาผู้ถูกหักภาษีเด็ดขาด
 *   - ตรวจว่าไฟล์แนบเป็น PDF จริงด้วยเลขนำหน้าไฟล์ (%PDF-) เดิมรับ base64 อะไรก็ได้แล้วแนบส่งออกจากอีเมล
 *     บริษัทเลย
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// กันไฟล์แนบใหญ่เกินไปโดยไม่ตั้งใจ (Gmail เองก็จำกัดไฟล์แนบรวมไว้ที่ 25MB) — PDF ใบหัก ณ ที่จ่ายจริงมีขนาด
// แค่หลักหมื่น-แสนไบต์เท่านั้น (~100KB) ต่อให้แนบหน้ารายละเอียดหลายสิบรายการก็ยังห่างไกลจากขีดจำกัดนี้มาก
const MAX_PDF_BASE64_LENGTH = 8 * 1024 * 1024; // ~6MB หลัง decode

// ตัดข้อความ error ก่อนเขียนลงฐานข้อมูล — ข้อความจาก SMTP บางตัวยาวมาก (มี stack/raw response ติดมาด้วย)
// เก็บแค่ส่วนต้นก็พอไล่ปัญหาได้แล้ว และกันไม่ให้แถวประวัติบวมจนหน้า UI โหลดช้า
const MAX_ERROR_MESSAGE_LENGTH = 500;

// SMTP ที่ค้างอาจกินเวลานานกว่าค่าเริ่มต้นของ serverless function — ขยายเพดานให้พอส่งจริง (Vercel Hobby
// จำกัดที่ 60 วินาที) ถ้าไม่ตั้งไว้ request จะถูกตัดกลางคันโดยที่ผู้ใช้ไม่รู้ว่าอีเมลส่งออกไปหรือยัง
export const maxDuration = 60;

interface SendRequestBody {
  certId?: unknown;
  pdfBase64?: unknown;
  filename?: unknown;
}

interface SendLogInput {
  companyId: string;
  certificateId: string;
  status: 'success' | 'failed';
  sentTo: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  actorId: string | null;
  actorEmail: string | null;
}

/** เขียนแถวประวัติการส่ง — best-effort โดยเจตนา: ถ้าเขียนไม่สำเร็จจะ log ออก terminal แล้วปล่อยผ่าน ไม่โยน
 * error ต่อ เพราะ "บันทึกประวัติไม่ได้" ต้องไม่ทำให้ "การส่งอีเมลที่สำเร็จไปแล้ว" กลายเป็นล้มเหลวในสายตา
 * ผู้ใช้ (อีเมลถึงผู้รับแล้วจริง ย้อนกลับไม่ได้) และต้องไม่กลบ error ตัวจริงในเส้นทางที่ล้มเหลวด้วย */
async function recordSendLog(supabase: SupabaseClient, input: SendLogInput): Promise<void> {
  const { error } = await supabase.from('wht_certificate_send_logs').insert({
    company_id: input.companyId,
    certificate_id: input.certificateId,
    status: input.status,
    sent_to: input.sentTo,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ? input.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH) : null,
    actor_id: input.actorId,
    actor_email: input.actorEmail,
  });
  if (error) {
    console.error('[wht-certificate/send] บันทึกประวัติการส่งไม่สำเร็จ:', error);
  }
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

  // ดึงข้อมูลใบ + ตัวตนผู้กดส่งพร้อมกัน — ผู้กดส่งจำเป็นสำหรับ actor_id/actor_email ของแถวประวัติ และ RLS
  // ของตารางประวัติบังคับว่า actor_id ต้องเท่ากับ auth.uid() อยู่แล้ว (กันการปลอมว่าคนอื่นเป็นคนกดส่ง)
  const [{ data: cert, error: certError }, { data: userData }] = await Promise.all([
    supabase
      .from('wht_certificates')
      .select('id, cert_number, payee_name, business_partner_id, company_id, status')
      .eq('id', certId)
      .single(),
    supabase.auth.getUser(),
  ]);

  if (certError || !cert) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const actorId = userData?.user?.id ?? null;
  const actorEmail = userData?.user?.email ?? null;
  const logBase = { companyId: cert.company_id as string, certificateId: certId, actorId, actorEmail };

  // ใบที่ยกเลิกแล้วห้ามส่งออกเด็ดขาด — UI ซ่อนปุ่มไว้อยู่แล้ว แต่ด่านนั้นข้ามได้ด้วยการยิง API ตรง และการ
  // ส่งหนังสือรับรองที่ถูกยกเลิกไปให้ผู้ถูกหักภาษีสร้างความเสียหายที่เรียกคืนไม่ได้ (เขาอาจเอาไปยื่นภาษีจริง)
  if (cert.status !== 'issued') {
    await recordSendLog(supabase, { ...logBase, status: 'failed', sentTo: null, errorCode: 'certificate_voided' });
    return Response.json({ error: 'certificate_voided' }, { status: 409 });
  }

  const [{ data: partner }, { data: company }] = await Promise.all([
    supabase.from('business_partners').select('email').eq('id', cert.business_partner_id).single(),
    supabase.from('companies').select('name').eq('id', cert.company_id).single(),
  ]);

  const recipientEmail = partner?.email?.trim();
  if (!recipientEmail) {
    await recordSendLog(supabase, { ...logBase, status: 'failed', sentTo: null, errorCode: 'no_recipient_email' });
    return Response.json({ error: 'no_recipient_email' }, { status: 400 });
  }

  // Buffer.from(..., 'base64') ไม่เคยโยน error แม้ input จะเป็นขยะ (ตัวอักษรที่ไม่ใช่ base64 ถูกข้ามไปเฉยๆ)
  // การเช็คแค่ length === 0 จึงแทบไม่กันอะไรเลย — ตรวจเลขนำหน้าไฟล์ "%PDF-" ซึ่งไฟล์ PDF ทุกไฟล์ต้องมีแทน
  // เพื่อกันการแนบไฟล์อื่นส่งออกจากอีเมลบริษัท (ไม่ได้ตรวจว่าเนื้อหาตรงกับใบนี้จริง ซึ่งทำได้ทางเดียวคือ
  // ย้ายการสร้าง PDF มาทำฝั่ง server ทั้งหมด — ใหญ่เกินขอบเขตรอบนี้ บันทึกไว้เป็นข้อจำกัดที่รู้ตัว)
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  if (pdfBuffer.length === 0 || pdfBuffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    await recordSendLog(supabase, { ...logBase, status: 'failed', sentTo: recipientEmail, errorCode: 'invalid_pdf' });
    return Response.json({ error: 'invalid_pdf' }, { status: 400 });
  }

  const { subject, text } = buildWhtCertificateEmailContent(cert.cert_number, cert.payee_name, company?.name ?? '');

  try {
    await sendWhtCertificateEmail({ to: recipientEmail, subject, text, filename, pdfBuffer });
  } catch (err) {
    // พิมพ์ error จริงจาก nodemailer ออก terminal ฝั่ง server เสมอ (เช่น "Invalid login", "Username and
    // Password not accepted" ฯลฯ) — ไม่ส่งข้อความนี้กลับไปโชว์ที่หน้าเว็บ (อาจมีรายละเอียดเทคนิคที่ไม่ควร
    // โชว์ผู้ใช้ทั่วไป) แต่เก็บลงประวัติการส่งเพื่อให้ผู้ดูแลระบบเปิดดูจากหน้าเว็บได้ ไม่ต้องไปงม log
    const message = err instanceof Error ? err.message : String(err);
    console.error('[wht-certificate/send] ส่งอีเมลไม่สำเร็จ:', err);
    await recordSendLog(supabase, {
      ...logBase,
      status: 'failed',
      sentTo: recipientEmail,
      errorCode: 'send_failed',
      errorMessage: message,
    });
    return Response.json({ error: 'send_failed' }, { status: 502 });
  }

  // บันทึกว่าส่งไปแล้วเมื่อไร/ถึงใคร (คอลัมน์ email_sent_at/email_sent_to — ดู migration_029 ซึ่งเขียน DDL
  // ย้อนหลังให้ เพราะรอบที่เพิ่มฟีเจอร์นี้ลืมทำ migration ไว้) เขียนหลังส่งอีเมลสำเร็จเท่านั้น ถ้าอัปเดตแถวนี้
  // ไม่สำเร็จก็ไม่ถือว่าทั้ง request ล้มเหลว (อีเมลถึงผู้รับแล้วจริง แก้ไม่ได้แล้ว แค่ "วันที่ส่งล่าสุด" ที่โชว์
  // ในตารางจะไม่อัปเดตรอบนี้ — ประวัติฉบับเต็มยังถูกบันทึกครบผ่าน recordSendLog ด้านล่างอยู่ดี)
  const sentAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('wht_certificates')
    .update({ email_sent_at: sentAt, email_sent_to: recipientEmail })
    .eq('id', certId);
  if (updateError) {
    console.error('[wht-certificate/send] ส่งอีเมลสำเร็จ แต่บันทึกวันที่ส่งไม่สำเร็จ:', updateError);
  }

  await recordSendLog(supabase, { ...logBase, status: 'success', sentTo: recipientEmail });

  return Response.json({ ok: true, sentTo: recipientEmail, sentAt });
}
