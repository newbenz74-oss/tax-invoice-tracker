'use client';

import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { getReportDetail, RECONCILE_REPORTS_SWR_KEY } from '@/lib/bankReconcileReportApi';
import BankReconcileWorkspace from './BankReconcileWorkspace';

interface BankReconcileLoadedSessionProps {
  reportId: string;
}

/**
 * โหมด "เปิดจากประวัติ" ของหน้า Bank Reconcile (เพิ่มเข้ามา 2026-07-19) — ถูกเรียกจาก BankReconcilePage.tsx
 * (dispatcher) เฉพาะตอน NavIntent เป็น 'open-reconcile-report' เท่านั้น หน้าที่เดียวของ component นี้คือดึง
 * ข้อมูลเต็มของรายการที่บันทึกไว้ผ่าน getReportDetail() แล้วส่งต่อให้ BankReconcileWorkspace แสดงผลทันที
 * ไม่มี business logic ใดๆ ในไฟล์นี้เลย เป็นแค่ loading/error state รอบ SWR เท่านั้น
 *
 * SWR key เป็น `${RECONCILE_REPORTS_SWR_KEY}/${reportId}` (ต่างจาก key ของรายการสรุปทั้งหมดในหน้าประวัติ —
 * BankReconcileHistoryPage.tsx ใช้ RECONCILE_REPORTS_SWR_KEY เปล่าๆ) เพราะเป็นคนละ query กัน (รายละเอียด 1
 * รายการเต็ม vs. สรุปทั้งหมดแบบเบา) ตั้งชื่อ prefix ให้เหมือนกันไว้แค่เพื่อสื่อความสัมพันธ์ ไม่ได้แชร์
 * cache กันจริง — gate ด้วย session เหมือนทุกจุดที่ดึงข้อมูลผ่าน SWR ในระบบนี้ (ดู ExpenseRecordContent,
 * ContactsPage.tsx) เพื่อไม่ให้ยิง request ก่อน auth พร้อม
 */
export default function BankReconcileLoadedSession({ reportId }: BankReconcileLoadedSessionProps) {
  const { session } = useAuth();
  const {
    data: detail,
    error: errorObj,
    isLoading: loading,
  } = useSWR(session ? `${RECONCILE_REPORTS_SWR_KEY}/${reportId}` : null, () => getReportDetail(reportId));

  const errorMessage = errorObj instanceof Error ? errorObj.message : errorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  if (loading) {
    return (
      <main
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 text-center sm:px-6"
        data-testid="bank-reconcile-loaded-loading"
      >
        <p className="text-sm text-text-sub">กำลังโหลดรายการที่บันทึกไว้...</p>
      </main>
    );
  }

  if (errorMessage || !detail) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6" data-testid="bank-reconcile-loaded-error">
        <p
          role="alert"
          className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {errorMessage ?? 'ไม่พบรายการที่ต้องการ อาจถูกลบไปแล้ว'}
        </p>
      </main>
    );
  }

  return <BankReconcileWorkspace initialData={detail} />;
}
