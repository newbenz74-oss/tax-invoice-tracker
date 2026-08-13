import { getSupabaseClient } from './supabaseClient';
import { formatWhtCertNumber } from './whtCertificateLogic';
import { buildWhtCertificatePdfForEmail, whtCertificateFilename } from './whtCertificatePdf';
import type {
  CreateWhtCertificateInput,
  WhtCertificate,
  WhtFormType,
  WhtPartySnapshot,
  WhtPayeeSnapshot,
} from '@/types/whtCertificate';
import type { PendingTaxInvoice } from '@/types/invoice';

export const WHT_CERTIFICATES_SWR_KEY = 'wht_certificates';

// ข้อความ error ที่ API route (app/api/wht-certificate/send/route.ts) อาจส่งกลับมา — แปลเป็นภาษาไทยที่
// เข้าใจง่ายให้ผู้ใช้ตรงนี้ที่เดียว (ไม่กระจายไปเขียนซ้ำที่ UI)
const SEND_ERROR_MESSAGES: Record<string, string> = {
  not_configured: 'ระบบยังไม่ได้ตั้งค่าการส่งอีเมล กรุณาติดต่อผู้ดูแลระบบ',
  unauthorized: 'ยืนยันตัวตนไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  forbidden: 'ไม่พบใบหัก ณ ที่จ่ายนี้ หรือไม่มีสิทธิ์เข้าถึง',
  no_recipient_email: 'ผู้ขายรายนี้ยังไม่มีอีเมลในสมุดรายชื่อ กรุณาเพิ่มอีเมลก่อนแล้วลองอีกครั้ง',
  file_too_large: 'ไฟล์ PDF ใหญ่เกินไป',
  send_failed: 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
};

/** แปลง Blob เป็น base64 string แบบไม่ทำให้ call stack ล้นถ้าไฟล์ใหญ่ (เลี่ยง String.fromCharCode(...bytes)
 * ตรงๆ ทั้งก้อน — แบ่งเป็นชิ้นละ 0x8000 ไบต์แทน) ใช้เฉพาะฝั่ง browser เท่านั้น (btoa เป็น Web API) */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** ส่งใบหัก ณ ที่จ่ายเป็นอีเมลไปหาผู้ถูกหักภาษี (เพิ่มเข้ามา 2026-08-11 ตามที่ผู้ใช้ขอ) — สร้าง PDF ฝั่ง
 * browser ด้วย buildWhtCertificatePdfForEmail() (ดู lib/whtCertificatePdf.ts) ซึ่งมีแค่หน้าฉบับที่ 1+2 สำหรับ
 * ผู้ถูกหักภาษีเท่านั้น (ไม่รวมหน้าสำเนาสำหรับผู้มีหน้าที่หัก/หน้าแนบรายละเอียด ที่ปุ่ม "ดาวน์โหลด PDF" มี — เอก
 * สาร 2 ส่วนหลังเป็นของเก็บภายในบริษัทเอง ไม่ต้องส่งให้ผู้ถูกหักภาษี ยืนยันกับผู้ใช้แล้ว 2026-08-12) แล้วส่งไบต์
 * เป็น base64 ไปให้ API route จัดการต่อ (ตรวจสิทธิ์ + หาอีเมลผู้รับจริงจากฐานข้อมูล + ส่ง SMTP จริง) accessToken
 * มาจาก session.access_token ของผู้ใช้ที่ login อยู่ (ดู lib/AuthContext.tsx) ใช้พิสูจน์ตัวตนกับ route ฝั่ง
 * server เท่านั้น ไม่ได้ส่งไปที่อื่น */
export async function emailWhtCertificate(
  cert: WhtCertificate,
  invoices: PendingTaxInvoice[],
  accessToken: string
): Promise<{ sentTo: string }> {
  const blob = buildWhtCertificatePdfForEmail(cert, invoices);
  const pdfBase64 = await blobToBase64(blob);

  const res = await fetch('/api/wht-certificate/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ certId: cert.id, pdfBase64, filename: whtCertificateFilename(cert) }),
  });

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sentTo?: string; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error((data.error && SEND_ERROR_MESSAGES[data.error]) || 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่');
  }
  return { sentTo: data.sentTo ?? '' };
}

/** ขอเลขที่ใบหัก ณ ที่จ่ายถัดไปแบบ atomic ผ่าน RPC get_next_wht_cert_number() (ดู
 * supabase/migration_014_wht_certificate_numbering.sql) — เรียกครั้งเดียวตอนยืนยันออกใบจริงเท่านั้น (ไม่ใช่
 * ตอนเปิดฟอร์ม/ดู preview) เพราะทุกครั้งที่เรียกจะเพิ่มตัวนับถาวร เรียกซ้ำ = เสียเลขที่ไปเปล่าๆ (เช่น
 * ยกเลิกกลางคันหลังขอเลขไปแล้ว เลขนั้นจะถูกข้ามไป ไม่ใช้ซ้ำ — เป็นพฤติกรรมที่ยอมรับได้ตามธรรมชาติของ
 * เอกสารทางการที่ต้องมีเลขต่อเนื่อง ไม่ย้อนกลับมาใช้เลขที่ข้ามไปแล้ว)
 * buddhistYear รับเป็นปี พ.ศ. เต็ม 4 หลัก (เช่น 2569) เหมือนกับ currentBuddhistYear() ที่อื่นในระบบ */
