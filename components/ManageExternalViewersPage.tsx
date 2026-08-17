'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { UserPlus2, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import {
  grantExternalViewerCompany,
  listApprovedExternalViewers,
  listPendingExternalViewers,
  revokeExternalViewerCompany,
  type ApprovedExternalViewer,
  type PendingExternalViewer,
} from '@/lib/externalWhtViewerApi';
import { isPrimaryAdmin } from '@/lib/adminAccess';

const PENDING_EXTERNAL_SWR_KEY = 'pending-external-viewers';
const APPROVED_EXTERNAL_SWR_KEY = 'approved-external-viewers';

/**
 * หน้า "ผู้ใช้ภายนอก (ใบหัก ณ ที่จ่าย)" (เพิ่มเข้ามา 2026-08-15 พร้อมพอร์ทัลภายนอก — ดู
 * supabase/migration_018_external_wht_viewers.sql, lib/externalWhtViewerApi.ts, app/external/*) — จัดการคนที่
 * สมัครผ่านหน้า /external/login ทั้งหมด แบ่ง 2 ส่วน: "รออนุมัติ" (ยังไม่เคยได้รับสิทธิ์บริษัทไหนเลย — เลือก
 * บริษัทแบบ checkbox หลายบริษัทพร้อมกันได้แล้วกดอนุมัติทีเดียว) และ "อนุมัติแล้ว" (จัดการเพิ่ม/ถอนสิทธิ์
 * รายบริษัทได้ตลอดเวลา ตามที่ผู้ใช้ระบุชัดเจนว่าต้องการ)
 *
 * กันหน้านี้ไว้เฉพาะแอดมิน (Ben) เหมือน ManageMembersPage.tsx ทุกประการ — ชั้นนี้เป็นแค่ UX ที่ดีขึ้น
 * (ไม่โชว์ error message งงๆ ให้คนที่ไม่ควรเห็น) ตัวบังคับสิทธิ์จริงอยู่ที่ RPC ฝั่งฐานข้อมูลเท่านั้น (เช็ค
 * user id ตรงๆ เหมือนกันทุก RPC)
 *
 * รายชื่อ "บริษัทที่เลือกให้สิทธิ์ได้" มาจาก useCompany().companies (บริษัทที่ Ben เป็นสมาชิกอยู่) — สมเหตุสม
 * ผลเพราะ Ben ให้สิทธิ์บริษัทที่ตัวเองดูแลอยู่แล้วเท่านั้น ไม่ใช่บริษัทอื่นที่ไม่เกี่ยวข้องกับตัวเองเลย
 */
