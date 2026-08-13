'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Mail, Receipt, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { emailWhtCertificate, fetchWhtCertificates, voidWhtCertificate, WHT_CERTIFICATES_SWR_KEY } from '@/lib/whtCertificateApi';
import { fetchInvoices, INVOICES_SWR_KEY } from '@/lib/invoiceApi';
import { CONTACTS_SWR_KEY, fetchContacts } from '@/lib/contactApi';
import { buildWhtCertificatePdf, whtCertificateFilename } from '@/lib/whtCertificatePdf';
import { downloadBlob } from '@/lib/reportExport';
import { buddhistYearOptions, thaiMonthName } from '@/lib/thaiDate';
import IssueWhtCertificateModal, { type WhtCertificateFormPrefill } from '@/components/IssueWhtCertificateModal';
import type { WhtCertificate, WhtFormType } from '@/types/whtCertificate';
import type { PendingTaxInvoice } from '@/types/invoice';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** ต่างจาก formatDate ตรงที่รับ timestamptz เต็ม (มีเวลา/timezone ติดมาด้วย เช่น email_sent_at) ไม่ใช่แค่
 * วันที่ล้วน (YYYY-MM-DD) — ใช้ Date object แปลงเป็นเวลาท้องถิ่นของเบราว์เซอร์ผู้ใช้ตรงๆ */
function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

const FORM_TYPE_LABELS: Record<WhtCertificate['form_type'], string> = {
  '53': '53 (นิติบุคคล)',
  '03': '03 (บุคคลธรรมดา)',
};

const STATUS_LABELS: Record<WhtCertificate['status'], string> = {
  issued: 'ออกแล้ว',
  voided: 'ยกเลิกแล้ว',
};

const STATUS_BADGE_CLASS: Record<WhtCertificate['status'], string> = {
  issued: 'bg-green-100 text-green-700',
  voided: 'bg-gray-200 text-gray-600',
};

