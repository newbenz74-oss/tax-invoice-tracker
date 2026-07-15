'use client';

import { useState, type FormEvent } from 'react';
import type { InvoiceFormInput, PendingTaxInvoice, TaxType } from '@/types/invoice';
import { TAX_TYPE_LABELS, calcTotal, suggestVatAmount, validateInvoiceForm } from '@/lib/invoiceLogic';

const EMPTY_FORM: InvoiceFormInput = {
  vendor_name: '',
  transaction_date: '',
  description: '',
  amount_excl_vat: '',
  vat_amount: '',
  reference_no: '',
  expected_date: '',
  notes: '',
  vendor_tax_id: '',
  tax_type: '',
  tax_invoice_number: '',
  tax_invoice_date: '',
};

function invoiceToForm(invoice: PendingTaxInvoice): InvoiceFormInput {
  return {
    vendor_name: invoice.vendor_name,
    transaction_date: invoice.transaction_date,
    description: invoice.description ?? '',
    amount_excl_vat: String(invoice.amount_excl_vat),
    vat_amount: String(invoice.vat_amount),
    reference_no: invoice.reference_no ?? '',
    expected_date: invoice.expected_date ?? '',
    notes: invoice.notes ?? '',
    vendor_tax_id: invoice.vendor_tax_id ?? '',
    tax_type: invoice.tax_type ?? '',
    tax_invoice_number: invoice.tax_invoice_number ?? '',
    tax_invoice_date: invoice.tax_invoice_date ?? '',
  };
}

interface InvoiceFormProps {
  editingInvoice?: PendingTaxInvoice | null;
  onSubmit: (input: InvoiceFormInput) => Promise<void>;
  onCancel: () => void;
}

