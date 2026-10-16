import { describe, expect, it } from 'vitest';
import {
  buildWhtCertificatePdf,
  buildWhtCertificateSheetBatchPdf,
  buildWhtCertificateSheetPdf,
  whtCertificateBatchFilename,
  whtCertificateFilename,
  whtCertificateSheetFilename,
} from './whtCertificatePdf';
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
    total_amount_excl_vat: 100000,
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
    contact_person: null,
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
  it('ประกอบชื่อไฟล์จาก เลขที่ใบ_วันที่ออกใบ(วว.ดด.ปปปป)_ชื่อผู้ถูกหักภาษี', () => {
    expect(
      whtCertificateFilename(
        makeCert({ cert_number: '53-6904002', issued_date: '2026-04-06', payee_name: 'บริษัท เอ็น วาย ฟิล์ม จำกัด' })
      )
    ).toBe('53-6904002_06.04.2026_บริษัท เอ็น วาย ฟิล์ม จำกัด.pdf');
  });

  it('ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้ออกจากชื่อผู้ถูกหักภาษี', () => {
    expect(
      whtCertificateFilename(makeCert({ cert_number: '03-6908001', issued_date: '2026-08-11', payee_name: 'บริษัท A/B: C จำกัด' }))
    ).toBe('03-6908001_11.08.2026_บริษัท A B C จำกัด.pdf');
  });
});

/* ========================================================================================
   ดาวน์โหลดแยกแผ่น (2026-10-16) — แผ่นที่ 1 มอบให้ผู้ถูกหักภาษี / แผ่นที่ 2 บริษัทเก็บเอง
   ======================================================================================== */

describe('buildWhtCertificateSheetPdf — แยกแผ่น', () => {
  it('สร้างได้ทั้งสองแผ่น และแต่ละแผ่นเล็กกว่าไฟล์ฉบับเต็มที่รวมสองแผ่นไว้ด้วยกัน', () => {
    const cert = makeCert();
    const invoices = [makeInvoice()];
    const payee = buildWhtCertificateSheetPdf(cert, invoices, 'payee');
    const payer = buildWhtCertificateSheetPdf(cert, invoices, 'payer');
    const full = buildWhtCertificatePdf(cert, invoices);

    expect(payee.type).toBe('application/pdf');
    expect(payer.type).toBe('application/pdf');
    expect(payee.size).toBeGreaterThan(0);
    expect(payer.size).toBeGreaterThan(0);
    // ไฟล์แยกแผ่นมี 1 หน้า ส่วนฉบับเต็มมี 2 หน้า จึงต้องเล็กกว่าเสมอ — ถ้าไม่เล็กกว่าแปลว่าหลุดไปวาดทั้งสอง
    // แผ่นเหมือนเดิม ซึ่งคือบั๊กที่ผู้ใช้แจ้งมาพอดี ("กดดาวน์โหลด มันโหลดมาทั้งหมด 2 ฉบับเลย")
    expect(payee.size).toBeLessThan(full.size);
    expect(payer.size).toBeLessThan(full.size);
  });

  it('สองแผ่นไม่ใช่ไฟล์เดียวกัน (เนื้อหาคนละฉบับ)', () => {
    const cert = makeCert();
    const invoices = [makeInvoice()];
    expect(buildWhtCertificateSheetPdf(cert, invoices, 'payee').size).not.toBe(
      buildWhtCertificateSheetPdf(cert, invoices, 'payer').size
    );
  });

  it('หลายรายการ — แนบหน้ารายละเอียดไปกับทุกแผ่น เพราะแต่ละแผ่นเป็นไฟล์เอกราชของตัวเอง', () => {
    const cert = makeCert();
    const one = buildWhtCertificateSheetPdf(cert, [makeInvoice({ id: '1' })], 'payer');
    const many = buildWhtCertificateSheetPdf(
      cert,
      [makeInvoice({ id: '1' }), makeInvoice({ id: '2' })],
      'payer'
    );
    expect(many.size).toBeGreaterThan(one.size);
  });
});

describe('buildWhtCertificateSheetBatchPdf — รวมทั้งเดือน', () => {
  it('รวมหลายใบเป็นไฟล์เดียว ใหญ่กว่าไฟล์ใบเดียวของแผ่นเดียวกัน', () => {
    const certA = makeCert({ id: 'a', cert_number: '03-6910001' });
    const certB = makeCert({ id: 'b', cert_number: '03-6910002' });
    const single = buildWhtCertificateSheetPdf(certA, [makeInvoice()], 'payee');
    const batch = buildWhtCertificateSheetBatchPdf(
      [
        { cert: certA, invoices: [makeInvoice({ id: '1' })] },
        { cert: certB, invoices: [makeInvoice({ id: '2' })] },
      ],
      'payee'
    );
    expect(batch.size).toBeGreaterThan(single.size);
  });

  it('ไม่มีใบเลย → โยน error ไม่คืนไฟล์เปล่าที่ทำให้ผู้ใช้เข้าใจผิดว่าเอกสารหาย', () => {
    expect(() => buildWhtCertificateSheetBatchPdf([], 'payee')).toThrow(/ไม่มีใบหัก ณ ที่จ่าย/);
  });
});

describe('ชื่อไฟล์แยกแผ่น', () => {
  it('ต่อท้ายด้วยชื่อแผ่น เพื่อให้สองไฟล์ของใบเดียวกันไม่ทับกัน', () => {
    const cert = makeCert({ cert_number: '03-6910015', issued_date: '2026-10-15', payee_name: 'นางสาวกนกพร คชชนก' });
    expect(whtCertificateSheetFilename(cert, 'payee')).toBe(
      '03-6910015_15.10.2026_นางสาวกนกพร คชชนก_สำหรับผู้ถูกหัก.pdf'
    );
    expect(whtCertificateSheetFilename(cert, 'payer')).toBe(
      '03-6910015_15.10.2026_นางสาวกนกพร คชชนก_สำหรับบัญชี.pdf'
    );
  });

  it('ชื่อไฟล์รวมทั้งเดือนบอกแบบ เดือน/ปี และแผ่นครบ', () => {
    expect(whtCertificateBatchFilename('ภ.ง.ด.3', 'ตุลาคม 2569', 'payer')).toBe(
      'ใบหัก ณ ที่จ่าย_ภ.ง.ด.3_ตุลาคม 2569_สำหรับบัญชี.pdf'
    );
  });

  it('อักขระที่ใช้ในชื่อไฟล์ไม่ได้ถูกตัดออกจากชื่อผู้ถูกหัก', () => {
    const cert = makeCert({ payee_name: 'บริษัท เอ/บี:ซี จำกัด' });
    expect(whtCertificateSheetFilename(cert, 'payee')).not.toMatch(/[\\/:*?"<>|]/);
  });
});
