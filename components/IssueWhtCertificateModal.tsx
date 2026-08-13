'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PendingTaxInvoice } from '@/types/invoice';
import type { BusinessPartner } from '@/types/contact';
import type { Company } from '@/lib/companyApi';
import type { CreateWhtCertificateInput, WhtCertificate, WhtDeductionType, WhtIncomeTypeCode } from '@/types/whtCertificate';
import {
  DEDUCTION_TYPE_LABELS,
  INCOME_TYPE_LABELS,
  buildPayeeSnapshot,
  buildPayerSnapshot,
  findPayeeCandidates,
  formTypeForEntityType,
} from '@/lib/whtCertificateLogic';
import { createWhtCertificate } from '@/lib/whtCertificateApi';
import { getContactDisplayName } from '@/lib/contactLogic';
import { calcNetPayment } from '@/lib/invoiceLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ค่าเริ่มต้นของฟอร์ม ใช้ตอนแก้ไขใบเดิม (mode="reissue") — พรีฟิลด้วยข้อมูลจากใบที่ถูกยกเลิกไปแล้ว เพื่อให้
 * ผู้ใช้แก้เฉพาะจุดที่ผิดแล้วออกใบใหม่ ไม่ต้องกรอกซ้ำทั้งหมด */
export interface WhtCertificateFormPrefill {
  incomeTypeCode: WhtIncomeTypeCode;
  incomeTypeLabel: string;
  deductionType: WhtDeductionType;
  deductionTypeNote: string;
  signerName: string;
  issuedDate: string;
}

interface IssueWhtCertificateModalProps {
  invoices: PendingTaxInvoice[]; // ต้องเป็นผู้ขายเดียวกันทั้งหมด (เช็คซ้ำที่ผู้เรียกก่อนเปิด modal นี้แล้ว)
  contacts: BusinessPartner[];
  company: Company;
  companyId: string;
  createdByEmail: string | null;
  onClose: () => void;
  onIssued: (cert: WhtCertificate) => void;
  onGoToContacts?: () => void; // ไปหน้าสมุดรายชื่อ — ใช้ตอนหาผู้ขายไม่เจอ (ไม่บังคับส่งมา)
  // เพิ่มเข้ามาพร้อมปุ่ม "แก้ไข" ในหน้าประวัติ (2026-08-11) — mode="reissue" หมายถึงใบเดิมถูกยกเลิก
  // (void_wht_certificate) ไปแล้วก่อนเปิด modal นี้ กำลังจะออกใบใหม่แทนที่ ไม่ใช่การแก้ไขใบเดิมตรงๆ
  // (เอกสารทางการต้องมีเลขที่ต่อเนื่อง ไม่ย้อนกลับไปแก้ใบที่ออกไปแล้ว — ดู migration_016 สำหรับเหตุผลเต็ม)
  mode?: 'issue' | 'reissue';
  voidedCertNumber?: string; // เลขที่ใบเดิมที่ถูกยกเลิกไป — แสดงเป็นข้อความแจ้งเตือนตอน mode="reissue"
  prefill?: WhtCertificateFormPrefill;
}

