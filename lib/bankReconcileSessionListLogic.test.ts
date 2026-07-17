import { describe, expect, it } from 'vitest';
import {
  computeSessionStatusCounts,
  DEFAULT_SESSION_LIST_FILTERS,
  filterReconcileSessions,
} from './bankReconcileSessionListLogic';
import type { ReconcileSession } from '@/types/bankReconcileSession';

function makeSession(overrides: Partial<ReconcileSession> = {}): ReconcileSession {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    session_name: 'กระทบยอดกรกฎาคม',
    bank_file_name: 'statement.xlsx',
    gl_file_name: 'gl.xlsx',
    bank_source_file_type: 'excel',
    gl_source_file_type: 'excel',
    bank_row_count: 10,
    gl_row_count: 10,
    found_count: 8,
    bank_not_found_count: 2,
    gl_not_found_count: 1,
    bank_income_total: 1000,
    bank_payment_total: 500,
    gl_income_total: 900,
    gl_payment_total: 450,
    income_difference: 100,
    payment_difference: 50,
    status: 'in_progress',
    created_by: 'user-1',
    created_by_email: 'creator@example.com',
    created_at: '2026-07-16T08:00:00.000Z',
    updated_by: 'user-1',
    updated_by_email: 'creator@example.com',
    updated_at: '2026-07-16T09:00:00.000Z',
    completed_by: null,
    completed_by_email: null,
    completed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('computeSessionStatusCounts', () => {
  it('นับจำนวนแยกตามสถานะครบ 3 กลุ่ม (all/in_progress/completed) — ตรงตาม SessionListTab ใหม่ 3 ค่า', () => {
    const sessions = [
      makeSession({ status: 'in_progress' }),
      makeSession({ status: 'in_progress' }),
      makeSession({ status: 'completed' }),
    ];
    const counts = computeSessionStatusCounts(sessions);
    expect(counts.all).toBe(3);
    expect(counts.in_progress).toBe(2);
    expect(counts.completed).toBe(1);
  });

  it('ไม่มีรอบกระทบยอดเลย = ทุกช่องเป็น 0', () => {
    const counts = computeSessionStatusCounts([]);
    expect(counts).toEqual({ all: 0, in_progress: 0, completed: 0 });
  });
});

describe('filterReconcileSessions', () => {
  const sessions = [
    makeSession({ id: '1', session_name: 'กระทบยอดบัญชี A', status: 'in_progress', bank_file_name: 'a-statement.xlsx' }),
    makeSession({ id: '2', session_name: 'กระทบยอดบัญชี B', status: 'in_progress', bank_file_name: 'b-statement.pdf' }),
    makeSession({ id: '3', session_name: 'กระทบยอดบัญชี C', status: 'completed', gl_file_name: 'gl-c.csv' }),
  ];

  it('ค่าเริ่มต้น (tab=all ไม่มีคำค้นหา) คืนทุกรอบ', () => {
    expect(filterReconcileSessions(sessions, DEFAULT_SESSION_LIST_FILTERS)).toHaveLength(3);
  });

  it('tab กรองตามสถานะตรงๆ', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'completed' });
    expect(result.map((s) => s.id)).toEqual(['3']);
  });

  it('tab "in_progress" คืนเฉพาะรอบที่ยังไม่เสร็จ', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'in_progress' });
    expect(result.map((s) => s.id).sort()).toEqual(['1', '2']);
  });

  it('ค้นหาจากชื่อรอบกระทบยอด ไม่สนตัวพิมพ์เล็ก-ใหญ่', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: 'บัญชี B' });
    expect(result.map((s) => s.id)).toEqual(['2']);
  });

  it('ค้นหาจากชื่อไฟล์ Bank ได้เช่นกัน', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: 'a-statement' });
    expect(result.map((s) => s.id)).toEqual(['1']);
  });

  it('ค้นหาจากชื่อไฟล์ GL ได้เช่นกัน', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: 'gl-c' });
    expect(result.map((s) => s.id)).toEqual(['3']);
  });

  it('รวม tab + ค้นหาเข้าด้วยกันแบบ AND', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'in_progress', search: 'C' });
    expect(result).toHaveLength(0);

    const match = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'completed', search: 'C' });
    expect(match.map((s) => s.id)).toEqual(['3']);
  });

  it('คำค้นหาที่ไม่ตรงอะไรเลย = ไม่พบผลลัพธ์', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: 'ไม่มีจริงแน่นอน' });
    expect(result).toHaveLength(0);
  });

  it('ตัดช่องว่างหน้า-หลังคำค้นหาก่อนเทียบ', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: '  บัญชี B  ' });
    expect(result.map((s) => s.id)).toEqual(['2']);
  });
});