export default function InvoiceForm({ editingInvoice, onSubmit, onCancel }: InvoiceFormProps) {
  const [form, setForm] = useState<InvoiceFormInput>(
    editingInvoice ? invoiceToForm(editingInvoice) : EMPTY_FORM
  );
  const [vatTouched, setVatTouched] = useState(Boolean(editingInvoice));
  const [errors, setErrors] = useState<Partial<Record<keyof InvoiceFormInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // หมายเหตุ: component นี้ต้องถูก mount ใหม่ทุกครั้งที่เปลี่ยนรายการที่แก้ไข
  // (parent ต้องส่ง key={editingInvoice?.id ?? 'new'}) เพื่อรีเซ็ตฟอร์มผ่าน
  // useState initializer แทนการ sync ด้วย useEffect + setState

  // ประเภทภาษีกำหนดว่าฟิลด์ไหนควรแสดง — ไม่มี VAT: ซ่อนช่อง VAT (บังคับ 0) และซ่อนวันที่คาดว่าจะได้รับ
  // (ไม่มีขั้นตอนรอ) / มี VAT ไม่ใช้เครดิต: แสดงช่อง VAT ตามปกติแต่ซ่อนวันที่คาดว่าจะได้รับเช่นกัน
  // (ไม่ผ่านขั้นตอนรอรับใบกำกับภาษี) แล้วเปิดช่องกรอกเลขที่/วันที่ใบกำกับภาษีแบบกรอกตรงได้เลยแทน /
  // มี VAT ใช้เครดิตได้ (หรือยังไม่เลือก): พฤติกรรมเดิมทุกประการ
  const isNoVat = form.tax_type === 'no_vat';
  const isNonClaimable = form.tax_type === 'non_claimable_vat';
  const showExpectedDate = form.tax_type === '' || form.tax_type === 'claimable_vat';
  // บังคับเลือกประเภทภาษีเสมอตอนเพิ่มรายการใหม่ — ยกเว้นตอนแก้ไขรายการเก่าที่ยังไม่เคยระบุประเภทภาษี
  // มาก่อน (tax_type เป็น NULL จากก่อนมีฟีเจอร์นี้) จะไม่บังคับ เพื่อให้ยังแก้ไขฟิลด์อื่นได้ตามปกติ
  const taxTypeRequired = !editingInvoice || editingInvoice.tax_type != null;

  function handleAmountChange(value: string) {
    setForm((prev) => {
      const next = { ...prev, amount_excl_vat: value };
      if (!vatTouched) {
        const amount = parseFloat(value);
        next.vat_amount = Number.isFinite(amount) && amount >= 0 ? String(suggestVatAmount(amount)) : '';
      }
      return next;
    });
  }

  function handleVatChange(value: string) {
    setVatTouched(true);
    setForm((prev) => ({ ...prev, vat_amount: value }));
  }

  function handleTaxTypeChange(value: string) {
    setForm((prev) => ({ ...prev, tax_type: value as InvoiceFormInput['tax_type'] }));
  }

  const amountNum = parseFloat(form.amount_excl_vat) || 0;
  // ไม่มี VAT: ยอดรวม = ยอดเงินเฉยๆ เสมอ ไม่ว่าช่อง VAT ในฟอร์มจะมีค่าเดิมค้างอยู่หรือไม่ (ผู้ใช้อาจ
  // เคยกรอก VAT ไว้ก่อนสลับมาเลือก "ไม่มี VAT" ทีหลัง) การคำนวณตรงนี้ป้องกันยอดรวมที่แสดงผิดเพี้ยน
  const vatNum = isNoVat ? 0 : parseFloat(form.vat_amount) || 0;
  const total = calcTotal(amountNum, vatNum);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationErrors = validateInvoiceForm(form, { taxTypeRequired });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate data-testid="invoice-form">
      <Field label="ประเภทภาษี" error={errors.tax_type} required={taxTypeRequired}>
        <select
          value={form.tax_type}
          onChange={(e) => handleTaxTypeChange(e.target.value)}
          className={inputClass(Boolean(errors.tax_type))}
          data-testid="select-tax-type"
        >
          <option value="" disabled>
            -- เลือกประเภทภาษี --
          </option>
          {(Object.keys(TAX_TYPE_LABELS) as TaxType[]).map((tt) => (
            <option key={tt} value={tt}>
              {TAX_TYPE_LABELS[tt]}
            </option>
          ))}
        </select>
      </Field>
      {isNoVat && (
        <p className="rounded-[10px] border border-border bg-page-bg px-3.5 py-2.5 text-xs text-text-sub">
          รายการนี้ไม่มี VAT — ยอดรวมจะเท่ากับยอดเงินที่กรอกทั้งหมด และจะไม่ปรากฏในรายงานภาษีซื้อ
        </p>
      )}
      {isNonClaimable && (
        <p className="rounded-[10px] border border-border bg-page-bg px-3.5 py-2.5 text-xs text-text-sub">
          รายการนี้มี VAT แต่นำไปใช้เครดิตภาษีซื้อไม่ได้ — จะไม่ปรากฏในรายงานภาษีซื้อ และไม่ต้องรอรับใบกำกับภาษีก็บันทึกได้เลย
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ชื่อผู้ขาย" error={errors.vendor_name} required>
          <input
            value={form.vendor_name}
            onChange={(e) => setForm((p) => ({ ...p, vendor_name: e.target.value }))}
            className={inputClass(Boolean(errors.vendor_name))}
            data-testid="input-vendor-name"
          />
        </Field>
        <Field label="วันที่ทำรายการ" error={errors.transaction_date} required>
          <input
            type="date"
            value={form.transaction_date}
            onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))}
            className={inputClass(Boolean(errors.transaction_date))}
            data-testid="input-transaction-date"
          />
        </Field>
      </div>

      <Field label="เลขประจำตัวผู้เสียภาษี (ผู้ขาย)" error={errors.vendor_tax_id}>
        <input
          inputMode="numeric"
          maxLength={13}
          placeholder="13 หลัก (ไม่บังคับ)"
          value={form.vendor_tax_id}
          onChange={(e) => setForm((p) => ({ ...p, vendor_tax_id: e.target.value }))}
          className={inputClass(Boolean(errors.vendor_tax_id))}
          data-testid="input-vendor-tax-id"
        />
      </Field>

      <Field label="รายละเอียด">
        <input
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          className={inputClass(false)}
          data-testid="input-description"
        />
      </Field>

      {isNoVat ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ยอดเงิน (บาท)" error={errors.amount_excl_vat} required>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount_excl_vat}
              onChange={(e) => handleAmountChange(e.target.value)}
              className={inputClass(Boolean(errors.amount_excl_vat))}
              data-testid="input-amount"
            />
          </Field>
          <Field label="ยอดรวม (บาท)">
            <div
              className="font-numeric flex h-12 w-full items-center rounded-[10px] border border-border bg-page-bg px-3.5 text-sm font-semibold text-text"
              data-testid="computed-total"
            >
              {total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="ยอดก่อน VAT (บาท)" error={errors.amount_excl_vat} required>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount_excl_vat}
              onChange={(e) => handleAmountChange(e.target.value)}
              className={inputClass(Boolean(errors.amount_excl_vat))}
              data-testid="input-amount"
            />
          </Field>
          <Field label="VAT (บาท) — เสนอ 7% อัตโนมัติ" error={errors.vat_amount}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.vat_amount}
              onChange={(e) => handleVatChange(e.target.value)}
              className={inputClass(Boolean(errors.vat_amount))}
              data-testid="input-vat"
            />
          </Field>
          <Field label="ยอดรวม (บาท)">
            <div
              className="font-numeric flex h-12 w-full items-center rounded-[10px] border border-border bg-page-bg px-3.5 text-sm font-semibold text-text"
              data-testid="computed-total"
            >
              {total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </Field>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 ${showExpectedDate ? 'sm:grid-cols-2' : ''}`}>
        <Field label="เลขที่อ้างอิง">
          <input
            value={form.reference_no}
            onChange={(e) => setForm((p) => ({ ...p, reference_no: e.target.value }))}
            className={inputClass(false)}
            data-testid="input-reference-no"
          />
        </Field>
        {showExpectedDate && (
          <Field label="วันที่คาดว่าจะได้รับใบกำกับภาษี" error={errors.expected_date}>
            <input
              type="date"
              value={form.expected_date}
              onChange={(e) => setForm((p) => ({ ...p, expected_date: e.target.value }))}
              className={inputClass(Boolean(errors.expected_date))}
              data-testid="input-expected-date"
            />
          </Field>
        )}
      </div>

      {isNonClaimable && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="เลขที่ใบกำกับภาษี (ถ้ามี)">
            <input
              value={form.tax_invoice_number}
              onChange={(e) => setForm((p) => ({ ...p, tax_invoice_number: e.target.value }))}
              className={inputClass(false)}
              data-testid="input-tax-invoice-number"
            />
          </Field>
          <Field label="วันที่ใบกำกับภาษี (ถ้ามี)">
            <input
              type="date"
              value={form.tax_invoice_date}
              onChange={(e) => setForm((p) => ({ ...p, tax_invoice_date: e.target.value }))}
              className={inputClass(false)}
              data-testid="input-tax-invoice-date"
            />
          </Field>
        </div>
      )}

      <Field label="หมายเหตุ">
        <textarea
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          rows={2}
          className={inputClass(false)}
          data-testid="input-notes"
        />
      </Field>

      {submitError && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-press rounded-[10px] border border-border bg-white px-5 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-press rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-60"
          data-testid="submit-invoice-form"
        >
          {submitting ? 'กำลังบันทึก...' : editingInvoice ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
        </button>
      </div>
    </form>
  );
}

function inputClass(hasError: boolean): string {
  const base =
    'w-full rounded-[10px] border bg-white px-3.5 py-3.5 text-sm text-text placeholder:text-text-sub transition-colors duration-[250ms] focus:outline-none';
  if (hasError) {
    return `${base} border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgba(239,68,68,0.14)]`;
  }
  return `${base} border-border focus-ring-primary`;
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-text">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}