/** Modal ออกใบหัก ณ ที่จ่ายจากรายการจ่ายเงินที่เลือกไว้ (1 รายการขึ้นไป ผู้ขายเดียวกันทั้งหมด) — เพิ่มเข้ามา
 * พร้อมพื้นฐานฟีเจอร์นี้ (2026-08-11)
 *
 * ปรับปรุง (2026-08-12 — ผู้ใช้ขอ) เดิมบังคับจับคู่ผู้ขายกับสมุดรายชื่อแบบชื่อตรงกันเป๊ะๆ เท่านั้น (ดู
 * lib/whtCertificateLogic.ts findPayeeCandidates) ถ้าหาไม่เจอเลยจะบล็อกไม่ให้ออกใบไปเลย — แต่ในทางปฏิบัติ
 * ชื่อผู้ขายบนรายการจ่ายเงิน (vendor_name) กับชื่อ "ผู้ถูกหักภาษี ณ ที่จ่าย" จริง อาจเป็นคนละคน/บริษัทกันได้
 * (เช่น จ่ายเงินให้ตัวแทน แต่ต้องออกใบให้เจ้าของจริง) จึงเปลี่ยนเป็น: ยังคง auto-select ให้ถ้าเจอชื่อตรงกันเป๊ะ
 * (สะดวก ไม่ต้องเลือกเองทุกครั้งในกรณีปกติ) แต่ผู้ใช้เลือกรายชื่อผู้ขาย (partner_type='vendor', active) คนไหน
 * ก็ได้จากสมุดรายชื่อทั้งหมดเสมอ ไม่บังคับให้ตรงชื่อกับ vendor_name อีกต่อไป — บล็อกไม่ให้ออกใบเฉพาะกรณีเดียว
 * คือสมุดรายชื่อยังไม่มีรายชื่อผู้ขายเลยแม้แต่รายเดียว (ไม่มีตัวเลือกให้เลือกจริงๆ)
 *
 * เลขที่ใบ (cert_number) ไม่แสดง preview ในฟอร์มนี้เลย เพราะรันจริงผ่าน RPC create_wht_certificate() ตอน
 * กดยืนยันเท่านั้น (atomic กับการขอเลขที่ถัดไป — ดู supabase/migration_015_wht_certificates.sql) periodYear/
 * periodMonth ที่ส่งเข้า RPC คำนวณจาก issuedDate เสมอ (เดือน/ปีที่ออกใบจริง ไม่ใช่เดือนที่ทำรายการจ่ายเงิน)
 *
 * mode="reissue" (เพิ่มเข้ามาพร้อมปุ่ม "แก้ไข" ในหน้าประวัติ, 2026-08-11) ใช้ modal เดียวกันนี้ทุกประการ
 * เพียงพรีฟิลค่าฟอร์มด้วย prefill (จากใบเดิมที่ผู้เรียกยกเลิกไปแล้วผ่าน voidWhtCertificate() ก่อนเปิด modal
 * นี้) ยังคงเรียก createWhtCertificate() ตัวเดิมตอนกดยืนยัน (ได้เลขที่ใหม่ต่อเนื่อง ไม่มีการ "แก้ไข" ใบเดิม
 * ตรงๆ ในฐานข้อมูล — ดู supabase/migration_016_void_wht_certificate.sql สำหรับเหตุผลเต็ม)
 */
