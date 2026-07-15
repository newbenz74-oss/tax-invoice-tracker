import { getSupabaseClient } from './supabaseClient';
import type { InvoiceStatus, MarkReceivedInput, PendingTaxInvoice, TaxType } from '@/types/invoice';

const TABLE = 'pending_tax_invoices';

/** SWR cache key ของรายการใบกำกับภาษี — export ออกมาเพื่อให้หน้ารายงาน (เช่น PurchaseTaxReport)
 * เรียก useSWR ด้วย key เดียวกัน ใช้ cache ร่วมกับ DashboardContent แทนการดึงข้อมูลซ้ำซ้อน */
export const INVOICES_SWR_KEY = TABLE;

export async function fetchInvoices(): Promise<PendingTaxInvoice[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('expected_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PendingTaxInvoice[];
}

export interface InvoiceWriteInput {
  vendor_name: string;
  transaction_date: string;
  description: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  reference_no: string | null;
  expected_date: string | null;
  notes: string | null;
  // ไม่บังคับ (optional) โดยตั้งใจ — ทำให้ที่เรียกใช้เดิม (เช่น การ import จาก Excel ใน
  // lib/excelImport.ts) ไม่ต้องแก้ไขเลย แถวที่ไม่ได้ส่งค่านี้มาจะถูกบันทึกเป็น NULL ในฐานข้อมูล
  vendor_tax_id?: string | null;
  // เพิ่มสำหรับฟีเจอร์จำแนกประเภทภาษี — บังคับใส่เสมอ (ทุกจุดที่เรียก createInvoice/bulkCreateInvoices
  // ในโค้ดปัจจุบันกำหนดค่านี้แล้วทั้งหมด: ฟอร์มเพิ่มรายการ และการ import Excel)
  tax_type: TaxType;
  // ไม่บังคับ — ผู้เรียกที่รู้ status ที่ถูกต้อง (เช่น app/dashboard/page.tsx ผ่าน
  // deriveStatusForTaxType) ควรส่งค่านี้มาเสมอ ถ้าไม่ส่งมาจะ fallback เป็น 'pending' เหมือนพฤติกรรม
  // เดิมก่อนมีฟีเจอร์นี้ (กันไว้เผื่อมีจุดเรียกอื่นที่ยังไม่รู้จักค่านี้)
  status?: InvoiceStatus;
  // ใช้เฉพาะกรณี non_claimable_vat ที่กรอกเลขที่/วันที่ใบกำกับภาษีมาโดยตรงตอนสร้าง/แก้ไขรายการ
  // (ไม่ผ่านขั้นตอน "รอรับใบกำกับภาษี" เดิม) เป็น optional เพื่อไม่กระทบผู้เรียกเดิม
  tax_invoice_number?: string | null;
  tax_invoice_date?: string | null;
}

export async function createInvoice(
  input: InvoiceWriteInput,
  createdBy: { id: string | null; email: string | null }
): Promise<PendingTaxInvoice> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ...input,
      status: input.status ?? ('pending' as InvoiceStatus),
      created_by: createdBy.id,
      created_by_email: createdBy.email,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PendingTaxInvoice;
}

/** เพิ่มหลายรายการพร้อมกันในครั้งเดียว (ใช้ตอน import จาก Excel) — insert เดียวกันทั้งหมด
 * ถ้าแถวใดผิดพลาด (เช่น constraint ที่ฐานข้อมูล) จะไม่มีแถวไหนถูกบันทึกเลย (all-or-nothing) */
export async function bulkCreateInvoices(
  inputs: InvoiceWriteInput[],
  createdBy: { id: string | null; email: string | null }
): Promise<PendingTaxInvoice[]> {
  if (inputs.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert(
      inputs.map((input) => ({
        ...input,
        status: input.status ?? ('pending' as InvoiceStatus),
        created_by: createdBy.id,
        created_by_email: createdBy.email,
      }))
    )
    .select();
  if (error) throw error;
  return (data ?? []) as PendingTaxInvoice[];
}

export async function updateInvoice(
  id: string,
  patch: Partial<InvoiceWriteInput>
): Promise<PendingTaxInvoice> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as PendingTaxInvoice;
}

// ขยาย input จากเดิม (taxInvoiceNumber, receivedDate) ให้เป็น object MarkReceivedInput
// เพิ่ม taxInvoiceDate/vatClaimMonth/vatClaimYear เพื่อรองรับรายงานภาษีซื้อ — ไม่ได้ลบความสามารถเดิม
// (บันทึก tax_invoice_number/received_date/status เหมือนเดิมทุกประการ) แค่เพิ่มฟิลด์ใหม่เข้าไปด้วย
export async function markReceived(
  id: string,
  input: MarkReceivedInput
): Promise<PendingTaxInvoice> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'received' as InvoiceStatus,
      tax_invoice_number: input.taxInvoiceNumber,
      received_date: input.receivedDate,
      tax_invoice_date: input.taxInvoiceDate,
      vat_claim_month: input.vatClaimMonth,
      vat_claim_year: input.vatClaimYear,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as PendingTaxInvoice;
}

export async function cancelInvoice(id: string, notes?: string): Promise<PendingTaxInvoice> {
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = { status: 'cancelled' as InvoiceStatus };
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as PendingTaxInvoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