export async function getNextWhtCertNumber(
  companyId: string,
  formType: WhtFormType,
  buddhistYear: number,
  month: number
): Promise<{ sequence: number; certNumber: string }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_next_wht_cert_number', {
    p_company_id: companyId,
    p_form_type: formType,
    p_period_year: buddhistYear,
    p_period_month: month,
  });
  if (error) throw error;
  const sequence = data as number;
  return { sequence, certNumber: formatWhtCertNumber(formType, buddhistYear, month, sequence) };
}

/** ดึงรายการใบหัก ณ ที่จ่ายที่ออกไปแล้วทั้งหมดของบริษัท — ใช้กับหน้าประวัติ (ยังไม่มี UI ในรอบนี้) เรียง
 * ตามวันที่ออกล่าสุดขึ้นก่อน */
export async function fetchWhtCertificates(companyId: string): Promise<WhtCertificate[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('wht_certificates')
    .select('*')
    .eq('company_id', companyId)
    .order('issued_date', { ascending: false })
    .order('cert_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WhtCertificate[];
}

/** ออกใบหัก ณ ที่จ่ายจริง ผ่าน RPC create_wht_certificate() (ดู
 * supabase/migration_015_wht_certificates.sql) — atomic ในทรานแซกชันเดียว: ขอเลขที่ถัดไป + insert ใบ +
 * ผูกรายการจ่ายเงินที่เลือกทั้งหมด ล้มเหลวจุดไหนก็ rollback หมด ไม่มีทางได้ผลลัพธ์ค้างครึ่งๆ กลางๆ
 * payer/payee ควรสร้างจาก buildPayerSnapshot()/buildPayeeSnapshot() ใน lib/whtCertificateLogic.ts เสมอ
 * (ไม่ประกอบ object เองตรงๆ ที่จุดเรียก) เพื่อให้ field name ตรงกับที่ RPC คาดหวังเสมอ */
export async function createWhtCertificate(
  input: CreateWhtCertificateInput,
  payer: WhtPartySnapshot,
  payee: WhtPayeeSnapshot,
  createdByEmail: string | null
): Promise<WhtCertificate> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('create_wht_certificate', {
    p_company_id: input.companyId,
    p_form_type: input.formType,
    p_period_year: input.periodYear,
    p_period_month: input.periodMonth,
    p_business_partner_id: input.businessPartnerId,
    p_income_type_code: input.incomeTypeCode,
    p_income_type_label: input.incomeTypeLabel.trim() || null,
    p_deduction_type: input.deductionType,
    p_deduction_type_note: input.deductionTypeNote.trim() || null,
    p_signer_name: input.signerName.trim() || null,
    p_issued_date: input.issuedDate,
    p_payer: payer,
    p_payee: payee,
    p_invoice_ids: input.invoiceIds,
    p_created_by_email: createdByEmail,
  });
  if (error) throw error;
  return data as WhtCertificate;
}

/** ยกเลิกใบหัก ณ ที่จ่าย ผ่าน RPC void_wht_certificate() (ดู
 * supabase/migration_016_void_wht_certificate.sql) — atomic: เปลี่ยนสถานะเป็น 'voided' + ปลดรายการจ่ายเงิน
 * ที่เคยผูกกับใบนี้ทั้งหมดกลับไปเป็น wht_certificate_id = null (กลับมาเลือกออกใบใหม่ได้อีกครั้ง)
 *
 * ใช้เป็น building block ของทั้ง 2 ปุ่มในหน้าประวัติ (ดู components/WhtCertificateHistoryPage.tsx):
 * - ปุ่ม "ลบ" เรียกฟังก์ชันนี้ตรงๆ แล้วจบ (soft delete — เก็บประวัติไว้ ไม่ลบแถวจริง)
 * - ปุ่ม "แก้ไข" เรียกฟังก์ชันนี้ก่อน แล้วเปิด IssueWhtCertificateModal (mode="reissue") พร้อมข้อมูลเดิม
 *   ให้ผู้ใช้แก้ไขแล้วออกใบใหม่ผ่าน createWhtCertificate() ตามปกติ (ได้เลขที่ใหม่ต่อเนื่อง ไม่ใช้เลขเดิมซ้ำ)
 * reason ไม่บังคับกรอก (ส่ง null ได้ถ้าไม่มีเหตุผลเฉพาะเจาะจง) */
export async function voidWhtCertificate(certId: string, reason: string | null): Promise<WhtCertificate> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('void_wht_certificate', {
    p_cert_id: certId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as WhtCertificate;
}
