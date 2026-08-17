'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Building2, Download, LogOut, Receipt } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  downloadExternalWhtCertificatePdf,
  ensureExternalViewerRegistered,
  fetchMyGrantedCompanies,
  type ExternalCompanySummary,
} from '@/lib/externalWhtViewerApi';
import { fetchWhtCertificates } from '@/lib/whtCertificateApi';
import { buddhistYearOptions, thaiMonthName } from '@/lib/thaiDate';
import type { WhtCertificate, WhtFormType } from '@/types/whtCertificate';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GRANTED_COMPANIES_SWR_KEY = 'external-granted-companies';

/**
 * หน้า dashboard ของพอร์ทัลผู้ใช้ภายนอก (เพิ่มเข้ามา 2026-08-15 — ดู
 * supabase/migration_018_external_wht_viewers.sql, lib/externalWhtViewerApi.ts) แยกจาก /dashboard ภายในโดย
 * สิ้นเชิง ไม่ใช้ Sidebar/Header/ProtectedRoute เดิม (สิ่งเหล่านั้นผูกกับแนวคิด "สมาชิกบริษัท" ที่ไม่ตรงกับ
 * ผู้ใช้ภายนอกเลย) — มีระบบป้องกันเส้นทาง (route guard) ของตัวเองในหน้านี้โดยตรง (redirect ไป /external/login
 * ถ้ายังไม่ได้ login แทนที่จะไป /login เหมือน ProtectedRoute เดิม)
 *
 * แสดงผลต่างกัน 2 สถานะตามจำนวนบริษัทที่ได้รับสิทธิ์ (fetchMyGrantedCompanies): 0 บริษัท = ยังไม่ได้รับอนุมัติ
 * จาก Ben เลย แสดงข้อความ "รออนุมัติ" เฉยๆ / อย่างน้อย 1 บริษัท = แสดง dashboard จริง (แท็บเลือกบริษัท + ตาราง
 * ใบหัก ณ ที่จ่ายของบริษัทที่เลือก) — ตั้งใจไม่แยกเป็นคนละ route (เช่น /external/pending) เพื่อไม่ต้องมี
 * ตรรกะ redirect ซ้อนเพิ่มอีกชั้น หน้าเดียวสลับเนื้อหาเองตามสถานะพอ
 */
