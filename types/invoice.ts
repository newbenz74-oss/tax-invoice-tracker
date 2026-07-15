export type InvoiceStatus = 'pending' | 'received' | 'cancelled';

/** ประเภทภาษีของรายการ — เพิ่มเข้ามาพร้อมฟีเจอร์จำแนก VAT/ไม่มี VAT (migration_003)
 * no_vat = ไม่มี VAT เลย, claimable_vat = มี VAT และใช้เครดิตภาษีซื้อได้ (ผ่านขั้นตอนรอรับใบกำกับภาษีเดิม),
 * non_claimable_vat = มี VAT แต่ใช้เครดิตภาษีซื้อไม่ได้ (เช่น ค่ารับรอง) */
export type TaxType = 'no_vat' | 'claimable_vat' | 'non_claimable_vat';

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
  // เพิ่มสำหรับฟีเจอร์ "รายงานภาษีซื้อ" (VAT Reconcile) — ทุกฟิลด์ nullable เพราะแถวเก่าก่อนมี
  // ฟีเจอร์นี้จะยังไม่มีค่า (ดู supabase/migration_002_purchase_tax_report_fields.sql)
  vendor_tax_id: string | null; // เลขประจำตัวผู้เสียภาษีของผู้ขาย (13 หลัก)
  tax_invoice_date: string | null; // วันที่พิมพ์อยู่บนใบกำกับภาษีจริง (คนละค่ากับ received_date)
  vat_claim_month: number | null; // เดือนที่นำไปใช้ยื่น ภ.พ.30 (1-12) — ตัวกรองหลักของรายงานภาษีซื้อ
  vat_claim_year: number | null; // ปีที่นำไปใช้ยื่น ภ.พ.30 (พ.ศ.)
  // เพิ่มสำหรับฟีเจอร์จำแนกประเภทภาษี (migration_003) — nullable เพราะแถวเก่าก่อนมีฟีเจอร์นี้ยังไม่มีค่า
  // (ตั้งใจไม่เดา/ไม่ backfill ให้ ดู supabase/migration_003_tax_type_classification.sql) แถวที่เป็น
  // NULL จะแสดงเป็น "รอตรวจสอบประเภทภาษี" ในตาราง — ดู lib/invoiceLogic.ts getTaxInvoiceStatusLabel
  tax_type: TaxType | null;
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
  vendor_tax_id: string; // ไม่บังคับ — ใช้แสดงในรายงานภาษีซื้อ
  // '' หมายถึงยังไม่ได้เลือก (บังคับเลือกก่อน submit ได้ — ดู validateInvoiceForm) เพิ่มเข้ามาพร้อม
  // ฟีเจอร์จำแนกประเภทภาษี
  tax_type: TaxType | '';
  // ใช้เฉพาะตอน tax_type === 'non_claimable_vat' เท่านั้น — กรอกเลขที่/วันที่ใบกำกับภาษีได้โดยตรงถ้ามี
  // (ไม่บังคับ ไม่ผ่านขั้นตอน "รอรับใบกำกับภาษี" เหมือน claimable_vat) ฟิลด์อื่นไม่ใช้ค่านี้
  tax_invoice_number: string;
  tax_invoice_date: string;
}

/** ข้อมูลที่กรอกตอนกดปุ่ม "ได้รับแล้ว" — เดิมมีแค่ taxInvoiceNumber/receivedDate เพิ่ม 3 ฟิลด์ใหม่
 * (taxInvoiceDate, vatClaimMonth, vatClaimYear) เพื่อรองรับรายงานภาษีซื้อ ดู lib/invoiceApi.ts */
export interface MarkReceivedInput {
  taxInvoiceNumber: string;
  receivedDate: string;
  taxInvoiceDate: string;
  vatClaimMonth: number;
  vatClaimYear: number;
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
