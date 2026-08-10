'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { UserCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { approveMember, listPendingUsers, type PendingUser } from '@/lib/adminApi';

const PENDING_USERS_SWR_KEY = 'pending-users';

/**
 * หน้า "อนุมัติสมาชิกใหม่" (เพิ่มเข้ามา 2026-08-10 พร้อมระบบอนุมัติสมาชิก — ดู
 * supabase/migration_010_member_approval.sql) — สมัครสมาชิกเองที่หน้า login ได้ตามเดิม (ฟีเจอร์เดิมที่มีอยู่
 * แล้ว ไม่ได้แตะ) แต่บัญชีใหม่จะยังใช้งานอะไรไม่ได้ (เจอหน้าว่างที่ /select-company) จนกว่าสมาชิกบริษัทที่มีอยู่
 * แล้วคนใดคนหนึ่งจะมาอนุมัติให้เข้าบริษัทนั้นที่หน้านี้ — ไม่มีระดับสิทธิ์ "แอดมิน" แยกต่างหาก (ตามดีไซน์เดิม
 * ของทั้งระบบที่สมาชิกทุกคนในบริษัทเดียวกันมีสิทธิ์เท่ากัน) ใครก็ตามที่เป็นสมาชิกบริษัทอยู่แล้วอย่างน้อย 1
 * บริษัท เข้าหน้านี้และอนุมัติคนใหม่เข้าบริษัทของตัวเองได้เหมือนกันหมด — ฝั่งฐานข้อมูล (approve_member RPC)
 * เป็นผู้บังคับสิทธิ์จริงอีกชั้นอยู่แล้วว่าอนุมัติเข้าได้เฉพาะบริษัทที่ตัวเองเป็นสมาชิกเท่านั้น ฝั่งนี้แค่จำกัด
 * ตัวเลือกใน dropdown ให้เหลือเฉพาะบริษัทของผู้ใช้ปัจจุบันเพื่อ UX ที่ชัดเจน ไม่ใช่กลไกความปลอดภัยหลัก
 */
export default function ManageMembersPage() {
  const { session } = useAuth();
  const { companies } = useCompany();
  const {
    data: pendingUsers = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<PendingUser[]>(session ? PENDING_USERS_SWR_KEY : null, listPendingUsers);
  const loadError =
    loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดรายชื่อไม่สำเร็จ' : null;

  // เลือกบริษัทปลายทางแยกต่อแถว (key เป็น userId) — ค่าเริ่มต้นเป็นบริษัทแรกของผู้ใช้ปัจจุบันเสมอ (กรณีทั่วไป
  // ที่มีบริษัทเดียว ไม่ต้องเลือกเองด้วยซ้ำ)
  const [selectedCompanyByUser, setSelectedCompanyByUser] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  function companyForUser(userId: string): string {
    return selectedCompanyByUser[userId] ?? companies[0]?.id ?? '';
  }

  async function handleApprove(userId: string) {
    const companyId = companyForUser(userId);
    if (!companyId) return;
    setApprovingId(userId);
    setApproveError(null);
    try {
      await approveMember(userId, companyId);
      await mutate();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'อนุมัติไม่สำเร็จ');
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
          <UserCheck className="h-5 w-5 text-primary" strokeWidth={2} aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">อนุมัติสมาชิกใหม่</h1>
          <p className="mt-1 text-sm text-text-sub">
            รายชื่อคนที่สมัครสมาชิกแล้วแต่ยังไม่ได้รับสิทธิ์เข้าใช้งานบริษัทไหนเลย เลือกบริษัทแล้วกดอนุมัติเพื่อให้เข้าใช้งานได้
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-text-sub" data-testid="manage-members-loading">
          กำลังโหลด...
        </div>
      )}

      {!loading && loadError && (
        <p role="alert" data-testid="manage-members-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError}
        </p>
      )}

      {!loading && !loadError && pendingUsers.length === 0 && (
        <div
          className="rounded-xl border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-text-sub"
          data-testid="manage-members-empty"
        >
          ไม่มีคำขอสมัครที่รอดำเนินการตอนนี้
        </div>
      )}

      {!loading && !loadError && pendingUsers.length > 0 && (
        <div className="space-y-3" data-testid="manage-members-list">
          {approveError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {approveError}
            </p>
          )}
          {pendingUsers.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`manage-members-row-${user.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{user.email}</p>
                <p className="text-xs text-text-sub">
                  สมัครเมื่อ{' '}
                  {new Date(user.createdAt).toLocaleDateString('th-TH', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={companyForUser(user.id)}
                  onChange={(e) => setSelectedCompanyByUser((prev) => ({ ...prev, [user.id]: e.target.value }))}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-text focus:border-primary focus:outline-none"
                  data-testid={`manage-members-company-select-${user.id}`}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleApprove(user.id)}
                  disabled={approvingId === user.id || !companyForUser(user.id)}
                  className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`manage-members-approve-${user.id}`}
                >
                  {approvingId === user.id ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
