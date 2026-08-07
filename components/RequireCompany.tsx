'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useCompany } from '@/lib/CompanyContext';

/**
 * Gate เพิ่มเติมนอกเหนือจาก ProtectedRoute (ซึ่งเช็คแค่ "login แล้วหรือยัง") — เช็คว่ามีบริษัทที่กำลังใช้งาน
 * อยู่ (selectedCompanyId) หรือยัง ถ้ายังไม่มี (เช่น พิมพ์ URL /dashboard ตรงๆ โดยไม่ผ่านหน้าเลือกบริษัทเลย,
 * เปิดแท็บใหม่ที่ sessionStorage ยังไม่มีค่า, หรือบริษัทที่เคยเลือกไว้ถูกถอดสิทธิ์ไประหว่างนี้) จะเด้งไปหน้า
 * /select-company ให้เลือกก่อนเสมอ — ห่อเฉพาะ DashboardShell เท่านั้น (ไม่ห่อ /select-company เอง เพราะหน้า
 * นั้นเป็นคนสร้าง selectedCompanyId ขึ้นมา ไม่ใช่คนตรวจสอบมัน) เพิ่มเข้ามา 2026-08-07
 */
export default function RequireCompany({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { selectedCompanyId, loading } = useCompany();

  useEffect(() => {
    if (!loading && !selectedCompanyId) {
      router.replace('/select-company');
    }
  }, [loading, selectedCompanyId, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-page-bg">
        <p className="text-text-sub">กำลังโหลด...</p>
      </div>
    );
  }

  if (!selectedCompanyId) return null;

  return <>{children}</>;
}
