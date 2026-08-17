import { getSupabaseClient } from './supabaseClient';
import { buildWhtCertificatePdfForEmail, whtCertificateFilename } from './whtCertificatePdf';
import { downloadBlob } from './reportExport';
import type { WhtCertificate } from '@/types/whtCertificate';

/**
 * API สำหรับฟีเจอร์ "พอร์ทัลผู้ใช้ภายนอกดูใบหัก ณ ที่จ่าย" (เพิ่มเข้ามา 2026-08-15 — ดู
 * supabase/migration_018_external_wht_viewers.sql) แยกจาก lib/adminApi.ts (ระบบ "อนุมัติสมาชิกใหม่" ภายใน
 * เดิม) โดยสิ้นเชิง — คนละตาราง คนละแนวคิดสิทธิ์กัน: ที่นี่ใช้ external_wht_viewers/
 * external_wht_viewer_companies ไม่ใช่ company_members และผู้ใช้ภายนอกเห็นได้แค่ใบหัก ณ ที่จ่ายของบริษัทที่
 * ได้รับสิทธิ์เท่านั้น (ไม่ใช่ทุกฟีเจอร์ของบริษัทนั้นแบบสมาชิกภายใน)
 */

/** ข้อมูลบริษัทเท่าที่จำเป็นสำหรับแสดงผลในพอร์ทัลภายนอก — ตั้งใจไม่ใช้ Company (lib/companyApi.ts) ทั้งชุด
 * เพราะฟิลด์ tax_id/ที่อยู่/ชื่อผู้ลงนามฯลฯ ไม่จำเป็นต้องส่งให้ฝั่งนี้เลย (แม้ RLS จะอนุญาตให้อ่านได้ทั้งแถวก็
 * ตาม — เลือกดึงเฉพาะฟิลด์ที่ใช้จริงไว้ก่อนที่ query ตรงๆ เป็นแนวทาง "ให้ข้อมูลน้อยที่สุดเท่าที่จำเป็น" เพิ่ม
 * อีกชั้นหนึ่ง) */
export interface ExternalCompanySummary {
  id: string;
  name: string;
  logo_url: string | null;
}

interface GrantedCompanyRow {
  companies: ExternalCompanySummary | ExternalCompanySummary[] | null;
}

/** เรียกครั้งเดียวทันทีหลัง signIn/signUp สำเร็จที่หน้า /external/login เพื่อ "ประกาศตัว" ว่าบัญชีนี้สมัครผ่าน
 * ช่องทางภายนอก (ไม่ใช่ /login ปกติ) — สำคัญมากที่ต้องเรียกทุกครั้งที่ล็อกอินสำเร็จ (ไม่ใช่แค่ตอนสมัครใหม่)
 * เผื่อกรณี signUp สำเร็จแต่ยังไม่มี session ทันที (เปิดยืนยันอีเมลไว้) — insert ตอนนั้นทำไม่ได้เพราะยังไม่ได้
 * auth.uid() ต้องรอมา insert ตอน signIn ครั้งแรกที่มี session จริงแทน ใช้ upsert + ignoreDuplicates เพื่อให้
 * เรียกซ้ำได้ปลอดภัยเสมอ (primary key คือ user_id เอง ไม่มีผลอะไรถ้าเคยมีแถวอยู่แล้ว) */
export async function ensureExternalViewerRegistered(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error('ไม่พบผู้ใช้ที่เข้าสู่ระบบ');

  const { error } = await supabase
    .from('external_wht_viewers')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw error;
}

/** ดึงรายชื่อบริษัทที่ผู้ใช้ภายนอกที่ login อยู่ตอนนี้ได้รับสิทธิ์ดูใบหัก ณ ที่จ่ายแล้ว — ว่างเปล่า = สมัครแล้ว
 * แต่ยังไม่ได้รับอนุมัติจาก Ben เลยสักบริษัทเดียว (หน้า /external/dashboard ใช้ค่านี้ตัดสินใจว่าจะแสดงหน้า
 * "รออนุมัติ" หรือ dashboard จริง) */
export async function fetchMyGrantedCompanies(): Promise<ExternalCompanySummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('external_wht_viewer_companies')
    .select('companies(id, name, logo_url)')
    .order('granted_at', { ascending: true });
  if (error) throw error;

  // เหตุผลเดียวกับ fetchMyCompanies ใน lib/companyApi.ts — PostgREST คืน embedded resource เป็น object
  // เดี่ยวจริงตอน runtime (many-to-one ผ่าน foreign key) แต่ type ของ supabase-js กำหนดเป็น array เผื่อไว้
  return ((data ?? []) as unknown as GrantedCompanyRow[])
    .map((row) => (Array.isArray(row.companies) ? row.companies[0] : row.companies))
    .filter((c): c is ExternalCompanySummary => c !== null && c !== undefined);
}

