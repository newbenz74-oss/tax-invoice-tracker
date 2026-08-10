import { getSupabaseClient } from './supabaseClient';

/**
 * API สำหรับฟีเจอร์ "อนุมัติสมาชิกใหม่" (เพิ่มเข้ามา 2026-08-10 — ดู
 * supabase/migration_010_member_approval.sql) — คนที่สมัครสมาชิกเองที่หน้า login (มีอยู่แล้วเดิม) จะยังใช้
 * งานอะไรไม่ได้จนกว่าสมาชิกบริษัทที่มีอยู่แล้วคนใดคนหนึ่งจะอนุมัติให้เข้าบริษัทนั้นผ่านฟังก์ชันในไฟล์นี้ —
 * ทั้งสองฟังก์ชันเรียกผ่าน RPC เท่านั้น (ไม่มีทาง query ตาราง auth.users หรือ insert คนอื่นเข้า company_members
 * ตรงๆ ได้จากฝั่ง client เลย ถูกกันไว้ที่ RLS/ฟังก์ชันฝั่งฐานข้อมูลทั้งหมด)
 */
export interface PendingUser {
  id: string;
  email: string;
  createdAt: string;
}

interface PendingUserRow {
  id: string;
  email: string;
  created_at: string;
}

export async function listPendingUsers(): Promise<PendingUser[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('list_pending_users');
  if (error) throw error;
  return ((data ?? []) as PendingUserRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
  }));
}

export async function approveMember(userId: string, companyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('approve_member', { p_user_id: userId, p_company_id: companyId });
  if (error) throw error;
}
