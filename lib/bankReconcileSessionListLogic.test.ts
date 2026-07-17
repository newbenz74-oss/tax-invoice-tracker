import { describe, expect, it } from 'vitest';
import {
  computeSessionStatusCounts,
  DEFAULT_SESSION_LIST_FILTERS,
  extractSessionListFilterOptions,
  filterReconcileSessions,
} from './bankReconcileSessionListLogic';
import type { ReconcileSession } from '@/types/bankReconcileSession';

function makeSession(overrides: Partial<ReconcileSession> = {}): ReconcileSession {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    session_name: 'กระทบยอดกรกฎาคม',
    bank_account_no: '123-4-56789-0',
    bank_name: 'ธนาคารทดสอบ',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    bank_file_name: 'statement.xlsx',
    gl_file_name: 'gl.xlsx',
    bank_row_count: 10,
    gl_row_count: 10,
    matched_count: 8,
    suggested_count: 0,
    manual_match_count: 0,
    review_count: 0,
    unmatched_bank_count: 2,
    unmatched_gl_count: 1,
    bank_total: 1000,
    gl_total: 900,
    matched_bank_total: 800,
    matched_gl_total: 800,
    unmatched_bank_total: 200,
    unmatched_gl_total: 100,
    net_difference: 100,
    date_tolerance_days: 3,
    amount_tolerance: 0,
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
    completion_note: null,
    reopened_by: null,
    reopened_by_email: null,
    reopened_at: null,
    reopen_reason: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('computeSessionStatusCounts', () => {
  it('นับจำนวนแยกตามสถานะครบ 5 กลุ่ม (รวม all)', () => {
    const sessions = [
      makeSession({ status: 'draft' }),
      makeSession({ status: 'in_progress' }),
      makeSession({ status: 'in_progress' }),
      makeSession({ status: 'completed' }),
      makeSession({ status: 'reopened' }),
      makeSession({ status: 'cancelled' }),
    ];
    const counts = computeSessionStatusCounts(sessions);
    expect(counts.all).toBe(6);
    expect(counts.draft).toBe(1);
    expect(counts.in_progress).toBe(2);
    expect(counts.completed).toBe(1);
    expect(counts.reopened).toBe(1);
  });
});

describe('filterReconcileSessions', () => {
  const sessions = [
    makeSession({ id: '1', session_name: 'กระทบยอดบัญชี A', status: 'draft', bank_name: 'ธนาคาร A', bank_account_no: '111' }),
    makeSession({ id: '2', session_name: 'กระทบยอดบัญชี B', status: 'in_progress', bank_name: 'ธนาคาร B', bank_account_no: '222' }),
    makeSession({ id: '3', session_name: 'กระทบยอดบัญชี C', status: 'completed', bank_name: 'ธนาคาร A', bank_account_no: '111', created_by_email: 'other@example.com' }),
    makeSession({ id: '4', session_name: 'กระทบยอดบัญชี D', status: 'cancelled', bank_name: 'ธนาคาร A' }),
  ];

  it('ค่าเริ่มต้น (tab=all ไม่มีตัวกรองอื่น) คืนทุกรอบรวมถึงที่ยกเลิกแล้ว', () => {
    expect(filterReconcileSessions(sessions, DEFAULT_SESSION_LIST_FILTERS)).toHaveLength(4);
  });

  it('tab กรองตามสถานะตรงๆ', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'draft' });
    expect(result.map((s) => s.id)).toEqual(['1']);
  });

  it('tab "all" ไม่มีปุ่มสำหรับ "cancelled" แต่ยังกรองผ่านตัวกรอง status ละเอียดได้', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, status: 'cancelled' });
    expect(result.map((s) => s.id)).toEqual(['4']);
  });

  it('ค้นหาจากชื่อรอบกระทบยอด ไม่สนตัวพิมพ์เล็ก-ใหญ่', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: 'บัญชี B' });
    expect(result.map((s) => s.id)).toEqual(['2']);
  });

  it('ค้นหาจากเลขที่บัญชีได้เช่นกัน', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, search: '222' });
    expect(result.map((s) => s.id)).toEqual(['2']);
  });

  it('กรองธนาคาร + เลขที่บัญชี พร้อมกัน (AND)', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, bankName: 'ธนาคาร A', bankAccountNo: '111' });
    expect(result.map((s) => s.id).sort()).toEqual(['1', '3']);
  });

  it('กรองผู้สร้าง', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, createdByEmail: 'other@example.com' });
    expect(result.map((s) => s.id)).toEqual(['3']);
  });

  it('รวม tab + ค้นหาเข้าด้วยกันแบบ AND', () => {
    const result = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'completed', search: 'C' });
    expect(result.map((s) => s.id)).toEqual(['3']);
    const noMatch = filterReconcileSessions(sessions, { ...DEFAULT_SESSION_LIST_FILTERS, tab: 'completed', search: 'ไม่มีจริง' });
    expect(noMatch).toHaveLength(0);
  });

  it('กรองปี/เดือนจาก period_start', () => {
    const withPeriod = [
      makeSession({ id: 'p1', period_start: '2026-01-15' }),
      makeSession({ id: 'p2', period_start: '2026-07-01' }),
      makeSession({ id: 'p3', period_start: '2025-07-01' }),
    ];
    expect(filterReconcileSessions(withPeriod, { ...DEFAULT_SESSION_LIST_FILTERS, year: '2026' }).map((s) => s.id).sort()).toEqual(['p1', 'p2']);
    expect(filterReconcileSessions(withPeriod, { ...DEFAULT_SESSION_LIST_FILTERS, year: '2026', month: '7' }).map((s) => s.id)).toEqual(['p2']);
  });

  it('fallback เป็น created_at เมื่อไม่มี period_start สำหรับตัวกรองปี', () => {
    const noPeriod = [makeSession({ id: 'np1', period_start: null, created_at: '2026-03-01T00:00:00.000Z' })];
    expect(filterReconcileSessions(noPeriod, { ...DEFAULT_SESSION_LIST_FILTERS, year: '2026', month: '3' })).toHaveLength(1);
  });

  it('กรองช่วงวันที่จาก created_at', () => {
    const dated = [
      makeSession({ id: 'd1', created_at: '2026-07-01T00:00:00.000Z' }),
      makeSession({ id: 'd2', created_at: '2026-07-15T00:00:00.000Z' }),
      makeSession({ id: 'd3', created_at: '2026-08-01T00:00:00.000Z' }),
    ];
    const result = filterReconcileSessions(dated, { ...DEFAULT_SESSION_LIST_FILTERS, dateFrom: '2026-07-10', dateTo: '2026-07-31' });
    expect(result.map((s) => s.id)).toEqual(['d2']);
  });
});

