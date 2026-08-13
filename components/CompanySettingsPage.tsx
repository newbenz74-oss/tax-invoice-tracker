'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { updateCompanySettings, type Company, type CompanySettingsInput } from '@/lib/companyApi';
import { validateCompanySettingsForm } from '@/lib/companyLogic';
import { BRANCH_TYPE_LABELS } from '@/lib/contactLogic';
import type { BranchType } from '@/types/contact';

const EMPTY_FORM: CompanySettingsInput = {
  tax_id: '',
  branch_type: 'head_office',
  branch_number: '',
  address: '',
  subdistrict: '',
  district: '',
  province: '',
  postal_code: '',
  default_signer_name: '',
};

function companyToForm(company: Company): CompanySettingsInput {
  return {
    tax_id: company.tax_id ?? '',
    branch_type: company.branch_type,
    branch_number: company.branch_number ?? '',
    address: company.address ?? '',
    subdistrict: company.subdistrict ?? '',
    district: company.district ?? '',
    province: company.province ?? '',
    postal_code: company.postal_code ?? '',
    default_signer_name: company.default_signer_name ?? '',
  };
}

/**
 * หน้า "ตั้งค่าบริษัท" (เพิ่มเข้ามา 2026-08-11) — พื้นฐานแรกของฟีเจอร์ "ออกใบหัก ณ ที่จ่าย": เก็บข้อมูลฝั่ง
 * "ผู้มีหน้าที่หักภาษี ณ ที่จ่าย" (ผู้จ่ายเงิน = บริษัทของผู้ใช้เอง) ไว้ครั้งเดียว ใช้ซ้ำได้ทุกครั้งที่ออกใบ
 * ไม่ต้องกรอกใหม่ทุกครั้ง — สมาชิกบริษัททุกคนแก้ไขได้เหมือนกันหมด (ไม่ใช่แค่แอดมิน ต่างจากหน้า
 * "อนุมัติสมาชิกใหม่") ดู supabase/migration_013_company_settings.sql สำหรับ policy "update_member_companies"
 *
 * ต่างจาก InvoiceForm.tsx/ContactForm.tsx ที่ remount ใหม่ทั้ง component ผ่าน key จาก parent ทุกครั้งที่
 * เปลี่ยนรายการที่แก้ไข (เพราะเป็นฟอร์มที่เปิด/ปิดเป็นครั้งๆ ใน modal) หน้านี้ mount ค้างอยู่ตราบใดที่ยังอยู่ใน
 * เมนู "ตั้งค่าบริษัท" จึงต้องคอยเช็คเองว่า selectedCompany (จากปุ่ม "สลับบริษัท" ที่ Header.tsx) เปลี่ยนไป
 * หรือไม่แล้วรีเซ็ตฟอร์มเอง — เทียบจาก selectedCompany?.id ที่ sync ล่าสุด (ไม่ใช่ selectedCompanyId ตรงๆ)
 * เพื่อครอบคลุมทั้งกรณีสลับบริษัทจริงๆ และกรณี companies ยังโหลดไม่เสร็จตอน mount ครั้งแรกแล้วมาถึงทีหลัง
 * (ทั้งสองกรณี selectedCompany?.id "เปลี่ยนจากค่าที่เคย sync ไว้ล่าสุด" เหมือนกัน) setState ห่อด้วย
 * Promise.resolve().then() ตาม pattern เดียวกับ lib/CompanyContext.tsx/lib/AuthContext.tsx ทุกจุดในโปรเจกต์
 * นี้ (กฎ react-hooks/set-state-in-effect: ห้าม setState ตรงๆ ใน effect body แบบไม่มี async คั่นกลาง)
 */
