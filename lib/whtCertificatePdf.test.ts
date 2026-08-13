import { describe, expect, it } from 'vitest';
import { buildWhtCertificatePdf, whtCertificateFilename } from './whtCertificatePdf';
import type { PendingTaxInvoice } from '@/types/invoice';
import type { WhtCertificate } from '@/types/whtCertificate';

function makeCert(overrides: Partial<WhtCertificate> = {}): WhtCertificate {
  return {
    id: 'cert-1',
    company_id: 'company-1',
    cert_number: '53-6904002',
    form_type: '53',
    period_year: 2569,
    period_month: 4,
    sequence_number: 2,
    business_partner_id: 'partner-1',
    income_type_code: '6',
    income_type_label: 'ค่าบริการ',
    deduction_type: 'withholding',
    deduction_type_note: null,
    signer_name: 'SAKKARIN',
    issued_date: '2026-04-06',
    payment_date: '2026-04-06',
    total_amount: 42800,
    total_wht_amount: 1302,
    payer_name: 'บริษัท ซีบีซอฟท์ จำกัด',
    payer_tax_id: '0125566036499',
    payer_branch_type: 'head_office',
    payer_branch_number: null,
    payer_address: 'เลขที่ 98/402 หมู่ 4',
    payer_subdistrict: 'ตำบลบางใหญ่',
    payer_district: 'อำเภอบางใหญ่',
    payer_province: 'จังหวัดนนทบุรี',
    payer_postal_code: '11140',
    payee_entity_type: 'company',
    payee_name: 'บริษัท เอ็น วาย ฟิล์ม จำกัด',
    payee_tax_id: '0105538041181',
    payee_branch_type: 'head_office',
    payee_branch_number: null,
    payee_address: 'เลขที่ 3 ซอย ราชพฤกษ์ 4',
    payee_subdistrict: 'แขวงบางจาก',
    payee_district: 'เขตภาษีเจริญ',
    payee_province: 'กรุงเทพมหานคร',
    payee_postal_code: '10160',
    status: 'issued',
    voided_at: null,
    email_sent_at: null,
    email_sent_to: null,
    void_reason: null,
    created_by: null,
    created_by_email: 'newbenz74@gmail.com',
    created_at: '2026-04-06T00:00:00Z',
    updated_at: '2026-04-06T00:00:00Z',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<PendingTaxInvoice> = {}): PendingTaxInvoice {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    company_id: 'company-1',
    vendor_name: 'บริษัท เอ็น วาย ฟิล์ม จำกัด',
    transaction_date: '2026-04-06',
    description: 'ค่าบริการ',
    amount_excl_vat: 40000,
    vat_amount: 2800,
    total_amount: 42800,
    wht_amount: 1302,
    wht_certificate_id: 'cert-1',
    reference_no: 'PO-001',
    expected_date: null,
    status: 'received',
    received_date: '2026-04-06',
    tax_invoice_number: 'INV-001',
    notes: null,
    created_by: null,
    created_by_email: null,
    created_at: '2026-04-06T00:00:00Z',
    updated_at: '2026-04-06T00:00:00Z',
    vendor_tax_id: null,
    tax_invoice_date: '2026-04-06',
    vat_claim_month: 4,
    vat_claim_year: 2569,
    tax_type: 'claimable_vat',
    ...overrides,
  };
}

describe('buildWhtCertificatePdf', () => {
  it('สร้างไฟล์ PDF ได้โดยไม่ error และคืนค่าเป็น Blob ที่มีขนาดมากกว่า 0 (1 รายการ)', () => {
    const cert = makeCert();
    const blob = buildWhtCertificatePdf(cert, [makeInvoice()]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('รวมหลายรายการ (มากกว่า 1 invoice) ยังสร้างได้โดยไม่ error พร้อมหน้าแนบรายละเอียด', () => {
    const cert = makeCert({ total_amount: 85600, total_wht_amount: 2604 });
    const invoices = [
      makeInvoice({ id: '1', transaction_date: '2026-04-01' }),
      makeInvoice({ id: '2', transaction_date: '2026-04-15' }),
    ];
    const blob = buildWhtCertificatePdf(cert, invoices);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('ผู้ถูกหักเป็นบุคคลธรรมดา (formType 03) ไม่มีเลขประจำตัวผู้เสียภาษี ยังสร้างได้โดยไม่ error', () => {
    const cert = makeCert({
      form_type: '03',
      cert_number: '03-6908001',
      payee_entity_type: 'individual',
      payee_name: 'สมชาย ใจดี',
      payee_tax_id: null,
    });
    const blob = buildWhtCertificatePdf(cert, [makeInvoice({ vendor_name: 'สมชาย ใจดี' })]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('deduction_type เป็น other พร้อม note ยังสร้างได้โดยไม่ error', () => {
    const cert = makeCert({ deduction_type: 'other', deduction_type_note: 'หมายเหตุทดสอบ' });
    const blob = buildWhtCertificatePdf(cert, [makeInvoice()]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('ที่อยู่ยาวมาก (ต้อง wrap หลายบรรทัด) ยังสร้างได้โดยไม่ error', () => {
    const cert = makeCert({
      payer_address:
        'เลขที่ 999/999 อาคารทดสอบที่อยู่ยาวมากๆ ชั้นที่ 99 ถนนทดสอบที่อยู่ยาวเพื่อดูว่าจะตัดบรรทัดถูกต้องหรือไม่ ซอยทดสอบ 12',
    });
    const blob = buildWhtCertificatePdf(cert, [makeInvoice()]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('ไม่มีชื่อผู้ลงนาม (signer_name เป็น null) ยังสร้างได้โดยไม่ error', () => {
    const cert = makeCert({ signer_name: null });
    const blob = buildWhtCertificatePdf(cert, [makeInvoice()]);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('whtCertificateFilename', () => {
  it('ใช้เลขที่ใบเป็นชื่อไฟล์', () => {
    expect(whtCertificateFilename(makeCert({ cert_number: '53-6904002' }))).toBe('wht-cert-53-6904002.pdf');
  });
});
