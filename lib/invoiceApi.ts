import { getSupabaseClient } from './supabaseClient';
import type { InvoiceStatus, PendingTaxInvoice } from '@/types/invoice';

const TABLE = 'pending_tax_invoices';

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
      status: 'pending' as InvoiceStatus,
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
        status: 'pending' as InvoiceStatus,
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

export async function markReceived(
  id: string,
  taxInvoiceNumber: string,
  receivedDate: string
): Promise<PendingTaxInvoice> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'received' as InvoiceStatus,
      tax_invoice_number: taxInvoiceNumber,
      received_date: receivedDate,
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
