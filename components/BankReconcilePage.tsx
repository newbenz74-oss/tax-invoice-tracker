'use client';

import BankReconcileWorkspace from './BankReconcileWorkspace';
import BankReconcileLoadedSession from './BankReconcileLoadedSession';
import type { NavIntent } from '@/lib/navigation';

interface BankReconcilePageProps {
  initialIntent?: NavIntent | null;
}

/**
 * จุดเข้า "Bank Reconcile" จาก Sidebar — เดิมไฟล์นี้มีโค้ดทั้งหมดของหน้าอยู่ในตัวเอง (upload + ตรวจสอบ +
 * แสดงผล) ย้ายทั้งหมดไปที่ BankReconcileWorkspace.tsx แล้ว (2026-07-19 ตอนเพิ่มฟีเจอร์จับคู่เอง+บันทึก
 * ประวัติ) ไฟล์นี้เหลือแค่ทำหน้าที่ "ตัวกลาง" (dispatcher) เดียว: ถ้า intent เป็น 'open-reconcile-report'
 * (มาจากปุ่ม "เปิดดู/แก้ไข" ในหน้าประวัติ — ดู BankReconcileHistoryPage.tsx) → แสดง
 * BankReconcileLoadedSession ที่โหลดรายการนั้นมาแสดงทันที (ไม่ต้องอัปโหลดไฟล์ใหม่) ไม่เช่นนั้น (ไม่มี
 * intent มา หรือ intent เป็นชนิดอื่นที่ไม่เกี่ยวข้อง) → แสดง Workspace แบบเริ่มต้นใหม่ (อัปโหลดไฟล์เอง)
 * เหมือนเดิมทุกประการ — รับ initialIntent ต่อมาจาก app/dashboard/page.tsx (รูปแบบเดียวกับที่
 * ExpenseRecordContent รับ initialIntent อยู่แล้ว)
 *
 * key={initialIntent.reportId} บน BankReconcileLoadedSession กันไว้เผื่อในอนาคตมีทางนำทางจากรายการ
 * ประวัติหนึ่งไปอีกรายการหนึ่งโดยตรงโดยไม่ผ่าน unmount (ปัจจุบันไม่มีทางเกิดขึ้นจริง เพราะต้องผ่านหน้า
 * ประวัติ ('reconcile-history') ก่อนเสมอ ซึ่งทำให้ component นี้ unmount/remount เองอยู่แล้วตาม
 * renderActiveContent's switch — แต่ใส่ไว้เป็นตัวกันสำรองไม่ให้ state ของรายการเก่าค้างอยู่)
 */
export default function BankReconcilePage({ initialIntent = null }: BankReconcilePageProps) {
  if (initialIntent?.type === 'open-reconcile-report') {
    return <BankReconcileLoadedSession key={initialIntent.reportId} reportId={initialIntent.reportId} />;
  }
  return <BankReconcileWorkspace />;
}