describe('extractSessionListFilterOptions', () => {
  it('ดึงตัวเลือกที่มีอยู่จริงมาโดยไม่ซ้ำ และเรียงปีใหม่สุดก่อน', () => {
    const sessions = [
      makeSession({ period_start: '2025-01-01', bank_name: 'ธนาคาร B', bank_account_no: '222', created_by_email: 'a@example.com' }),
      makeSession({ period_start: '2026-01-01', bank_name: 'ธนาคาร A', bank_account_no: '111', created_by_email: 'b@example.com' }),
      makeSession({ period_start: '2026-06-01', bank_name: 'ธนาคาร A', bank_account_no: '111', created_by_email: 'a@example.com' }),
    ];
    const options = extractSessionListFilterOptions(sessions);
    expect(options.years).toEqual(['2026', '2025']);
    expect(options.bankNames).toEqual(['ธนาคาร A', 'ธนาคาร B']);
    expect(options.bankAccountNos).toEqual(['111', '222']);
    expect(options.createdByEmails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('ไม่รวมค่า null/ว่างเข้าไปในตัวเลือก', () => {
    const sessions = [makeSession({ bank_name: null, bank_account_no: null, created_by_email: null, period_start: null, created_at: '' })];
    const options = extractSessionListFilterOptions(sessions);
    expect(options.bankNames).toEqual([]);
    expect(options.bankAccountNos).toEqual([]);
    expect(options.createdByEmails).toEqual([]);
  });
});