export default function ExternalDashboardPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/external/login');
    }
  }, [loading, session, router]);

  // เผื่อกรณี ensureExternalViewerRegistered() ที่หน้า /external/login เรียกไปแล้วล้มเหลว (เช่นเน็ตหลุด) —
  // เรียกซ้ำอีกทีตอนโหลดหน้านี้ได้อย่างปลอดภัยเสมอ (idempotent) ห่อด้วย Promise.resolve().then() ตามกฎ
  // react-hooks/set-state-in-effect เดียวกับที่ยึดถือทั้งโปรเจกต์ (ไม่ setState ตรงๆ ใน effect body)
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    Promise.resolve()
      .then(() => ensureExternalViewerRegistered())
      .catch((err) => {
        if (!mounted) return;
        console.error('ensureExternalViewerRegistered (dashboard retry) failed', err);
      });
    return () => {
      mounted = false;
    };
  }, [session]);

  const {
    data: companies = [],
    error: companiesErrorObj,
    isLoading: companiesLoading,
  } = useSWR<ExternalCompanySummary[]>(session ? GRANTED_COMPANIES_SWR_KEY : null, fetchMyGrantedCompanies);
  const companiesError =
    companiesErrorObj instanceof Error ? companiesErrorObj.message : companiesErrorObj ? 'โหลดรายชื่อบริษัทไม่สำเร็จ' : null;

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0] ?? null;

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/external/login');
  }

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page-bg">
        <p className="text-text-sub">กำลังโหลด...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page-bg">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light">
              <Receipt className="h-4.5 w-4.5 text-primary" strokeWidth={2} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">ใบหัก ณ ที่จ่าย</p>
              <p className="text-xs text-gray-400">สำหรับบุคคลภายนอก</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {session.user?.email && (
              <span className="hidden text-sm text-gray-500 sm:inline">{session.user.email}</span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">
        {companiesLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-text-sub">กำลังโหลด...</div>
        )}

        {!companiesLoading && companiesError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {companiesError}
          </p>
        )}

        {!companiesLoading && !companiesError && companies.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-light">
              <Building2 className="h-6 w-6 text-primary" strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="text-base font-semibold text-gray-800">รอผู้ดูแลระบบอนุมัติสิทธิ์</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              บัญชีของคุณสมัครสมาชิกสำเร็จแล้ว แต่ยังไม่ได้รับสิทธิ์เข้าดูใบหัก ณ ที่จ่ายของบริษัทไหนเลย
              กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เข้าใช้งาน
            </p>
          </div>
        )}

        {!companiesLoading && !companiesError && companies.length > 0 && selectedCompany && (
          <>
            {companies.length > 1 && (
              <div className="mb-6 flex flex-wrap gap-2" data-testid="external-company-tabs">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCompanyId(c.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      selectedCompany.id === c.id ? 'bg-primary text-white shadow-sm' : 'bg-white text-gray-600 border border-border hover:text-primary'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <CompanyCertificateList company={selectedCompany} />
          </>
        )}
      </main>
    </div>
  );
}

/** ตัวกรองประเภท/เดือน/ปี (เพิ่มเข้ามา 2026-08-15 ตามคำขอผู้ใช้ — "อยากให้มีปุ่มเลือกเดือนและปี และต้อง
 * เลือกว่าเป็น ภ.ง.ด.3 หรือ 53 ก่อนแสดงผล") ยึด pattern เดียวกับตัวกรองในหน้า "ประวัติใบหัก ณ ที่จ่าย" ฝั่ง
 * ภายใน (WhtCertificateHistoryPage.tsx) ทุกประการ — ต้องเลือกให้ครบทั้ง 3 ช่องก่อนตารางถึงจะแสดง
 * (filtersComplete) กรองด้วย form_type + period_month/period_year (เดือน/ปีที่ใช้รันเลขที่ใบตอนออก ตรงกับรอบ
 * ที่ต้องยื่นแบบจริง ไม่ใช่ issued_date) ไม่ persist ค่าไว้ข้ามการสลับบริษัท/รีเฟรชเหมือนฝั่งภายใน (ไม่ได้ร้อง
 * ขอมา และผู้ใช้ภายนอกมักจะดูแค่ช่วงเดียวแล้วออกจากระบบเลย ไม่ได้สลับไปมาบ่อยเหมือนพนักงานบัญชี)
 */
function CompanyCertificateList({ company }: { company: ExternalCompanySummary }) {
  const {
    data: certificates = [],
    error: certErrorObj,
    isLoading: certLoading,
  } = useSWR<WhtCertificate[]>(['external-wht-certs', company.id], () => fetchWhtCertificates(company.id));
  const certError = certErrorObj instanceof Error ? certErrorObj.message : certErrorObj ? 'โหลดรายการไม่สำเร็จ' : null;

  const [formTypeFilter, setFormTypeFilter] = useState<WhtFormType | ''>('');
  const [monthFilter, setMonthFilter] = useState<number | ''>('');
  const [yearFilter, setYearFilter] = useState<number | ''>('');
  const filtersComplete = formTypeFilter !== '' && monthFilter !== '' && yearFilter !== '';

  // ผู้ใช้ภายนอกเห็นเฉพาะใบที่ยังไม่ถูกยกเลิก (status 'issued') — ใบที่ยกเลิกไปแล้วไม่มีความหมายอะไรสำหรับ
  // ผู้ถูกหักภาษีอีกต่อไป (เหมือน WhtCertificateHistoryPage.tsx ฝั่งภายในที่ก็ซ่อนใบที่ยกเลิกจากตารางเช่นกัน)
  const activeCertificates = useMemo(() => {
    if (!filtersComplete) return [];
    return certificates.filter(
      (c) => c.status === 'issued' && c.form_type === formTypeFilter && c.period_month === monthFilter && c.period_year === yearFilter
    );
  }, [certificates, filtersComplete, formTypeFilter, monthFilter, yearFilter]);

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-text">{company.name}</h2>

      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="external-wht-filters">
        <select
          value={formTypeFilter}
          onChange={(e) => setFormTypeFilter(e.target.value as WhtFormType | '')}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-gray-800 focus:border-primary focus:outline-none"
          data-testid="external-wht-form-type-filter"
        >
          <option value="">-- เลือกประเภท --</option>
          <option value="53">ภ.ง.ด.53 (นิติบุคคล)</option>
          <option value="03">ภ.ง.ด.3 (บุคคลธรรมดา)</option>
        </select>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value ? Number(e.target.value) : '')}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-gray-800 focus:border-primary focus:outline-none"
          data-testid="external-wht-month-filter"
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
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-gray-800 focus:border-primary focus:outline-none"
          data-testid="external-wht-year-filter"
        >
          <option value="">-- เลือกปี --</option>
          {buddhistYearOptions().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {certLoading && <div className="flex items-center justify-center py-16 text-sm text-text-sub">กำลังโหลด...</div>}

      {!certLoading && certError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {certError}
        </p>
      )}

      {!certLoading && !certError && !filtersComplete && (
        <div
          className="rounded-xl border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-gray-500"
          data-testid="external-wht-filters-incomplete"
        >
          กรุณาเลือกประเภท เดือน และปีให้ครบ เพื่อแสดงรายการใบหัก ณ ที่จ่าย
        </div>
      )}

      {!certLoading && !certError && filtersComplete && activeCertificates.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-gray-500">
          ไม่พบใบหัก ณ ที่จ่ายของบริษัทนี้ในช่วงที่เลือก
        </div>
      )}

      {!certLoading && !certError && filtersComplete && activeCertificates.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50 text-left text-xs font-medium text-gray-500">
                <th className="px-4 py-3">เลขที่</th>
                <th className="px-4 py-3">ผู้ถูกหักภาษี</th>
                <th className="px-4 py-3">วันที่ออก</th>
                <th className="px-4 py-3 text-right">ยอดหัก ณ ที่จ่าย</th>
                <th className="px-4 py-3 text-right">ดาวน์โหลด</th>
              </tr>
            </thead>
            <tbody>
              {activeCertificates.map((cert) => (
                <tr key={cert.id} className="border-b border-border last:border-0" data-testid={`external-cert-row-${cert.id}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{cert.cert_number}</td>
                  <td className="px-4 py-3 text-gray-700">{cert.payee_name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(cert.issued_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{THB.format(cert.total_wht_amount)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => downloadExternalWhtCertificatePdf(cert)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
