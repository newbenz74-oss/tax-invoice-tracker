export type InvoiceStatus = 'pending' | 'received' | 'cancelled';

export interface PendingTaxInvoice {
  id: string;
  vendor_name: string;
  transaction_date: string; // ISO date (YYYY-MM-DD)
  description: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  total_amount: number;
  reference_no: string | null;
  expected_date: string | null;
  status: InvoiceStatus;
  received_date: string | null;
  tax_invoice_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceFormInput {
  vendor_name: string;
  transaction_date: string;
  description: string;
  amount_excl_vat: string;
  vat_amount: string;
  reference_no: string;
  expected_date: string;
  notes: string;
}

export type AgingBucket =
  | 'not_due'
  | 'overdue_1_7'
  | 'overdue_8_14'
  | 'overdue_15_30'
  | 'overdue_30_plus'
  | 'n_a';

export type SortField = 'transaction_date' | 'expected_date' | 'vendor_name' | 'total_amount';
export type SortDirection = 'asc' | 'desc';