/**
 * หน้า "ประวัติใบหัก ณ ที่จ่าย" (เพิ่มเข้ามา 2026-08-11 — ส่วนสุดท้ายของฟีเจอร์นี้) แสดงรายการใบที่เคยออกไป
 * ทั้งหมดของบริษัทที่เลือกอยู่ พร้อมปุ่มดาวน์โหลด PDF ซ้ำได้ทุกใบ (ใช้ตอนไฟล์เดิมหาย/ต้องส่งให้ผู้ถูกหักอีกครั้ง)
 *
 * ปุ่ม "แก้ไข"/"ลบ" (เพิ่มเข้ามาภายหลัง 2026-08-11 ตามที่ผู้ใช้ขอ) ทั้งคู่ใช้กลไกเดียวกันคือ "ยกเลิก" ใบเดิม
 * ผ่าน voidWhtCertificate() (soft delete — เปลี่ยนสถานะเป็น 'voided' เก็บประวัติไว้ ไม่ลบแถวจริง ตามที่ผู้ใช้
 * ยืนยัน ไม่ใช้ hard delete เพราะเอกสารทางการต้องมีเลขที่ต่อเนื่องตรวจสอบย้อนหลังได้) ต่างกันแค่ "แก้ไข" จะ
 * เปิด IssueWhtCertificateModal ต่อทันที (mode="reissue" พรีฟิลข้อมูลเดิม) ให้ออกใบใหม่แทน ส่วน "ลบ" จบแค่
 * ยกเลิกเฉยๆ ไม่เปิดฟอร์มต่อ — ดู supabase/migration_016_void_wht_certificate.sql สำหรับเหตุผลเต็มว่าทำไม
 * ไม่ให้แก้ไขข้อมูลในใบเดิมตรงๆ
 *
 * ดึง invoices ของบริษัทมาด้วย (SWR key เดียวกับ ExpenseRecordContent ใน app/dashboard/page.tsx จึงใช้
 * cache ร่วมกันได้) กรองเอาเฉพาะรายการที่ wht_certificate_id ตรงกับใบที่กดดาวน์โหลด เพื่อสร้าง PDF ใหม่ได้
 * เหมือนตอนออกใบครั้งแรกทุกประการ (ดู lib/whtCertificatePdf.ts buildWhtCertificatePdf ต้องการทั้ง cert และ
 * invoices ต้นทางเพื่อแสดงวันที่จ่ายจริง/หน้าแนบรายละเอียดถ้ารวมหลายรายการ) — รายการเดียวกันนี้ใช้ตอน
 * "แก้ไข" ด้วย (capture ไว้ก่อนยกเลิก เพื่อพรีฟิลรายการเดิมเข้า modal ออกใบใหม่)
 *
 * ปุ่ม "ส่งอีเมล" (เพิ่มเข้ามา 2026-08-11 ตามที่ผู้ใช้ขอ) หาอีเมลผู้รับจาก contacts (สมุดรายชื่อ) โดยจับคู่
 * cert.business_partner_id — ปิดปุ่มไว้ถ้าผู้ขายรายนั้นยังไม่มีอีเมลบันทึกไว้ ไม่ auto-generate/เดาอีเมลเอง
 * เด็ดขาด เรียก lib/whtCertificateApi.ts emailWhtCertificate() ซึ่งสร้าง PDF ฝั่ง browser (โค้ดเดียวกับปุ่ม
 * ดาวน์โหลด) แล้วส่งไปให้ app/api/wht-certificate/send/route.ts ส่ง SMTP จริงอีกที (route จะหาอีเมลผู้รับจาก
 * ฐานข้อมูลเองอีกรอบ ไม่เชื่อค่าที่ client ส่งมาตรงๆ) ต้องตั้งค่า GMAIL_USER/GMAIL_APP_PASSWORD ใน .env.local
 * ก่อนถึงจะใช้งานได้จริง (ไม่งั้น route จะตอบกลับ error 'not_configured' — ข้อความอธิบายอยู่ใน
 * lib/whtCertificateApi.ts SEND_ERROR_MESSAGES)
 *
 * ตัวกรองประเภท/เดือน/ปี (เพิ่มเข้ามา 2026-08-12 ตามคำขอผู้ใช้) — ต้องเลือกให้ครบทั้ง 3 ช่องก่อนตารางถึงจะ
 * แสดงเลย (filtersComplete) กรองด้วย period_month/period_year (เดือน/ปีที่ใช้รันเลขที่ใบตอนออก ไม่ใช่
 * issued_date) เพื่อให้ตรงกับรอบที่ต้องใช้ยื่นแบบ ภ.ง.ด.3/53 จริงๆ
 */
