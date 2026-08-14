'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Building2, ImageOff, Loader2, Trash2, Upload } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { removeCompanyLogo, updateCompanySettings, uploadCompanyLogo, type Company, type CompanySettingsInput } from '@/lib/companyApi';
import { validateCompanySettingsForm } from '@/lib/companyLogic';
import { BRANCH_TYPE_LABELS } from '@/lib/contactLogic';
import { removeWhiteBackground } from '@/lib/logoBackgroundRemoval';
import type { BranchType } from '@/types/contact';

/** ขนาดไฟล์โลโก้ต้นฉบับสูงสุดที่รับ (2MB) — ต้องตรงกับ file_size_limit ของ bucket "company-logos"
 * (supabase/migration_017_company_logo.sql) เช็คฝั่ง client ก่อนเพื่อไม่ต้องรอ round-trip ไป storage แล้วเจอ
 * error ย้อนกลับมาโดยไม่จำเป็น */
const MAX_LOGO_FILE_BYTES = 2 * 1024 * 1024;
/** ความละเอียดสูงสุดของด้านยาวที่สุดหลังประมวลผล — โลโก้แสดงผลจริงเล็กมาก (ไอคอน ≤48px ใน Header/หน้าเลือก
 * บริษัท) ไม่จำเป็นต้องเก็บไฟล์ต้นฉบับความละเอียดสูงที่ผู้ใช้อาจอัปโหลดมา (เช่นรูปสแกน 3000px) ย่อลงมาก่อน
 * ประมวลผลลบพื้นหลัง ช่วยทั้งความเร็วในการประมวลผลและขนาดไฟล์ที่อัปโหลดจริง */
const MAX_LOGO_DIMENSION = 512;

/** โหลดไฟล์รูปภาพเป็น HTMLImageElement ผ่าน object URL ชั่วคราว — ใช้ Promise ห่อ event-based API ของ
 * HTMLImageElement ให้เรียกแบบ async/await ได้ตรงไปตรงมา */
function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้ กรุณาลองไฟล์อื่น'));
    };
    img.src = objectUrl;
  });
}

/**
 * วาดไฟล์รูปภาพต้นฉบับลง canvas (ย่อขนาดถ้าใหญ่เกิน MAX_LOGO_DIMENSION) แล้วลบพื้นหลังสีขาวออกด้วย
 * lib/logoBackgroundRemoval.ts (ตรรกะล้วนๆ แยกไฟล์ไว้แล้ว เทสต์ได้โดยไม่ต้องพึ่ง canvas จริง) คืนค่าเป็น Blob
 * PNG พื้นหลังโปร่งใส พร้อมอัปโหลดขึ้น storage ต่อทันที — เป็นตัวอย่างเดียวของโปรเจกต์นี้ที่ประมวลผลรูปภาพฝั่ง
 * client ล้วนๆ (ไม่พึ่ง library ภายนอกใดๆ ตามธรรมเนียมเดิมที่ lib/assistantChromaKey.ts วางไว้)
 */
async function removeWhiteBackgroundFromFile(file: File): Promise<Blob> {
  const img = await loadImageFile(file);
  const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการประมวลผลรูปภาพ');

  ctx.drawImage(img, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  removeWhiteBackground(frame.data);
  ctx.putImageData(frame, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('แปลงไฟล์โลโก้ไม่สำเร็จ กรุณาลองใหม่'));
    }, 'image/png');
  });
}

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

  // สถานะ "โลโก้บริษัท" (เพิ่มเข้ามา 2026-08-14) — แยกวงจร async ออกจากฟอร์มข้อความด้านบนโดยสิ้นเชิง (อัปโหลด/
  // ลบทันทีที่ผู้ใช้กด ไม่ต้องรอกดปุ่ม "บันทึก" ของฟอร์มหลัก) เพราะเป็นการอัปโหลดไฟล์ที่มีสถานะ busy/error ของ
  // ตัวเอง ต่างธรรมชาติจากการแก้ไข text field ล้วนๆ
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

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
      setLogoError(null);
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

  async function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // ล้างค่า input ทันทีไม่ว่าผลจะเป็นอย่างไร — เพื่อให้เลือกไฟล์เดิมซ้ำได้อีกครั้งถ้าอัปโหลดครั้งแรกล้มเหลว
    // (input[type=file] ไม่ยิง onChange ถ้าเลือกไฟล์เดิมซ้ำโดยไม่ล้างค่าก่อน)
    e.target.value = '';
    if (!file || !selectedCompany) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('รองรับเฉพาะไฟล์รูปภาพเท่านั้น');
      return;
    }
    if (file.size > MAX_LOGO_FILE_BYTES) {
      setLogoError('ไฟล์ใหญ่เกินไป (จำกัด 2MB)');
      return;
    }

    setLogoBusy(true);
    setLogoError(null);
    try {
      const processedBlob = await removeWhiteBackgroundFromFile(file);
      await uploadCompanyLogo(selectedCompany.id, processedBlob);
      reload();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'อัปโหลดโลโก้ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleRemoveLogo() {
    if (!selectedCompany) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      await removeCompanyLogo(selectedCompany.id);
      reload();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'ลบโลโก้ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLogoBusy(false);
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
        <Section title="โลโก้บริษัท" first>
          <div className="flex items-center gap-4">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#f1f3f5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]"
              data-testid="company-logo-preview"
            >
              {selectedCompany.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL มาจาก Supabase Storage (ไม่ใช่โดเมนคงที่ที่ตั้งไว้ล่วงหน้าใน next.config) และเป็นไอคอนขนาดเล็กมาก ไม่คุ้มความซับซ้อนของ next/image
                <img src={selectedCompany.logo_url} alt="โลโก้บริษัท" className="h-full w-full object-contain p-2" />
              ) : (
                <ImageOff className="h-6 w-6 text-text-sub/50" aria-hidden="true" />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={logoBusy}
                  onClick={() => logoFileInputRef.current?.click()}
                  className="btn-press inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3.5 py-2 text-xs font-semibold text-text-sub hover:bg-page-bg hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="upload-company-logo"
                >
                  {logoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                  {selectedCompany.logo_url ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
                </button>
                {selectedCompany.logo_url && (
                  <button
                    type="button"
                    disabled={logoBusy}
                    onClick={handleRemoveLogo}
                    className="btn-press inline-flex items-center gap-1.5 rounded-[10px] border border-danger/30 px-3.5 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="remove-company-logo"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    ลบโลโก้
                  </button>
                )}
              </div>
              <p className="text-xs text-text-sub">
                ไฟล์รูปภาพพื้นหลังสีขาว ระบบจะตัดพื้นหลังสีขาวออกให้อัตโนมัติ แสดงที่หัวเว็บและหน้าเลือกบริษัท (ไม่เกิน 2MB)
              </p>
              {logoError && (
                <p role="alert" className="text-xs text-danger">
                  {logoError}
                </p>
              )}
            </div>

            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoFileChange}
              className="hidden"
              data-testid="company-logo-file-input"
            />
          </div>
        </Section>

        <Section title="ข้อมูลภาษี">
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
