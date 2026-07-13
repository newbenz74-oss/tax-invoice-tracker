'use client';

import { useState, type FormEvent } from 'react';
import type { InvoiceFormInput, PendingTaxInvoice } from '@/types/invoice';
import { calcTotal, suggestVatAmount, validateInvoiceForm } from '@/lib/invoiceLogic';

const EMPTY_FORM: InvoiceFormInput = {
  vendor_name: '',
  transaction_date: '',
  description: '',
  amount_excl_vat: '',
  vat_amount: '',
  reference_no: '',
  expected_date: '',
  notes: '',
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

  const amountNum = parseFloat(form.amount_excl_vat) || 0;
  const vatNum = parseFloat(form.vat_amount) || 0;
  const total = calcTotal(amountNum, vatNum);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationErrors = validateInvoiceForm(form);
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
    <form onSubmit={handleSubmit} className="space-y-4" noValidate data-testid="invoice-form">
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

      <Field label="รายละเอียด">
        <input
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          className={inputClass(false)}
          data-testid="input-description"
        />
      </Field>

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
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700"
            data-testid="computed-total"
          >
            {total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="เลขที่อ้างอิง">
          <input
            value={form.reference_no}
            onChange={(e) => setForm((p) => ({ ...p, reference_no: e.target.value }))}
            className={inputClass(false)}
            data-testid="input-reference-no"
          />
        </Field>
        <Field label="วันที่คาดว่าจะได้รับใบกำกับภาษี" error={errors.expected_date}>
          <input
            type="date"
            value={form.expected_date}
            onChange={(e) => setForm((p) => ({ ...p, expected_date: e.target.value }))}
            className={inputClass(Boolean(errors.expected_date))}
            data-testid="input-expected-date"
          />
        </Field>
      </div>

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
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          data-testid="submit-invoice-form"
        >
          {submitting ? 'กำลังบันทึก...' : editingInvoice ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
        </button>
      </div>
    </form>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
  }`;
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
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