export default function ManageExternalViewersPage() {
  const { session } = useAuth();
  const { companies } = useCompany();
  const isAdmin = isPrimaryAdmin(session?.user?.id);

  const {
    data: pendingViewers = [],
    error: pendingErrorObj,
    isLoading: pendingLoading,
    mutate: mutatePending,
  } = useSWR<PendingExternalViewer[]>(session && isAdmin ? PENDING_EXTERNAL_SWR_KEY : null, listPendingExternalViewers);
  const pendingError =
    pendingErrorObj instanceof Error ? pendingErrorObj.message : pendingErrorObj ? 'โหลดรายชื่อไม่สำเร็จ' : null;

  const {
    data: approvedViewers = [],
    error: approvedErrorObj,
    isLoading: approvedLoading,
    mutate: mutateApproved,
  } = useSWR<ApprovedExternalViewer[]>(session && isAdmin ? APPROVED_EXTERNAL_SWR_KEY : null, listApprovedExternalViewers);
  const approvedError =
    approvedErrorObj instanceof Error ? approvedErrorObj.message : approvedErrorObj ? 'โหลดรายชื่อไม่สำเร็จ' : null;

  const [selectedCompaniesByUser, setSelectedCompaniesByUser] = useState<Record<string, Set<string>>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [addCompanyByUser, setAddCompanyByUser] = useState<Record<string, string>>({});
  const [busyGrantKey, setBusyGrantKey] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  function toggleCompanyForUser(userId: string, companyId: string) {
    setSelectedCompaniesByUser((prev) => {
      const next = new Set(prev[userId] ?? []);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return { ...prev, [userId]: next };
    });
  }

  async function handleApprove(userId: string) {
    const selected = selectedCompaniesByUser[userId];
    if (!selected || selected.size === 0) return;
    setApprovingId(userId);
    setApproveError(null);
    try {
      await Promise.all(Array.from(selected).map((companyId) => grantExternalViewerCompany(userId, companyId)));
      setSelectedCompaniesByUser((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      await Promise.all([mutatePending(), mutateApproved()]);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'อนุมัติไม่สำเร็จ');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleAddCompany(userId: string) {
    const companyId = addCompanyByUser[userId];
    if (!companyId) return;
    const key = `add-${userId}`;
    setBusyGrantKey(key);
    setGrantError(null);
    try {
      await grantExternalViewerCompany(userId, companyId);
      setAddCompanyByUser((prev) => ({ ...prev, [userId]: '' }));
      await mutateApproved();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'เพิ่มสิทธิ์ไม่สำเร็จ');
    } finally {
      setBusyGrantKey(null);
    }
  }

  async function handleRevoke(userId: string, companyId: string) {
    const key = `revoke-${userId}-${companyId}`;
    setBusyGrantKey(key);
    setGrantError(null);
    try {
      await revokeExternalViewerCompany(userId, companyId);
      await mutateApproved();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'ถอนสิทธิ์ไม่สำเร็จ');
    } finally {
      setBusyGrantKey(null);
    }
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">
        <div
          className="rounded-xl border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-gray-500"
          data-testid="manage-external-viewers-forbidden"
        >
          หน้านี้สำหรับผู้ดูแลระบบเท่านั้น
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
          <UserPlus2 className="h-5 w-5 text-primary" strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">ผู้ใช้ภายนอก (ใบหัก ณ ที่จ่าย)</h1>
          <p className="mt-1 text-sm text-text-sub">
            จัดการคนที่สมัครผ่านหน้าล็อกอินสำหรับบุคคลภายนอก — เลือกบริษัทที่ให้ดูใบหัก ณ ที่จ่ายได้ เพิ่ม/ถอนสิทธิ์ได้ตลอดเวลา
          </p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-text">รออนุมัติ</h2>

        {pendingLoading && (
          <div className="flex items-center justify-center py-10 text-sm text-text-sub" data-testid="pending-external-loading">
            กำลังโหลด...
          </div>
        )}

        {!pendingLoading && pendingError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {pendingError}
          </p>
        )}

        {!pendingLoading && !pendingError && pendingViewers.length === 0 && (
          <div
            className="rounded-xl border border-dashed border-border bg-white px-6 py-8 text-center text-sm text-gray-500"
            data-testid="pending-external-empty"
          >
            ไม่มีคำขอที่รอดำเนินการตอนนี้
          </div>
        )}

        {!pendingLoading && !pendingError && pendingViewers.length > 0 && (
          <div className="space-y-3">
            {approveError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {approveError}
              </p>
            )}
            {pendingViewers.map((viewer) => {
              const selected = selectedCompaniesByUser[viewer.id] ?? new Set<string>();
              return (
                <div
                  key={viewer.id}
                  className="rounded-xl border border-border bg-white p-4"
                  data-testid={`pending-external-row-${viewer.id}`}
                >
                  <p className="truncate text-sm font-medium text-gray-800">{viewer.email}</p>
                  <p className="text-xs text-gray-500">
                    สมัครเมื่อ{' '}
                    {new Date(viewer.createdAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {companies.map((c) => {
                      const checked = selected.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCompanyForUser(viewer.id, c.id)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            checked ? 'border-primary bg-primary-light text-primary' : 'border-border text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => handleApprove(viewer.id)}
                      disabled={approvingId === viewer.id || selected.size === 0}
                      className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`approve-external-${viewer.id}`}
                    >
                      {approvingId === viewer.id ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text">อนุมัติแล้ว</h2>

        {approvedLoading && (
          <div className="flex items-center justify-center py-10 text-sm text-text-sub" data-testid="approved-external-loading">
            กำลังโหลด...
          </div>
        )}

        {!approvedLoading && approvedError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {approvedError}
          </p>
        )}

        {!approvedLoading && !approvedError && approvedViewers.length === 0 && (
          <div
            className="rounded-xl border border-dashed border-border bg-white px-6 py-8 text-center text-sm text-gray-500"
            data-testid="approved-external-empty"
          >
            ยังไม่มีผู้ใช้ภายนอกที่ได้รับสิทธิ์
          </div>
        )}

        {!approvedLoading && !approvedError && approvedViewers.length > 0 && (
          <div className="space-y-3">
            {grantError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {grantError}
              </p>
            )}
            {approvedViewers.map((viewer) => {
              const grantedIds = new Set(viewer.companies.map((c) => c.id));
              const availableCompanies = companies.filter((c) => !grantedIds.has(c.id));
              return (
                <div
                  key={viewer.id}
                  className="rounded-xl border border-border bg-white p-4"
                  data-testid={`approved-external-row-${viewer.id}`}
                >
                  <p className="truncate text-sm font-medium text-gray-800">{viewer.email}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {viewer.companies.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-light px-3 py-1.5 text-xs font-medium text-primary"
                      >
                        {c.name}
                        <button
                          type="button"
                          onClick={() => handleRevoke(viewer.id, c.id)}
                          disabled={busyGrantKey === `revoke-${viewer.id}-${c.id}`}
                          aria-label={`ถอนสิทธิ์ ${c.name}`}
                          className="text-primary/70 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>

                  {availableCompanies.length > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={addCompanyByUser[viewer.id] ?? ''}
                        onChange={(e) => setAddCompanyByUser((prev) => ({ ...prev, [viewer.id]: e.target.value }))}
                        className="h-9 rounded-lg border border-border bg-white px-3 text-xs text-gray-800 focus:border-primary focus:outline-none"
                      >
                        <option value="">เพิ่มบริษัท...</option>
                        {availableCompanies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleAddCompany(viewer.id)}
                        disabled={!addCompanyByUser[viewer.id] || busyGrantKey === `add-${viewer.id}`}
                        className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        เพิ่ม
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
