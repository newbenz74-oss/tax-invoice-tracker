import { getSupabaseClient } from './supabaseClient';
import type { BranchType, BusinessPartner, ContactStatus, EntityType, PartnerType } from '@/types/contact';

const TABLE = 'business_partners';

/** SWR cache key ของสมุดรายชื่อ — แยกจาก INVOICES_SWR_KEY โดยสิ้นเชิง (คนละตาราง คนละ cache) */
export const CONTACTS_SWR_KEY = TABLE;

export async function fetchContacts(): Promise<BusinessPartner[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select('*').order('contact_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessPartner[];
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
  createdBy: string | null
): Promise<BusinessPartner> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...input,
      status: input.status ?? ('active' as ContactStatus),
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as BusinessPartner;
}

/** เพิ่มหลายรายชื่อพร้อมกัน (ใช้ตอนนำเข้าจาก Excel) — insert เดียวกันทั้งหมด all-or-nothing
 * เหมือน bulkCreateInvoices เดิม (ถ้าแถวใดผิด constraint เช่นรหัสซ้ำ จะไม่มีแถวไหนถูกบันทึกเลย) */
export async function bulkCreateContacts(
  inputs: ContactWriteInput[],
  createdBy: string | null
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
      }))
    )
    .select();
  if (error) throw error;
  return (data ?? []) as BusinessPartner[];
}

export async function updateContact(id: string, patch: Partial<ContactWriteInput>): Promise<BusinessPartner> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw error;
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
