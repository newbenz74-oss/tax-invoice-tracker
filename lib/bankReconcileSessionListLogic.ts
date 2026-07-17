import type { ReconcileSession, ReconcileSessionStatus } from '@/types/bankReconcileSession';

/**
 * ตรรกะกรอง/นับของหน้ารายการ "ประวัติการกระทบยอดธนาคาร" (สเปกส่วน "6. SESSION LIST PAGE" / "7. SESSION
 * SEARCH AND FILTER") — แยกเป็น pure function ล้วนๆ ไม่แตะ Supabase เลย ตามธรรมเนียมเดียวกับ
 * lib/contactLogic.ts/lib/invoiceLogic.ts ทุกประการ เพื่อให้ทดสอบด้วย unit test ธรรมดาได้โดยไม่ต้อง mock
 * ฐานข้อมูล และให้ components/BankReconcileSessionList.tsx เป็นแค่ชั้นแสดงผล/เรียกใช้เท่านั้น
 */

/** Segmented Control มีแค่ 5 ปุ่มตามสเปกตรงๆ ("[ทั้งหมด] [แบบร่าง] [กำลังดำเนินการ] [เสร็จสมบูรณ์] [เปิดใหม่]")
 * ไม่มีปุ่ม "ยกเลิก" แยกต่างหาก — รอบที่ถูกยกเลิกแล้ว (status='cancelled') ยังคงแสดงในแท็บ "ทั้งหมด" ได้ตามปกติ
 * (ตัดออกจากรายการเฉพาะตอนถูกลบเท่านั้น ผ่าน deleted_at ที่ fetchReconcileSessions กรองออกให้แล้วชั้น API)
 * กรองแยกได้ผ่านตัวกรอง "สถานะ" แบบละเอียดแทน (ดู SessionListFilters.status ด้านล่าง) */
export type SessionListTab = 'all' | 'draft' | 'in_progress' | 'completed' | 'reopened';

export const SESSION_LIST_TABS: SessionListTab[] = ['all', 'draft', 'in_progress', 'completed', 'reopened'];

export const SESSION_LIST_TAB_LABELS: Record<SessionListTab, string> = {
  all: 'ทั้งหมด',
  draft: 'แบบร่าง',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสมบูรณ์',
  reopened: 'เปิดใหม่',
};

export interface SessionListFilters {
  tab: SessionListTab;
  /** ค้นหาจาก ชื่อรอบกระทบยอด / ชื่อไฟล์ Bank / ชื่อไฟล์ GL / เลขที่บัญชี ตามสเปกตรงๆ ("Search by: session
   * name, file names, account number") — จับคู่แบบ substring ไม่สนตัวพิมพ์เล็ก-ใหญ่ */
  search: string;
  /** ตัวกรองละเอียดทั้ง 7 มิติตามสเปก — ค่าว่าง ('' หรือ null) หมายถึง "ทั้งหมด" (ไม่กรองมิตินั้น) เสมอ ทุกมิติ
   * ใช้ AND ร่วมกัน (เหมือน Segmented Control status ด้านบน ก็ AND กับตัวกรองเหล่านี้ด้วยเช่นกัน) */
  year: string;
  month: string;
  bankName: string;
  bankAccountNo: string;
  status: ReconcileSessionStatus | '';
  createdByEmail: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export const DEFAULT_SESSION_LIST_FILTERS: SessionListFilters = {
  tab: 'all',
  search: '',
  year: '',
  month: '',
  bankName: '',
  bankAccountNo: '',
  status: '',
  createdByEmail: '',
  dateFrom: null,
  dateTo: null,
};

export function computeSessionStatusCounts(sessions: ReconcileSession[]): Record<SessionListTab, number> {
  return {
    all: sessions.length,
    draft: sessions.filter((s) => s.status === 'draft').length,
    in_progress: sessions.filter((s) => s.status === 'in_progress').length,
    completed: sessions.filter((s) => s.status === 'completed').length,
    reopened: sessions.filter((s) => s.status === 'reopened').length,
  };
}

/** "ปี"/"เดือน" ของรอบกระทบยอดหนึ่งรอบ ใช้ period_start เป็นหลักเสมอ (ช่วงวันที่ของรอบจริงมีความหมายตรงกับที่
 * ผู้ใช้อยากกรองมากกว่า) — fallback เป็น created_at เฉพาะรอบที่ไม่ได้ระบุ period_start ไว้เท่านั้น (ฟิลด์นี้
 * ไม่บังคับกรอกตอนบันทึกครั้งแรก) เพื่อไม่ให้รอบที่ไม่ได้ระบุช่วงวันที่หลุดออกจากทุกตัวกรองปีไปเลย */
function sessionPeriodYearMonth(session: ReconcileSession): { year: string; month: string } {
  const source = session.period_start ?? session.created_at;
  if (!source) return { year: '', month: '' };
  const [y, m] = source.slice(0, 10).split('-');
  return { year: y ?? '', month: m ? String(Number(m)) : '' };
}

export function filterReconcileSessions(sessions: ReconcileSession[], filters: SessionListFilters): ReconcileSession[] {
  const query = filters.search.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filters.tab !== 'all' && s.status !== filters.tab) return false;
    if (filters.status && s.status !== filters.status) return false;
    if (filters.bankName && s.bank_name !== filters.bankName) return false;
    if (filters.bankAccountNo && s.bank_account_no !== filters.bankAccountNo) return false;
    if (filters.createdByEmail && s.created_by_email !== filters.createdByEmail) return false;

    if (filters.year || filters.month) {
      const { year, month } = sessionPeriodYearMonth(s);
      if (filters.year && year !== filters.year) return false;
      if (filters.month && month !== filters.month) return false;
    }

    if (filters.dateFrom && s.created_at.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && s.created_at.slice(0, 10) > filters.dateTo) return false;

    if (query) {
      const haystack = [s.session_name, s.bank_file_name, s.gl_file_name, s.bank_account_no ?? '']
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export interface SessionListFilterOptions {
  years: string[];
  bankNames: string[];
  bankAccountNos: string[];
  createdByEmails: string[];
}

/** ดึงตัวเลือกที่มีอยู่จริงในข้อมูลปัจจุบันมาใช้เติม <select> ของตัวกรอง (ไม่ hardcode รายชื่อธนาคาร/ผู้สร้างไว้
 * ล่วงหน้า เพราะแต่ละทีมมีข้อมูลไม่เหมือนกัน) เรียงปีใหม่สุดก่อน (ผู้ใช้มักสนใจรอบล่าสุดมากกว่า) ส่วนธนาคาร/ผู้
 * สร้างเรียงตามตัวอักษรเพื่อหาง่าย */
export function extractSessionListFilterOptions(sessions: ReconcileSession[]): SessionListFilterOptions {
  const years = new Set<string>();
  const bankNames = new Set<string>();
  const bankAccountNos = new Set<string>();
  const createdByEmails = new Set<string>();
  for (const s of sessions) {
    const { year } = sessionPeriodYearMonth(s);
    if (year) years.add(year);
    if (s.bank_name) bankNames.add(s.bank_name);
    if (s.bank_account_no) bankAccountNos.add(s.bank_account_no);
    if (s.created_by_email) createdByEmails.add(s.created_by_email);
  }
  return {
    years: [...years].sort((a, b) => Number(b) - Number(a)),
    bankNames: [...bankNames].sort(),
    bankAccountNos: [...bankAccountNos].sort(),
    createdByEmails: [...createdByEmails].sort(),
  };
}