export default function IssueWhtCertificateModal({
  invoices,
  contacts,
  company,
  companyId,
  createdByEmail,
  onClose,
  onIssued,
  onGoToContacts,
  mode = 'issue',
  voidedCertNumber,
  prefill,
}: IssueWhtCertificateModalProps) {
  const vendorName = invoices[0]?.vendor_name.trim() ?? '';
  const vendorNameMismatch = invoices.some((inv) => inv.vendor_name.trim() !== vendorName);

  // ตัวเลือกทั้งหมดที่เลือกออกใบให้ได้ — ผู้ขายที่ active ทุกคนในสมุดรายชื่อ ไม่จำกัดแค่ชื่อที่ตรงกับ
  // vendor_name อีกต่อไป (2026-08-12) เรียงตามชื่อที่แสดงผลให้หาง่าย
  const vendorContacts = useMemo(
    () =>
      contacts
        .filter((c) => c.partner_type === 'vendor' && c.status === 'active')
        .sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b), 'th')),
    [contacts]
  );
  // ยังคงหาชื่อที่ตรงกับ vendor_name เป๊ะๆ ไว้ใช้ auto-select ค่าเริ่มต้นให้สะดวก (กรณีปกติส่วนใหญ่ที่ชื่อตรงกัน)
  const exactMatches = useMemo(() => findPayeeCandidates(vendorName, contacts), [vendorName, contacts]);
  const [selectedContactId, setSelectedContactId] = useState<string>(() => exactMatches[0]?.id ?? '');
  const selectedContact = vendorContacts.find((c) => c.id === selectedContactId) ?? null;

  const [incomeTypeCode, setIncomeTypeCode] = useState<WhtIncomeTypeCode | ''>(prefill?.incomeTypeCode ?? '');
  const [incomeTypeLabel, setIncomeTypeLabel] = useState(prefill?.incomeTypeLabel ?? '');
  const [deductionType, setDeductionType] = useState<WhtDeductionType>(prefill?.deductionType ?? 'withholding');
  const [deductionTypeNote, setDeductionTypeNote] = useState(prefill?.deductionTypeNote ?? '');
  const [signerName, setSignerName] = useState(prefill?.signerName ?? company.default_signer_name ?? '');
  const [issuedDate, setIssuedDate] = useState(prefill?.issuedDate ?? todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalWhtAmount = invoices.reduce((sum, inv) => sum + inv.wht_amount, 0);
  const totalNetPayment = calcNetPayment(totalAmount, totalWhtAmount);

  const canSubmit =
    !vendorNameMismatch && Boolean(selectedContact) && Boolean(incomeTypeCode) && Boolean(issuedDate) && !submitting;

  async function handleSubmit() {
    if (!selectedContact || !incomeTypeCode) return;
    setSubmitting(true);
    setError(null);
    try {
      const [y, m] = issuedDate.split('-').map(Number);
      const periodYear = y + 543;
      const periodMonth = m;
      const formType = formTypeForEntityType(selectedContact.entity_type);

      const input: CreateWhtCertificateInput = {
        companyId,
        formType,
        periodYear,
        periodMonth,
        businessPartnerId: selectedContact.id,
        incomeTypeCode,
        incomeTypeLabel,
        deductionType,
        deductionTypeNote,
        signerName,
        issuedDate,
        invoiceIds: invoices.map((inv) => inv.id),
      };

      const payer = buildPayerSnapshot(company);
      const payee = buildPayeeSnapshot(selectedContact);
      const cert = await createWhtCertificate(input, payer, payee, createdByEmail);
      onIssued(cert);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ออกใบหัก ณ ที่จ่ายไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ออกใบหัก ณ ที่จ่าย"
      data-testid="issue-wht-cert-modal"
    >
      {/* การ์ด/โมดัลทั้งระบบเป็นกระจกเข้มเสมอ (card-surface ชนะ bg-white เสมอตาม CSS Cascade Layers — ดู
          คอมเมนต์เต็มใน app/globals.css) องค์ประกอบที่วางตรงบนพื้นการ์ดตรงนี้ (ไม่มีกล่อง bg-white ของ
          ตัวเอง) จึงต้องใช้สีอ่อน text-text/text-text-sub ให้อ่านออกบนพื้นเข้ม (2026-08-12) */}
      <div
        className="card-surface card-surface-modal max-h-[calc(100vh-48px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">
              {mode === 'reissue' ? 'แก้ไขใบหัก ณ ที่จ่าย (ออกใบใหม่แทน)' : 'ออกใบหัก ณ ที่จ่าย'}
            </h3>
            <p className="mt-0.5 text-sm text-text-sub">
              {vendorName} · {invoices.length} รายการ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="issue-wht-cert-close"
          >
            <X size={18} />
          </button>
        </div>

        {mode === 'reissue' && (
          <p className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            ใบเดิม{voidedCertNumber ? ` เลขที่ ${voidedCertNumber}` : ''} ถูกยกเลิกแล้ว แก้ไขข้อมูลด้านล่างแล้วกด &quot;ยืนยันออกใบ&quot;
            เพื่อออกใบใหม่แทน (จะได้เลขที่ใหม่ต่อเนื่อง ไม่ใช่เลขเดิม)
          </p>
        )}

        {vendorNameMismatch ? (
          <p className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            รายการที่เลือกมีชื่อผู้ขายไม่ตรงกัน กรุณาเลือกเฉพาะรายการของผู้ขายเดียวกันเท่านั้น
          </p>
        ) : vendorContacts.length === 0 ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
            <p>ยังไม่มีรายชื่อผู้ขายในสมุดรายชื่อเลย กรุณาเพิ่มรายชื่อที่จะออกใบหัก ณ ที่จ่ายให้ก่อน</p>
            {onGoToContacts && (
              <button
                type="button"
                onClick={onGoToContacts}
                className="btn-press mt-2 rounded-[10px] border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                ไปหน้าสมุดรายชื่อ
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* เลือกได้จากรายชื่อผู้ขายทั้งหมด ไม่บังคับให้ชื่อตรงกับ vendor_name อีกต่อไป (2026-08-12 ตามที่
                ผู้ใช้ขอ — จ่ายเงินให้คนหนึ่งแต่ต้องออกใบหักให้อีกคนได้) auto-select ให้ถ้าเจอชื่อตรงกันเป๊ะ
                (selectedContactId เริ่มต้นจาก exactMatches ด้านบน) แต่เปลี่ยนเป็นรายชื่ออื่นได้เสมอ */}
            <Field label="เลือกรายชื่อผู้รับใบหัก ณ ที่จ่าย" required>
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className={inputClass(false)}
                data-testid="select-payee-contact"
              >
                <option value="">-- เลือกรายชื่อ --</option>
                {vendorContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contact_code} — {getContactDisplayName(c)} ({c.tax_id ?? 'ไม่มีเลขผู้เสียภาษี'})
                  </option>
                ))}
              </select>
              {exactMatches.length === 0 && (
                <p className="mt-1.5 text-xs text-text-sub">
                  ไม่พบชื่อที่ตรงกับ &quot;{vendorName}&quot; ในสมุดรายชื่อ — เลือกรายชื่อที่ต้องการออกใบให้จากด้านบน
                  {onGoToContacts && (
                    <>
                      {' '}หรือ{' '}
                      <button type="button" onClick={onGoToContacts} className="text-primary underline hover:no-underline">
                        เพิ่มรายชื่อใหม่
                      </button>
                    </>
                  )}
                </p>
              )}
            </Field>

            <div className="rounded-[10px] border border-border/70 bg-page-bg/40 px-3.5 py-3 text-sm">
              <div className="flex justify-between text-text-sub">
                <span>ยอดรวม</span>
                <span className="font-numeric">{THB.format(totalAmount)} บาท</span>
              </div>
              <div className="mt-1 flex justify-between text-text-sub">
                <span>หัก ณ ที่จ่ายรวม</span>
                <span className="font-numeric">{THB.format(totalWhtAmount)} บาท</span>
              </div>
              <div className="mt-1 flex justify-between font-medium text-text">
                <span>จ่ายสุทธิ</span>
                <span className="font-numeric">{THB.format(totalNetPayment)} บาท</span>
              </div>
            </div>

            <Field label="ประเภทเงินได้" required>
              <select
                value={incomeTypeCode}
                onChange={(e) => setIncomeTypeCode(e.target.value as WhtIncomeTypeCode)}
                className={inputClass(false)}
                data-testid="select-income-type"
              >
                <option value="">เลือกประเภทเงินได้</option>
                {(Object.keys(INCOME_TYPE_LABELS) as WhtIncomeTypeCode[]).map((code) => (
                  <option key={code} value={code}>
                    {INCOME_TYPE_LABELS[code]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="รายละเอียดเพิ่มเติม (ถ้ามี)">
              <input
                placeholder="เช่น ค่าบริการ, ค่าขนส่ง"
                value={incomeTypeLabel}
                onChange={(e) => setIncomeTypeLabel(e.target.value)}
                className={inputClass(false)}
                data-testid="input-income-type-label"
              />
            </Field>

            <Field label="ลักษณะการหักภาษี">
              <select
                value={deductionType}
                onChange={(e) => setDeductionType(e.target.value as WhtDeductionType)}
                className={inputClass(false)}
                data-testid="select-deduction-type"
              >
                {(Object.keys(DEDUCTION_TYPE_LABELS) as WhtDeductionType[]).map((dt) => (
                  <option key={dt} value={dt}>
                    {DEDUCTION_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
            </Field>

            {deductionType === 'other' && (
              <Field label="ระบุลักษณะการหักภาษี">
                <input
                  value={deductionTypeNote}
                  onChange={(e) => setDeductionTypeNote(e.target.value)}
                  className={inputClass(false)}
                  data-testid="input-deduction-type-note"
                />
              </Field>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="วันที่ออกใบ" required>
                <input
                  type="date"
                  value={issuedDate}
                  onChange={(e) => setIssuedDate(e.target.value)}
                  className={inputClass(false)}
                  data-testid="input-issued-date"
                />
              </Field>
              <Field label="ผู้ลงนาม">
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className={inputClass(false)}
                  data-testid="input-signer-name"
                />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg"
          >
            ยกเลิก
          </button>
          {vendorContacts.length > 0 && !vendorNameMismatch && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="confirm-issue-wht-cert"
            >
              {submitting ? 'กำลังออกใบ...' : mode === 'reissue' ? 'ยืนยันออกใบใหม่' : 'ยืนยันออกใบ'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function inputClass(hasError: boolean): string {
  const base =
    'h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm text-gray-800 placeholder:text-gray-400 transition-colors duration-[250ms] focus:outline-none';
  if (hasError) {
    return `${base} border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgba(239,68,68,0.14)]`;
  }
  return `${base} border-border focus-ring-primary`;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-text">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}
