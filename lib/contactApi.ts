import { getSupabaseClient } from './supabaseClient';
import type { BranchType, BusinessPartner, ContactStatus, EntityType, PartnerType } from '@/types/contact';

const TABLE = 'business_partners';

/** SWR cache key ของสมุดรายชื่อ — แยกจาก INVOICES_SWR_KEY โดยสิ้นเชิง (คนละตาราง คนละ cache) */
export const CONTACTS_SWR_KEY = TABLE;

// รับ companyId เข้ามาบังคับ (เพิ่มเข้ามา 2026-08-07 พร้อมฟีเจอร์รองรับหลายบริษัท) — เหตุผลเดียวกับ
// lib/invoiceApi.ts fetchInvoices: RLS เป็นแค่เพดานสิทธิ์สูงสุด ต้อง filter บริษัทที่กำลังใช้งานอยู่เองด้วย
export async function fetchContacts(companyId: string): Promise<BusinessPartner[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('company_id', companyId)
    .order('contact_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessPartner[];
}

/** แปลง error จาก Supabase/PostgreSQL ให้เป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าต้องแก้อะไร
 *
 * ที่มา (2026-09-30): ผู้ใช้เพิ่มรายชื่อไม่ได้แล้วหน้าจอขึ้นแค่ "เกิดข้อผิดพลาด" ลอยๆ ไม่มีทางรู้เลยว่า
 * เพราะรหัสซ้ำ จึงเข้าใจผิดว่าเป็นเพราะชื่อบริษัทยาวเกินไป (ชื่อสั้นเพิ่มได้ เพราะบังเอิญได้รหัสที่ไม่ชน)
 * เสียเวลาไล่หาสาเหตุผิดทางไปหลายรอบ
 *
 * ปกติรหัสซ้ำจะถูกดักตั้งแต่ validateContactForm() ฝั่งหน้าเว็บอยู่แล้ว ด่านนี้จึงเป็นตาข่ายชั้นสุดท้าย
 * สำหรับกรณีที่หลุดมาได้จริง เช่น มีคนอื่นในบริษัทเดียวกันเพิ่มรหัสนั้นไปก่อนหน้าไม่กี่วินาที ระหว่างที่
 * หน้าจอเรายังถือรายชื่อชุดเก่าอยู่ (race condition) — ซึ่งฝั่ง client ตรวจล่วงหน้าไม่ได้โดยธรรมชาติ
 *
 * 23505 = unique_violation ของ PostgreSQL */
function describeContactWriteError(error: { code?: string; message?: string } | null): Error {
  if (error?.code === '23505') {
    return new Error('รหัสนี้ถูกใช้ไปแล้วในบริษัทนี้ กรุณาเปลี่ยนรหัสแล้วลองใหม่อีกครั้ง');
  }
  return new Error(error?.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
}

export interface ContactWriteInput {
  partner_type: PartnerType;
  contact_code: string;
  entity_type: EntityType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  tax_id: string | null;
  branch_type: BranchType;
  branch_number: string | null;
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  note: string | null;
  // ไม่บังคับ — ไม่ส่งมาจะ fallback เป็น 'active' เสมอ (ค่าเริ่มต้นตอนเพิ่มรายชื่อใหม่)
  status?: ContactStatus;
}

export async function createContact(
  input: ContactWriteInput,
  createdBy: string | null,
  companyId: string
): Promise<BusinessPartner> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...input,
      status: input.status ?? ('active' as ContactStatus),
      created_by: createdBy,
      company_id: companyId,
    })
    .select()
    .single();
  if (error) throw describeContactWriteError(error);
  return data as BusinessPartner;
}

/** เพิ่มหลายรายชื่อพร้อมกัน (ใช้ตอนนำเข้าจาก Excel) — insert เดียวกันทั้งหมด all-or-nothing
 * เหมือน bulkCreateInvoices เดิม (ถ้าแถวใดผิด constraint เช่นรหัสซ้ำ จะไม่มีแถวไหนถูกบันทึกเลย) */
export async function bulkCreateContacts(
  inputs: ContactWriteInput[],
  createdBy: string | null,
  companyId: string
): Promise<BusinessPartner[]> {
  if (inputs.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert(
      inputs.map((input) => ({
        ...input,
        status: input.status ?? ('active' as ContactStatus),
        created_by: createdBy,
        company_id: companyId,
      }))
    )
    .select();
  if (error) throw describeContactWriteError(error);
  return (data ?? []) as BusinessPartner[];
}

export async function updateContact(id: string, patch: Partial<ContactWriteInput>): Promise<BusinessPartner> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw describeContactWriteError(error);
  return data as BusinessPartner;
}

/** เปลี่ยนสถานะเปิด/ปิดใช้งาน — ใช้กับปุ่ม "ปิดใช้งาน"/"เปิดใช้งาน" ในตาราง (ไม่ใช่การลบข้อมูล) */
export async function setContactStatus(id: string, status: ContactStatus): Promise<BusinessPartner> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).update({ status }).eq('id', id).select().single();
  if (error) throw error;
  return data as BusinessPartner;
}

export async function deleteContact(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