export default function CompanySettingsPage() {
  const { selectedCompany, reload } = useCompany();
  const [form, setForm] = useState<CompanySettingsInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof CompanySettingsInput, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const syncedCompanyIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = selectedCompany?.id ?? null;
    if (syncedCompanyIdRef.current === currentId) return;
    Promise.resolve().then(() => {
      syncedCompanyIdRef.current = currentId;
      setForm(selectedCompany ? companyToForm(selectedCompany) : EMPTY_FORM);
      setErrors({});
      setSaveError(null);
      setSavedAt(null);
    });
  }, [selectedCompany]);

  const isBranch = form.branch_type === 'branch';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompany) return;
    const validationErrors = validateCompanySettingsForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      await updateCompanySettings(selectedCompany.id, form);
      reload();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  }

  if (!selectedCompany) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">
        <div className="flex items-center justify-center py-16 text-sm text-text-sub" data-testid="company-settings-loading">
          กำลังโหลด...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
          <Building2 className="h-5 w-5 text-primary" strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">ตั้งค่าบริษัท</h1>
          <p className="mt-1 text-sm text-text-sub">
            ข้อมูลของ {selectedCompany.name} — ใช้เป็นข้อมูล &quot;ผู้มีหน้าที่หักภาษี ณ ที่จ่าย&quot; บนใบหัก ณ ที่จ่ายที่ออก กรอกครั้งเดียวใช้ได้ตลอด
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="card-surface space-y-6 rounded-2xl bg-white p-6 sm:p-8"
        noValidate
        data-testid="company-settings-form"
      >
        <Section title="ข้อมูลภาษี" first>
          <Field label="เลขประจำตัวผู้เสียภาษี" error={errors.tax_id}>
            <input
              inputMode="numeric"
              maxLength={13}
              placeholder="13 หลัก (ไม่บังคับ)"
              value={form.tax_id}
              onChange={(e) => setForm((p) => ({ ...p, tax_id: e.target.value }))}
              className={inputClass(Boolean(errors.tax_id))}
              data-testid="input-tax-id"
            />
          </Field>

          <div className={`grid grid-cols-1 gap-4 ${isBranch ? 'md:grid-cols-2' : ''}`}>
            <Field label="สาขา" error={errors.branch_type}>
              <select
                value={form.branch_type}
                onChange={(e) => setForm((p) => ({ ...p, branch_type: e.target.value as BranchType }))}
                className={inputClass(Boolean(errors.branch_type))}
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
                  data-testid="input-branch-number"
                />
              </Field>
            )}
          </div>
        </Section>

        <Section title="ที่อยู่">
          <Field label="ที่อยู่" error={errors.address}>
            <input
              value={form.address}
              onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              className={inputClass(false)}
              data-testid="input-address"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="ตำบล/แขวง" error={errors.subdistrict}>
              <input
                value={form.subdistrict}
                onChange={(e) => setForm((p) => ({ ...p, subdistrict: e.target.value }))}
                className={inputClass(false)}
                data-testid="input-subdistrict"
              />
            </Field>
            <Field label="อำเภอ/เขต" error={errors.district}>
              <input
                value={form.district}
                onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
                className={inputClass(false)}
                data-testid="input-district"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="จังหวัด" error={errors.province}>
              <input
                value={form.province}
                onChange={(e) => setForm((p) => ({ ...p, province: e.target.value }))}
                className={inputClass(false)}
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
                data-testid="input-postal-code"
              />
            </Field>
          </div>
        </Section>

        <Section title="ใบหัก ณ ที่จ่าย">
          <Field label="ชื่อผู้ลงนามเริ่มต้น" error={errors.default_signer_name}>
            <input
              placeholder="ไม่บังคับ — แก้ไขได้ทุกครั้งตอนออกใบจริง"
              value={form.default_signer_name}
              onChange={(e) => setForm((p) => ({ ...p, default_signer_name: e.target.value }))}
              className={inputClass(false)}
              data-testid="input-default-signer-name"
            />
          </Field>
        </Section>

        {saveError && (
          <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {saveError}
          </p>
        )}
        {savedAt && !saveError && (
          <p role="status" className="rounded-[10px] border border-success/20 bg-success/10 px-3.5 py-2.5 text-sm text-success">
            บันทึกสำเร็จ
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="btn-press rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="save-company-settings"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </main>
  );
}

// กล่อง input จริงๆ มี bg-white ของตัวเอง (ไม่ติด .card-surface) จึงเป็นกล่องขาวทึบจริง ใช้ text-gray-800/
// placeholder:text-gray-400 ถูกต้องแล้ว — ต่างจากหัวข้อ/label ด้านล่างที่วางตรงบนพื้น .card-surface (กระจก
// เข้มเสมอ ดู app/globals.css) ต้องใช้สีอ่อน text-text/text-text-sub แทน (2026-08-12)
function inputClass(hasError: boolean): string {
  const base =
    'h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm text-gray-800 placeholder:text-gray-400 transition-colors duration-[250ms] focus:outline-none';
  if (hasError) {
    return `${base} border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgba(239,68,68,0.14)]`;
  }
  return `${base} border-border focus-ring-primary`;
}

function Section({ title, first, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? 'space-y-4' : 'space-y-4 border-t border-border/70 pt-6'}>
      <h3 className="text-xs font-bold text-text-sub">{title}</h3>
      {children}
    </div>
  );
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
