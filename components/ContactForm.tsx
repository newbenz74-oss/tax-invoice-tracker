'use client';

import { useState, type FormEvent } from 'react';
import type { BranchType, BusinessPartner, ContactFormInput, EntityType, PartnerType } from '@/types/contact';
import {
  BRANCH_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
  PARTNER_TYPE_LABELS,
  generateNextContactCode,
  normalizeContactCode,
  validateContactForm,
} from '@/lib/contactLogic';

const EMPTY_FORM: ContactFormInput = {
  partner_type: '',
  contact_code: '',
  entity_type: '',
  company_name: '',
  first_name: '',
  last_name: '',
  tax_id: '',
  branch_type: 'head_office',
  branch_number: '',
  address: '',
  subdistrict: '',
  district: '',
  province: '',
  postal_code: '',
  phone: '',
  email: '',
  contact_person: '',
  note: '',
  status: 'active',
};

function contactToForm(contact: BusinessPartner): ContactFormInput {
  return {
    partner_type: contact.partner_type,
    contact_code: contact.contact_code,
    entity_type: contact.entity_type,
    company_name: contact.company_name ?? '',
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    tax_id: contact.tax_id ?? '',
    branch_type: contact.branch_type,
    branch_number: contact.branch_number ?? '',
    address: contact.address ?? '',
    subdistrict: contact.subdistrict ?? '',
    district: contact.district ?? '',
    province: contact.province ?? '',
    postal_code: contact.postal_code ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    contact_person: contact.contact_person ?? '',
    note: contact.note ?? '',
    status: contact.status,
  };
}

interface ContactFormProps {
  editingContact?: BusinessPartner | null;
  existingContacts: BusinessPartner[];
  /** true = โหมด "ดูรายละเอียด" เท่านั้น ทุกฟิลด์ปิดใช้งาน ไม่มีปุ่มบันทึก */
  readOnly?: boolean;
  onSubmit: (input: ContactFormInput) => Promise<void>;
  onCancel: () => void;
  /** ใช้เฉพาะตอน readOnly — สลับไปโหมดแก้ไขโดยไม่ต้องปิด modal แล้วเปิดใหม่ */
  onRequestEdit?: () => void;
}