export default function WhtCertificateHistoryPage() {
  const { session } = useAuth();
  const { selectedCompanyId, selectedCompany } = useCompany();

  const {
    data: certificates = [],
    error: certErrorObj,
    isLoading: certLoading,
    mutate: mutateCertificates,
  } = useSWR<WhtCertificate[]>(
    session && selectedCompanyId ? [WHT_CERTIFICATES_SWR_KEY, selectedCompanyId] : null,
    () => fetchWhtCertificates(selectedCompanyId!)
  );
  const certError = certErrorObj instanceof Error ? certErrorObj.message : certErrorObj ? 'โหลดรายการไม่สำเร็จ' : null;

  // SWR key เดียวกับ ExpenseRecordContent ทุกประการ (ดู app/dashboard/page.tsx) — ใช้ cache ร่วมกันได้ถ้า
  // ผู้ใช้เคยเปิดหน้า "บันทึกการจ่ายเงิน" มาก่อนแล้วในเซสชันเดียวกัน ไม่ต้องยิง request ซ้ำ
  const { data: invoices = [], mutate: mutateInvoices } = useSWR<PendingTaxInvoice[]>(
    session && selectedCompanyId ? [INVOICES_SWR_KEY, selectedCompanyId] : null,
    () => fetchInvoices(selectedCompanyId!)
  );

  // ต้องใช้ตอนเปิด IssueWhtCertificateModal สำหรับ "แก้ไข" (จับคู่ผู้ขายกับสมุดรายชื่อเหมือนตอนออกใบครั้งแรก)
  const { data: contacts = [] } = useSWR(
    session && selectedCompanyId ? [CONTACTS_SWR_KEY, selectedCompanyId] : null,
    () => fetchContacts(selectedCompanyId!)
  );

  const [search, setSearch] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // ตัวกรองประเภท/เดือน/ปี (เพิ่มเข้ามาตามคำขอผู้ใช้ 2026-08-12) — ต้องเลือกให้ครบทั้ง 3 ก่อนถึงจะแสดงตาราง
  // เลย (ไม่ default ค่าใดๆ ไว้ล่วงหน้า ต่างจากหน้า "รายงานภาษีซื้อ" ที่ filter แบบ optional/default เป็น
  // เดือน/ปีปัจจุบัน — ที่นี่ผู้ใช้ระบุชัดว่า "ต้องเลือกก่อน") กรองด้วย form_type + period_month/period_year
  // (คือเดือน/ปีที่ใช้ "รันเลขที่ใบ" ตรงกับที่ผู้ใช้เลือกตอนออกใบ ไม่ใช่ issued_date เพราะสองค่านี้อาจต่างเดือน
  // กันได้ถ้าออกใบย้อนหลัง — ดู lib/whtCertificateLogic.ts/supabase/migration_015_wht_certificates.sql)
  const [formTypeFilter, setFormTypeFilter] = useState<WhtFormType | ''>('');
  const [monthFilter, setMonthFilter] = useState<number | ''>('');
  const [yearFilter, setYearFilter] = useState<number | ''>('');
  const filtersComplete = formTypeFilter !== '' && monthFilter !== '' && yearFilter !== '';

  // ปุ่ม "ส่งอีเมล" (เพิ่มเข้ามา 2026-08-11 ตามที่ผู้ใช้ขอ "มีอีเมลของผู้รับแล้ว อยากให้มีปุ่มส่งเมลไปเลย") —
  // sendSuccess เก็บแยกจาก sendError เพื่อโชว์ข้อความ "ส่งแล้ว" สั้นๆ ต่อแถวโดยไม่ต้องรีเฟรชทั้งตาราง
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<{ certId: string; email: string } | null>(null);

  // dialog ยืนยัน "แก้ไข"/"ลบ" ใช้ UI ร่วมกัน (ทั้งคู่เรียก voidWhtCertificate เหมือนกัน ต่างกันแค่ action
  // ต่อเนื่องหลังยกเลิกสำเร็จ — ดูคอมเมนต์หัวไฟล์)
  const [actionTarget, setActionTarget] = useState<{ cert: WhtCertificate; kind: 'edit' | 'delete' } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // เปิดหลังยกเลิกสำเร็จตอนกด "แก้ไข" — เก็บทั้งใบเดิม (สำหรับพรีฟิลฟอร์ม/แสดงเลขที่เดิม) และรายการจ่ายเงิน
  // ที่เคยผูกไว้ (capture ก่อนยกเลิก เพราะหลังยกเลิก invoices cache จะอัปเดตเป็น wht_certificate_id = null)
  const [reissue, setReissue] = useState<{ cert: WhtCertificate; certInvoices: PendingTaxInvoice[] } | null>(null);

  const periodFilteredCertificates = useMemo(() => {
    if (!filtersComplete) return [];
    return certificates.filter(
      (c) => c.form_type === formTypeFilter && c.period_month === monthFilter && c.period_year === yearFilter
    );
  }, [certificates, filtersComplete, formTypeFilter, monthFilter, yearFilter]);

  const visibleCertificates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return periodFilteredCertificates;
    return periodFilteredCertificates.filter(
      (c) => c.cert_number.toLowerCase().includes(q) || c.payee_name.toLowerCase().includes(q)
    );
  }, [periodFilteredCertificates, search]);

  async function handleDownload(cert: WhtCertificate) {
    setDownloadingId(cert.id);
    setDownloadError(null);
    try {
      const certInvoices = invoices.filter((inv) => inv.wht_certificate_id === cert.id);
      const blob = buildWhtCertificatePdf(cert, certInvoices);
      downloadBlob(blob, whtCertificateFilename(cert));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'สร้างไฟล์ PDF ไม่สำเร็จ');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleSendEmail(cert: WhtCertificate) {
    const recipientEmail = contacts.find((c) => c.id === cert.business_partner_id)?.email?.trim();
    const accessToken = session?.access_token;
    if (!recipientEmail || !accessToken) return; // ปุ่มควรถูกซ่อน/ปิดไว้ก่อนแล้วถ้าเข้าเงื่อนไขนี้ — กันไว้เฉยๆ
    setSendingId(cert.id);
    setSendError(null);
    setSendSuccess(null);
    try {
      const certInvoices = invoices.filter((inv) => inv.wht_certificate_id === cert.id);
      const result = await emailWhtCertificate(cert, certInvoices, accessToken);
      setSendSuccess({ certId: cert.id, email: result.sentTo });
      await mutateCertificates(); // ดึงข้อมูล email_sent_at/email_sent_to ที่เพิ่งบันทึกมาแสดงในตาราง
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSendingId(null);
    }
  }

  async function handleConfirmAction() {
    if (!actionTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const { cert, kind } = actionTarget;
      // capture รายการที่ผูกกับใบนี้ไว้ก่อนยกเลิก — ใช้พรีฟิลตอน "แก้ไข" เท่านั้น (หลังยกเลิกแล้ว
      // wht_certificate_id ของรายการเหล่านี้จะกลายเป็น null ทันที)
      const certInvoices = invoices.filter((inv) => inv.wht_certificate_id === cert.id);
      const reason = kind === 'delete' ? 'ลบโดยผู้ใช้' : 'แก้ไขข้อมูล (ออกใบใหม่แทน)';
      await voidWhtCertificate(cert.id, reason);
      setActionTarget(null);
      await Promise.all([mutateCertificates(), mutateInvoices()]);
      if (kind === 'edit') {
        setReissue({ cert, certInvoices });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReissued(newCert: WhtCertificate) {
    const certInvoices = reissue?.certInvoices ?? [];
    setReissue(null);
    await Promise.all([mutateCertificates(), mutateInvoices()]);
    try {
      const blob = buildWhtCertificatePdf(newCert, certInvoices);
      downloadBlob(blob, whtCertificateFilename(newCert));
    } catch {
      // สร้าง/ดาวน์โหลด PDF ไม่สำเร็จ — ไม่บล็อก flow หลัก (ใบใหม่ถูกบันทึกแล้วจริง) ดาวน์โหลดซ้ำได้จากตาราง
    }
  }

  const reissuePrefill: WhtCertificateFormPrefill | undefined = reissue
    ? {
        incomeTypeCode: reissue.cert.income_type_code,
        incomeTypeLabel: reissue.cert.income_type_label ?? '',
        deductionType: reissue.cert.deduction_type,
        deductionTypeNote: reissue.cert.deduction_type_note ?? '',
        signerName: reissue.cert.signer_name ?? '',
        issuedDate: reissue.cert.issued_date,
      }
    : undefined;

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
            <Receipt className="h-5 w-5 text-primary" strokeWidth={2} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text">ประวัติใบหัก ณ ที่จ่าย</h1>
            <p className="mt-1 text-sm text-text-sub">เลือกประเภท เดือน และปีที่ต้องการดู — ดาวน์โหลด PDF ซ้ำได้ทุกใบ</p>
          </div>
        </div>

        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-sub" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขที่ใบ / ชื่อผู้ถูกหัก"
            className="focus-ring-primary h-11 w-64 rounded-xl border border-border bg-white/5 pr-4 pl-10 text-sm text-text placeholder:text-text-sub"
            data-testid="wht-history-search"
          />
        </div>
      </div>

      {/* ตัวกรองประเภท/เดือน/ปี (2026-08-12) — ต้องเลือกให้ครบทั้ง 3 ช่องก่อนตารางถึงจะแสดง (ดู filtersComplete
          ด้านบน) วางเรียงตามลำดับที่ผู้ใช้ระบุ: ประเภทก่อน แล้วค่อยเดือน/ปี */}
      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="wht-history-filters">
        <select
          value={formTypeFilter}
          onChange={(e) => setFormTypeFilter(e.target.value as WhtFormType | '')}
          className="focus-ring-primary rounded-[10px] border border-border bg-white/8 px-3.5 py-2.5 text-sm text-text"
          data-testid="wht-history-form-type-filter"
        >
          <option value="">-- เลือกประเภท --</option>
          <option value="53">ภ.ง.ด.53 (นิติบุคคล)</option>
          <option value="03">ภ.ง.ด.3 (บุคคลธรรมดา)</option>
        </select>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value ? Number(e.target.value) : '')}
          className="focus-ring-primary rounded-[10px] border border-border bg-white/8 px-3.5 py-2.5 text-sm text-text"
          data-testid="wht-history-month-filter"
        >
          <option value="">-- เลือกเดือน --</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {thaiMonthName(m)}
            </option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : '')}
          className="focus-ring-primary rounded-[10px] border border-border bg-white/8 px-3.5 py-2.5 text-sm text-text"
          data-testid="wht-history-year-filter"
        >
          <option value="">-- เลือกปี --</option>
          {buddhistYearOptions().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {downloadError && (
        <p role="alert" className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {downloadError}
        </p>
      )}

      {sendError && (
        <p role="alert" className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {sendError}
        </p>
      )}

      {certError && (
        <p role="alert" className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {certError}
        </p>
      )}

      {!filtersComplete ? (
        <div
          className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
          data-testid="wht-history-filters-incomplete"
        >
          กรุณาเลือกประเภท เดือน และปีให้ครบ เพื่อแสดงรายการใบหัก ณ ที่จ่าย
        </div>
      ) : certLoading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : visibleCertificates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub">
          {periodFilteredCertificates.length === 0 ? 'ไม่พบใบหัก ณ ที่จ่ายในช่วงที่เลือก' : 'ไม่พบรายการที่ค้นหา'}
        </div>
      ) : (
        <div className="card-surface overflow-x-auto rounded-2xl">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เลขที่ใบ</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ผู้ถูกหักภาษี</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ประเภท</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">วันที่ออก</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดรวม</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">หัก ณ ที่จ่าย</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะ</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะอีเมล</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleCertificates.map((cert, index) => {
                const recipientEmail = contacts.find((c) => c.id === cert.business_partner_id)?.email?.trim() || null;
                const justSent = sendSuccess?.certId === cert.id;
                return (
                  <tr
                    key={cert.id}
                    data-testid={`wht-cert-row-${cert.id}`}
                    className={`transition-colors duration-150 hover:bg-table-row-hover ${index % 2 === 1 ? 'bg-table-row-zebra' : ''}`}
                  >
                    <td className="font-numeric whitespace-nowrap px-[18px] py-[18px] font-medium text-text">{cert.cert_number}</td>
                    <td className="px-[18px] py-[18px] text-text-sub">{cert.payee_name}</td>
                    <td className="px-[18px] py-[18px] text-text-sub">{FORM_TYPE_LABELS[cert.form_type]}</td>
                    <td className="px-[18px] py-[18px] text-text-sub">{formatDate(cert.issued_date)}</td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">{THB.format(cert.total_amount)}</td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text">{THB.format(cert.total_wht_amount)}</td>
                    <td className="px-[18px] py-[18px]">
                      <span className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${STATUS_BADGE_CLASS[cert.status]}`}>
                        {STATUS_LABELS[cert.status]}
                      </span>
                    </td>
                    <td className="px-[18px] py-[18px] text-text-sub">
                      {cert.email_sent_at ? (
                        <span title={cert.email_sent_to ?? undefined}>ส่งแล้ว {formatDateTime(cert.email_sent_at)}</span>
                      ) : (
                        <span className="text-text-sub/60">ยังไม่ได้ส่ง</span>
                      )}
                    </td>
                    <td className="px-[18px] py-[18px] text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={downloadingId === cert.id}
                          onClick={() => handleDownload(cert)}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                          data-testid={`wht-cert-download-${cert.id}`}
                        >
                          {downloadingId === cert.id ? 'กำลังสร้าง...' : 'ดาวน์โหลด PDF'}
                        </button>
                        {cert.status === 'issued' && (
                          <>
                            <button
                              type="button"
                              disabled={!recipientEmail || sendingId === cert.id}
                              title={recipientEmail ? undefined : 'ผู้ขายรายนี้ยังไม่มีอีเมลในสมุดรายชื่อ'}
                              onClick={() => handleSendEmail(cert)}
                              className="btn-press flex items-center gap-1 rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                              data-testid={`wht-cert-send-email-${cert.id}`}
                            >
                              <Mail size={12} aria-hidden="true" />
                              {sendingId === cert.id ? 'กำลังส่ง...' : justSent ? 'ส่งแล้ว ✓' : 'ส่งอีเมล'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionTarget({ cert, kind: 'edit' })}
                              className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                              data-testid={`wht-cert-edit-${cert.id}`}
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => setActionTarget({ cert, kind: 'delete' })}
                              className="btn-press rounded-[10px] border border-danger/30 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                              data-testid={`wht-cert-delete-${cert.id}`}
                            >
                              ลบ
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* dialog ยืนยัน "แก้ไข"/"ลบ" ใช้ร่วมกัน (ทั้งคู่เรียก voidWhtCertificate เหมือนกัน) — การ์ด/โมดัลทั้งระบบ
          เป็นกระจกเข้มเสมอ (card-surface ชนะ bg-white เสมอตาม CSS Cascade Layers — ดูคอมเมนต์เต็มใน
          app/globals.css) จึงใช้สีอ่อน text-text/text-text-sub ให้อ่านออกบนพื้นเข้ม (2026-08-12) */}
      {actionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => (actionBusy ? null : setActionTarget(null))}
          role="dialog"
          aria-modal="true"
          aria-label={actionTarget.kind === 'edit' ? 'ยืนยันแก้ไขใบหัก ณ ที่จ่าย' : 'ยืนยันลบใบหัก ณ ที่จ่าย'}
          data-testid="wht-cert-action-confirm-dialog"
        >
          <div className="card-surface card-surface-modal w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text">
              {actionTarget.kind === 'edit' ? 'ยืนยันแก้ไขใบหัก ณ ที่จ่าย' : 'ยืนยันลบใบหัก ณ ที่จ่าย'}
            </h3>
            <p className="mt-2 text-sm text-text-sub">
              {actionTarget.kind === 'edit'
                ? `ใบเลขที่ ${actionTarget.cert.cert_number} จะถูกยกเลิก แล้วเปิดฟอร์มออกใบใหม่แทน (ได้เลขที่ใหม่ต่อเนื่อง) ต้องการดำเนินการต่อหรือไม่?`
                : `ใบเลขที่ ${actionTarget.cert.cert_number} จะถูกยกเลิก (เก็บประวัติไว้ ไม่ลบถาวร) รายการจ่ายเงินที่ผูกไว้จะกลับมาเลือกออกใบใหม่ได้อีกครั้ง ต้องการดำเนินการต่อหรือไม่?`}
            </p>
            {actionError && (
              <p role="alert" className="mt-3 rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                {actionError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setActionTarget(null)}
                className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg disabled:opacity-60"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleConfirmAction}
                className="btn-press rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90 disabled:opacity-60"
                data-testid="confirm-wht-cert-action"
              >
                {actionBusy ? 'กำลังดำเนินการ...' : actionTarget.kind === 'edit' ? 'ยกเลิกใบเดิม' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reissue && selectedCompany && (
        <IssueWhtCertificateModal
          invoices={reissue.certInvoices}
          contacts={contacts}
          company={selectedCompany}
          companyId={selectedCompanyId!}
          createdByEmail={session?.user?.email ?? null}
          onClose={() => setReissue(null)}
          onIssued={handleReissued}
          mode="reissue"
          voidedCertNumber={reissue.cert.cert_number}
          prefill={reissuePrefill}
        />
      )}
    </main>
  );
}
