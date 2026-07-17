import type { ReconcileSession, ReconcileSessionStatus } from '@/types/bankReconcileSession';

/**
 * ตรรกะกรอง/นับของหน้ารายการ "ประวัติการกระทบยอดธนาคาร" — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild
 * โมดูลทั้งโมดูล ลดจำนวนตัวกรองลงมากจากเดิม (เดิมมี 7 มิติ: ปี/เดือน/ธนาคาร/เลขที่บัญชี/สถานะ/ผู้สร้าง/ช่วง
 * วันที่) เหลือแค่ค้นหา + สถานะ ตามเจตนา "a new and simpler reconciliation workflow" ของสเปก — ฟีเจอร์อื่นที่
 * ตัดออก (ทำสำเนา/เปลี่ยนชื่อ/ยกเลิกรอบ/ตัวกรองปี-เดือน-ธนาคาร-ผู้สร้าง-ช่วงวันที่) ไม่มีส่วนใดในสเปกใหม่ 24
 * ส่วนร้องขอเลย จึงไม่นำกลับมาสร้างใหม่ (ระบุไว้ในสรุปผลตอนส่งมอบด้วย) เป็น pure function ล้วนๆ ไม่แตะ
 * Supabase เลย ตามธรรมเนียมเดิม
 */

export type SessionListTab = 'all' | 'in_progress' | 'completed';

export const SESSION_LIST_TABS: SessionListTab[] = ['all', 'in_progress', 'completed'];

export const SESSION_LIST_TAB_LABELS: Record<SessionListTab, string> = {
  all: 'ทั้งหมด',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสมบูรณ์',
};

export interface SessionListFilters {
  tab: SessionListTab;
  /** ค้นหาจาก ชื่อรอบกระทบยอด / ชื่อไฟล์ Bank / ชื่อไฟล์ GL — จับคู่แบบ substring ไม่สนตัวพิมพ์เล็ก-ใหญ่ */
  search: string;
}

export const DEFAULT_SESSION_LIST_FILTERS: SessionListFilters = { tab: 'all', search: '' };

export function computeSessionStatusCounts(sessions: ReconcileSession[]): Record<SessionListTab, number> {
  return {
    all: sessions.length,
    in_progress: sessions.filter((s) => s.status === 'in_progress').length,
    completed: sessions.filter((s) => s.status === 'completed').length,
  };
}

export function filterReconcileSessions(sessions: ReconcileSession[], filters: SessionListFilters): ReconcileSession[] {
  const query = filters.search.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filters.tab !== 'all' && s.status !== filters.tab) return false;
    if (query) {
      const haystack = [s.session_name, s.bank_file_name, s.gl_file_name].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** เผื่อผู้เรียกต้องการใช้ค่านี้ประกอบ UI อื่น (เช่น ป้ายสถานะ) — export ชนิดซ้ำจาก types ไว้ให้เรียกจากที่
 * เดียวกันสะดวก ไม่ต้อง import จากสองที่ */
export type { ReconcileSessionStatus };
