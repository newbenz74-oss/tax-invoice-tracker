'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { fetchMyCompanies, type Company } from './companyApi';

/**
 * Context สำหรับฟีเจอร์ "รองรับหลายบริษัท" (เพิ่มเข้ามา 2026-08-07) — เก็บว่า user ที่ login อยู่เป็นสมาชิก
 * บริษัทไหนบ้าง (companies) และตอนนี้กำลังทำงานอยู่ในบริษัทไหน (selectedCompanyId)
 *
 * เก็บ selectedCompanyId ไว้ที่ sessionStorage (ไม่ใช่ localStorage) ตามที่ผู้ใช้ยืนยันชัดเจนว่า "เลือกใหม่
 * ทุกครั้งที่ล็อกอิน" ไม่ต้องการให้จำข้ามการล็อกอิน — sessionStorage อยู่รอดแค่ข้าม refresh หน้าเว็บภายใน
 * แท็บเดียวกัน (ไม่ต้องเลือกใหม่ทุกครั้งที่ปุ่ม refresh ซึ่งจะน่ารำคาญเกินไปและไม่ใช่สิ่งที่ผู้ใช้ขอ) แต่ถูก
 * ล้างทิ้งอย่างชัดเจนตอนกด "ออกจากระบบ" (ดู components/Header.tsx handleSignOut) เพื่อบังคับให้เลือกใหม่จริง
 * ในรอบล็อกอินถัดไปตามที่ตกลงกันไว้
 */
const STORAGE_KEY = 'benz_selected_company_id';

interface CompanyContextValue {
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  loading: boolean;
  error: string | null;
  selectCompany: (id: string) => void;
  clearSelection: () => void;
  reload: () => void;
}

const CompanyContext = createContext<CompanyContextValue>({
  companies: [],
  selectedCompanyId: null,
  selectedCompany: null,
  loading: true,
  error: null,
  selectCompany: () => {},
  clearSelection: () => {},
  reload: () => {},
});

function readStoredSelection(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(readStoredSelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    // ไม่มี session = ยังไม่ login (หรือเพิ่ง logout) — ไม่เรียก setState ตรงๆ ในจุดนี้เลย (กัน
    // react-hooks/set-state-in-effect: "ห้าม setState ตรงๆ ใน effect body แบบไม่มี async คั่นกลาง" ตามกฎ
    // เดิมของโปรเจกต์นี้ ดู lib/AuthContext.tsx/app/login/page.tsx ที่ยึดกฎเดียวกัน) ปล่อยให้ companies/
    // loading เป็นค่าเดิมค้างไว้ไปก่อน — ไม่กระทบอะไรเพราะไม่มีหน้าไหน render โดยอิงข้อมูลนี้ตอนไม่มี session
    // อยู่แล้ว (ProtectedRoute เด้งไปหน้า /login ก่อนเสมอ) พอ login ใหม่ (session เปลี่ยนเป็นไม่ null) effect
    // นี้จะรันใหม่แล้วดึงข้อมูลสดเข้ามาทับของเก่าเองโดยอัตโนมัติ
    if (!session) return;
    let mounted = true;
    // setLoading(true)/setError(null) ต้องอยู่ใน .then() แรก ไม่ใช่ statement ตรงๆ ใน effect body (เหมือน
    // กันกับ react-hooks/set-state-in-effect ที่ lib/AuthContext.tsx ยึดอยู่แล้ว — setState ทุกจุดต้องอยู่
    // ใน callback ของ promise/event listener เท่านั้น ไม่ใช่ synchronous ตรงๆ ในตัว effect เอง)
    Promise.resolve()
      .then(() => {
        if (!mounted) return undefined;
        setLoading(true);
        setError(null);
        return fetchMyCompanies();
      })
      .then((list) => {
        if (!list) return;
        if (!mounted) return;
        setCompanies(list);
        // ถ้าบริษัทที่เคยเลือกไว้ (จาก sessionStorage) ไม่อยู่ในลิสต์ที่โหลดมาใหม่แล้ว (เช่นถูกถอดสิทธิ์
        // ออกไประหว่างนี้) ล้างค่าที่ค้างไว้ทิ้งไปเลย กันพาไปหน้าที่ดูข้อมูลบริษัทที่ไม่มีสิทธิ์แล้ว
        setSelectedCompanyIdState((prev) => (prev && list.some((c) => c.id === prev) ? prev : null));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'โหลดรายชื่อบริษัทไม่สำเร็จ');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session, reloadTick]);

  const selectCompany = useCallback((id: string) => {
    setSelectedCompanyIdState(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // sessionStorage ใช้ไม่ได้ (private mode ฯลฯ) — ยังเลือกได้ปกติ แค่ไม่รอดข้าม refresh
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCompanyIdState(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ไม่เป็นไร
    }
  }, []);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  return (
    <CompanyContext.Provider
      value={{
        companies,
        selectedCompanyId,
        selectedCompany,
        loading,
        error,
        selectCompany,
        clearSelection,
        reload: () => setReloadTick((t) => t + 1),
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  return useContext(CompanyContext);
}