export default function ContactForm({
  editingContact,
  existingContacts,
  readOnly = false,
  onSubmit,
  onCancel,
  onRequestEdit,
}: ContactFormProps) {
  const [form, setForm] = useState<ContactFormInput>(
    editingContact ? contactToForm(editingContact) : EMPTY_FORM
  );
  // รหัสเสนอให้อัตโนมัติตามประเภทที่เลือก (เฉพาะตอนเพิ่มรายชื่อใหม่) — เลิกเสนอให้ทันทีที่ผู้ใช้แก้ไข
  // ช่องรหัสเอง (เหมือน pattern vatTouched ใน InvoiceForm.tsx)
  const [codeTouched, setCodeTouched] = useState(Boolean(editingContact));
  const [errors, setErrors] = useState<Partial<Record<keyof ContactFormInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // component นี้ต้องถูก mount ใหม่ทุกครั้งที่เปลี่ยนรายชื่อที่แก้ไข (parent ส่ง
  // key={editingContact?.id ?? 'new'}) เพื่อรีเซ็ตฟอร์มผ่าน useState initializer เหมือน InvoiceForm.tsx

  function handlePartnerTypeChange(value: string) {
    const partnerType = value as PartnerType;
    setForm((prev) => {
      const next = { ...prev, partner_type: partnerType };
      if (!codeTouched && !editingContact) {
        next.contact_code = generateNextContactCode(partnerType, existingContacts);
      }
      return next;
    });
  }

  function handleCodeChange(value: string) {
    setCodeTouched(true);
    setForm((prev) => ({ ...prev, contact_code: value }));
  }

  function handleEntityTypeChange(value: string) {
    setForm((prev) => ({ ...prev, entity_type: value as EntityType }));
  }

  function handleBranchTypeChange(value: string) {
    setForm((prev) => ({ ...prev, branch_type: value as BranchType }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const validationErrors = validateContactForm(form, {
      existing: existingContacts,
      editingId: editingContact?.id ?? null,
    });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({ ...form, contact_code: normalizeContactCode(form.contact_code) });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  const isCompany = form.entity_type === 'company';
  const isIndividual = form.entity_type === 'individual';
  const isBranch = form.branch_type === 'branch';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate data-testid="contact-form">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ประเภท" error={errors.partner_type} required>
          <select
            value={form.partner_type}
            onChange={(e) => handlePartnerTypeChange(e.target.value)}
            className={inputClass(Boolean(errors.partner_type))}
            disabled={readOnly}
            data-testid="select-partner-type"
          >
            <option value="" disabled>
              -- เลือกประเภท --
            </option>
            {(Object.keys(PARTNER_TYPE_LABELS) as PartnerType[]).map((pt) => (
              <option key={pt} value={pt}>
                {PARTNER_TYPE_LABELS[pt]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="รหัส" error={errors.contact_code} required>
          <input
            value={form.contact_code}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="เช่น CUS0001"
            className={inputClass(Boolean(errors.contact_code))}
            disabled={readOnly}
            data-testid="input-contact-code"
          />
        </Field>
      </div>

      <Field label="ประเภทบุคคล" error={errors.entity_type} required>
        <select
          value={form.entity_type}
          onChange={(e) => handleEntityTypeChange(e.target.value)}
          className={inputClass(Boolean(errors.entity_type))}
          disabled={readOnly}
          data-testid="select-entity-type"
        >
          <option value="" disabled>
            -- เลือกประเภทบุคคล --
          </option>
          {(Object.keys(ENTITY_TYPE_LABELS) as EntityType[]).map((et) => (
            <option key={et} value={et}>
              {ENTITY_TYPE_LABELS[et]}
            </option>
          ))}
        </select>
      </Field>

      {isCompany && (
        <Field label="ชื่อบริษัท" error={errors.company_name} required>
          <input
            value={form.company_name}
            onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
            className={inputClass(Boolean(errors.company_name))}
            disabled={readOnly}
            data-testid="input-company-name"
          />
        </Field>
      )}

      {isIndividual && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ชื่อ" error={errors.first_name} required>
            <input
              value={form.first_name}
              onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))}
              className={inputClass(Boolean(errors.first_name))}
              disabled={readOnly}
              data-testid="input-first-name"
            />
          </Field>
          <Field label="นามสกุล" error={errors.last_name} required>
            <input
              value={form.last_name}
              onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))}
              className={inputClass(Boolean(errors.last_name))}
              disabled={readOnly}
              data-testid="input-last-name"
            />
          </Field>
        </div>
      )}

      <Field label="เลขประจำตัวผู้เสียภาษี" error={errors.tax_id}>
        <input
          inputMode="numeric"
          maxLength={13}
          placeholder="13 หลัก (ไม่บังคับ)"
          value={form.tax_id}
          onChange={(e) => setForm((p) => ({ ...p, tax_id: e.target.value }))}
          className={inputClass(Boolean(errors.tax_id))}
          disabled={readOnly}
          data-testid="input-tax-id"
        />
      </Field>

      <div className={`grid grid-cols-1 gap-4 ${isBranch ? 'sm:grid-cols-2' : ''}`}>
        <Field label="สาขา" error={errors.branch_type}>
          <select
            value={form.branch_type}
            onChange={(e) => handleBranchTypeChange(e.target.value)}
            className={inputClass(Boolean(errors.branch_type))}
            disabled={readOnly}
            data-testid="select-branch-type"
          >
            {(Object.keys(BRANCH_TYPE_LABELS) as BranchType[]).map((bt) => (
              <option key={bt} value={bt}>
                {BRANCH_TYPE_LABELS[bt]}
              </option>
            ))}
          </select>
        </Field>
        {isBranch && (
          <Field label="เลขที่สาขา" error={errors.branch_number} required>
            <input
              inputMode="numeric"
              maxLength={5}
              placeholder="เช่น 00001"
              value={form.branch_number}
              onChange={(e) => setForm((p) => ({ ...p, branch_number: e.target.value }))}
              className={inputClass(Boolean(errors.branch_number))}
              disabled={readOnly}
              data-testid="input-branch-number"
            />
          </Field>
        )}
      </div>

      <Field label="ที่อยู่" error={errors.address}>
        <input
          value={form.address}
          onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
          className={inputClass(false)}
          disabled={readOnly}
          data-testid="input-address"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ตำบล/แขวง" error={errors.subdistrict}>
          <input
            value={form.subdistrict}
            onChange={(e) => setForm((p) => ({ ...p, subdistrict: e.target.value }))}
            className={inputClass(false)}
            disabled={readOnly}
            data-testid="input-subdistrict"
          />
        </Field>
        <Field label="อำเภอ/เขต" error={errors.district}>
          <input
            value={form.district}
            onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
            className={inputClass(false)}
            disabled={readOnly}
            data-testid="input-district"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="จังหวัด" error={errors.province}>
          <input
            value={form.province}
            onChange={(e) => setForm((p) => ({ ...p, province: e.target.value }))}
            className={inputClass(false)}
            disabled={readOnly}
            data-testid="input-province"
          />
        </Field>
        <Field label="รหัสไปรษณีย์" error={errors.postal_code}>
          <input
            inputMode="numeric"
            maxLength={5}
            value={form.postal_code}
            onChange={(e) => setForm((p) => ({ ...p, postal_code: e.target.value }))}
            className={inputClass(Boolean(errors.postal_code))}
            disabled={readOnly}
            data-testid="input-postal-code"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="เบอร์โทรศัพท์" error={errors.phone}>
          <input
            value={form.phone}
            onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className={inputClass(Boolean(errors.phone))}
            disabled={readOnly}
            data-testid="input-phone"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className={inputClass(Boolean(errors.email))}
            disabled={readOnly}
            data-testid="input-email"
          />
        </Field>
      </div>

      <Field label="ผู้ติดต่อ" error={errors.contact_person}>
        <input
          value={form.contact_person}
          onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
          className={inputClass(false)}
          disabled={readOnly}
          data-testid="input-contact-person"
        />
      </Field>

      <Field label="หมายเหตุ" error={errors.note}>
        <textarea
          value={form.note}
          onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          rows={2}
          className={inputClass(false)}
          disabled={readOnly}
          data-testid="input-note"
        />
      </Field>

      <Field label="สถานะ" error={errors.status}>
        <select
          value={form.status}
          onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ContactFormInput['status'] }))}
          className={inputClass(false)}
          disabled={readOnly}
          data-testid="select-status"
        >
          <option value="active">เปิดใช้งาน</option>
          <option value="inactive">ไม่ใช้งาน</option>
        </select>
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
          {readOnly ? 'ปิด' : 'ยกเลิก'}
        </button>
        {readOnly ? (
          onRequestEdit && (
            <button
              key="switch-to-edit-button"
              type="button"
              onClick={onRequestEdit}
              className="btn-press rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              data-testid="switch-to-edit"
            >
              แก้ไข
            </button>
          )
        ) : (
          <button
            key="submit-contact-form-button"
            type="submit"
            disabled={submitting}
            className="btn-press rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-60"
            data-testid="submit-contact-form"
          >
            {submitting ? 'กำลังบันทึก...' : editingContact ? 'บันทึกการแก้ไข' : 'เพิ่มรายชื่อ'}
          </button>
        )}
      </div>
    </form>
  );
}

function inputClass(hasError: boolean): string {
  const base =
    'w-full rounded-[10px] border bg-white px-3.5 py-3.5 text-sm text-text placeholder:text-text-sub transition-colors duration-[250ms] focus:outline-none disabled:cursor-not-allowed disabled:bg-page-bg disabled:opacity-70';
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