/** ดาวน์โหลด PDF ใบหัก ณ ที่จ่าย (เฉพาะฉบับที่ 1+2 สำหรับผู้ถูกหักภาษีเท่านั้น — ใช้ builder เดียวกับปุ่ม
 * "ส่งอีเมล" ในระบบภายใน คือ buildWhtCertificatePdfForEmail ดู lib/whtCertificatePdf.ts) ตั้งใจส่ง invoices
 * เป็น [] เสมอ (ไม่ดึงรายการจ่ายเงินจริงมาให้) เพื่อไม่ต้องเปิด RLS ตาราง pending_tax_invoices ให้ผู้ใช้
 * ภายนอกเข้าถึงเลยแม้แต่นิดเดียว — ผลข้างเคียงเดียวคือช่องวันที่จ่ายเงินในเอกสารจะขึ้น "หลายรายการ" เสมอแทนที่
 * จะโชว์วันที่จริงตอนใบนั้นมีรายการเดียว (จุดเดียวใน buildWhtCertificatePdfForEmail ที่ใช้พารามิเตอร์
 * invoices) ยอมรับความคลาดเคลื่อนเล็กน้อยนี้ได้ เพื่อแลกกับขอบเขต RLS ที่แคบที่สุดเท่าที่จะทำได้สำหรับ
 * ผู้ใช้ภายนอก */
export function downloadExternalWhtCertificatePdf(cert: WhtCertificate): void {
  const blob = buildWhtCertificatePdfForEmail(cert, []);
  downloadBlob(blob, whtCertificateFilename(cert));
}

// ===== ฝั่งแอดมิน (Ben เท่านั้น — RPC ทุกตัวเช็คสิทธิ์แอดมินเองอีกชั้นในฐานข้อมูล ดู
// supabase/migration_018_external_wht_viewers.sql) ใช้กับ components/ManageExternalViewersPage.tsx =====

export interface PendingExternalViewer {
  id: string;
  email: string;
  createdAt: string;
}

interface PendingExternalViewerRow {
  id: string;
  email: string;
  created_at: string;
}

/** คนที่สมัครผ่าน /external/login แล้ว (ผ่าน ensureExternalViewerRegistered ด้านบน) แต่ยังไม่เคยได้รับสิทธิ์
 * บริษัทไหนเลย — รอ Ben เลือกบริษัทให้ผ่าน grantExternalViewerCompany() ด้านล่าง */
export async function listPendingExternalViewers(): Promise<PendingExternalViewer[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('list_pending_external_viewers');
  if (error) throw error;
  return ((data ?? []) as PendingExternalViewerRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
  }));
}

export interface ApprovedExternalViewer {
  id: string;
  email: string;
  createdAt: string;
  companies: { id: string; name: string; grantedAt: string }[];
}

interface ApprovedExternalViewerRow {
  id: string;
  email: string;
  created_at: string;
  company_id: string;
  company_name: string;
  granted_at: string;
}

/** คนที่ได้รับสิทธิ์อย่างน้อย 1 บริษัทแล้ว พร้อมรายชื่อบริษัททั้งหมดที่เห็นได้ — RPC ฝั่งฐานข้อมูลคืนมาเป็น
 * แถวแบนๆ (1 แถวต่อ 1 คู่ user-company ดู list_approved_external_viewers ใน
 * supabase/migration_018_external_wht_viewers.sql) รวมกลุ่มตาม user id ที่นี่ให้ฝั่ง UI ใช้ง่ายขึ้น */
export async function listApprovedExternalViewers(): Promise<ApprovedExternalViewer[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('list_approved_external_viewers');
  if (error) throw error;

  const byId = new Map<string, ApprovedExternalViewer>();
  for (const row of (data ?? []) as ApprovedExternalViewerRow[]) {
    let entry = byId.get(row.id);
    if (!entry) {
      entry = { id: row.id, email: row.email, createdAt: row.created_at, companies: [] };
      byId.set(row.id, entry);
    }
    entry.companies.push({ id: row.company_id, name: row.company_name, grantedAt: row.granted_at });
  }
  return Array.from(byId.values());
}

/** ให้สิทธิ์บริษัทเพิ่ม — ใช้ทั้งตอน "อนุมัติครั้งแรก" (คนใน listPendingExternalViewers) และ "เพิ่มสิทธิ์บริษัท
 * ทีหลัง" (คนที่อนุมัติไปแล้วใน listApprovedExternalViewers) เป็นฟังก์ชันเดียวกัน เพราะฝั่งฐานข้อมูลก็เป็น
 * RPC เดียวกัน (การให้สิทธิ์บริษัทแรกก็คือการอนุมัติในตัวเองอยู่แล้ว ไม่มี RPC "approve" แยกต่างหาก) */
export async function grantExternalViewerCompany(userId: string, companyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('grant_external_wht_viewer_company', {
    p_user_id: userId,
    p_company_id: companyId,
  });
  if (error) throw error;
}

/** ถอนสิทธิ์บริษัทเดียว — ไม่ลบบัญชีผู้ใช้หรือแถว "สมัครสมาชิก" ทิ้ง แค่เอาสิทธิ์เห็นบริษัทนั้นออก
 * (grantExternalViewerCompany ให้สิทธิ์กลับมาใหม่ได้ตลอดโดยไม่ต้องสมัครใหม่) */
export async function revokeExternalViewerCompany(userId: string, companyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('revoke_external_wht_viewer_company', {
    p_user_id: userId,
    p_company_id: companyId,
  });
  if (error) throw error;
}
