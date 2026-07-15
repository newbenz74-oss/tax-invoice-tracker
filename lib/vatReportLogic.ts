import type { PendingTaxInvoice } from '@/types/invoice';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PurchaseTaxReportFilter {
  month: number | 'all'; // 1-12 หรือ 'all' = ดูทั้งปี
  year: number; // พ.ศ. — ตรงกับ vat_claim_year ที่บันทึกไว้
}

export interface PurchaseTaxReportRow {
  id: string;
  taxInvoiceDate: string | null; // วันที่ใบกำกับภาษี
  taxInvoiceNumber: string; // เลขที่ใบกำกับภาษี
  vendorName: string; // ผู้ขาย
  vendorTaxId: string; // เลขประจำตัวผู้เสียภาษี
  description: string; // รายการ
  amountExclVat: number; // ฐานภาษี
  vatAmount: number; // VAT 7%
  totalAmount: number; // ยอดรวม
}

export interface PurchaseTaxReportSummary {
  count: number;
  totalAmountExclVat: number;
  totalVatAmount: number;
  totalAmount: number;
}

/**
 * กรองรายการสำหรับรายงานภาษีซื้อ — ใช้ vat_claim_month/vat_claim_year (เดือน/ปีที่นำใบกำกับภาษีนี้ไป
 * ใช้ยื่น ภ.พ.30 จริง) เป็นตัวกรองหลักเสมอ "ไม่ใช่" tax_invoice_date หรือ received_date เพราะใบกำกับ
 * ภาษีอาจลงวันที่เดือนหนึ่งแต่บริษัทนำไปเครดิตภาษีในอีกเดือนหนึ่งก็ได้ (เช่น ใบกำกับภาษีลงวันที่ 28
 * มิถุนายน แต่บริษัทได้รับเอกสารจริง 5 กรกฎาคม แล้วนำไปยื่นเครดิตของเดือนกรกฎาคม รายงานของเดือน
 * กรกฎาคมต้องแสดงรายการนี้ ไม่ใช่รายงานของเดือนมิถุนายน)
 *
 * ตั้งแต่มีฟีเจอร์จำแนกประเภทภาษี (migration_003) เงื่อนไขเข้มขึ้นตามสเปก: ต้องเป็น claimable_vat
 * (มี VAT และใช้เครดิตได้) เท่านั้น — ไม่มี VAT (no_vat) และมี VAT แต่ใช้เครดิตไม่ได้ (non_claimable_vat)
 * ห้ามเข้ารายงานนี้เด็ดขาดไม่ว่ากรณีใด รวมถึงต้องมี VAT > 0, มีเลขที่/วันที่ใบกำกับภาษีจริงแล้ว และมี
 * เดือน/ปีที่ใช้เครดิตครบถ้วน (ไม่ใช่แค่สถานะ "ได้รับแล้ว" เฉยๆ) ตรงกับช่วงที่เลือกกรอง
 *
 * ข้อยกเว้นเดียว: รายการเก่าก่อนมีฟีเจอร์นี้ (tax_type เป็น NULL) ปฏิบัติเหมือน claimable_vat ในการ
 * กรองนี้โดยเจตนา — เพื่อไม่ให้รายการเก่าที่เคยแสดงอยู่ในรายงานนี้อยู่แล้ว (ก่อนมี tax_type) หายไป
 * ทันทีที่อัปเดตระบบ (จะถือเป็นการ "ทำให้ฟังก์ชันเดิมเสีย") โดยไม่มีการเดา/เขียนทับ tax_type ให้ในฐาน
 * ข้อมูลแต่อย่างใด — ยังคงเป็น NULL และแสดง badge "รอตรวจสอบประเภทภาษี" ในตารางตามเดิม ผู้ใช้จะเห็นค่า
 * นี้จริงเฉพาะเมื่อไปแก้ไขรายการนั้นและเลือกประเภทภาษีเองเท่านั้น
 */
export function filterPurchaseTaxReport(
  invoices: PendingTaxInvoice[],
  filter: PurchaseTaxReportFilter
): PendingTaxInvoice[] {
  return invoices.filter((inv) => {
    if (inv.tax_type === 'no_vat' || inv.tax_type === 'non_claimable_vat') return false;
    if (inv.status !== 'received') return false;
    if (!(inv.vat_amount > 0)) return false;
    if (!inv.tax_invoice_number) return false;
    if (!inv.tax_invoice_date) return false;
    if (inv.vat_claim_month == null || inv.vat_claim_year == null) return false;
    if (inv.vat_claim_year !== filter.year) return false;
    if (filter.month !== 'all' && inv.vat_claim_month !== filter.month) return false;
    return true;
  });
}

/** เรียงตามวันที่ใบกำกับภาษี (เก่า→ใหม่) แล้วตามเลขที่ใบกำกับภาษี — ลำดับที่ใช้ทั่วไปในรายงานภาษีซื้อ
 * ตามรูปแบบที่กรมสรรพากรกำหนด (รง.ภาษีซื้อเรียงตามวันที่เอกสาร) */
export function sortPurchaseTaxReport(invoices: PendingTaxInvoice[]): PendingTaxInvoice[] {
  return [...invoices].sort((a, b) => {
    const dateA = a.tax_invoice_date ?? '';
    const dateB = b.tax_invoice_date ?? '';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    const numA = a.tax_invoice_number ?? '';
    const numB = b.tax_invoice_number ?? '';
    return numA.localeCompare(numB);
  });
}

/** แปลง PendingTaxInvoice ให้เป็นแถวของรายงานภาษีซื้อ (เฉพาะคอลัมน์ที่ต้องแสดงตามสเปก) */
export function toPurchaseTaxReportRows(invoices: PendingTaxInvoice[]): PurchaseTaxReportRow[] {
  return invoices.map((inv) => ({
    id: inv.id,
    taxInvoiceDate: inv.tax_invoice_date,
    taxInvoiceNumber: inv.tax_invoice_number ?? '-',
    vendorName: inv.vendor_name,
    vendorTaxId: inv.vendor_tax_id ?? '-',
    description: inv.description ?? '-',
    amountExclVat: inv.amount_excl_vat,
    vatAmount: inv.vat_amount,
    totalAmount: inv.total_amount,
  }));
}

/** สรุปยอดรวมท้ายรายงาน (จำนวนรายการ + ยอดรวม 3 คอลัมน์ตัวเลข) */
export function summarizePurchaseTaxReport(rows: PurchaseTaxReportRow[]): PurchaseTaxReportSummary {
  return {
    count: rows.length,
    totalAmountExclVat: round2(rows.reduce((sum, r) => sum + r.amountExclVat, 0)),
    totalVatAmount: round2(rows.reduce((sum, r) => sum + r.vatAmount, 0)),
    totalAmount: round2(rows.reduce((sum, r) => sum + r.totalAmount, 0)),
  };
}
