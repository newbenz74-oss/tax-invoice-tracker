'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { AUDIT_LOGS_SWR_KEY, fetchAuditLogs } from '@/lib/auditLogApi';
import {
  actionLabel,
  actorLabel,
  collectActorEmails,
  describeChanges,
  describeEntry,
  describeSnapshot,
  formatAuditTimestamp,
  tableLabel,
} from '@/lib/auditLogLogic';
import {
  AUDITED_TABLES,
  DEFAULT_AUDIT_FILTER,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogFilter,
  type AuditedTable,
} from '@/types/auditLog';

/**
 * หน้า "ประวัติการใช้งาน" (เพิ่มเข้ามา 2026-09-14) — แสดงว่าใครทำอะไรกับข้อมูลของบริษัทที่เลือกอยู่บ้าง
 * ดู supabase/migration_026_audit_logs.sql สำหรับที่มาของข้อมูล และ lib/auditLogLogic.ts สำหรับการแปลง
 * แถวดิบเป็นภาษาไทย (มีเทสต์ครอบคลุมแล้วที่ lib/auditLogLogic.test.ts)
 *
 * ทำไมแบ่งหน้าแบบ "ก่อนหน้า/ถัดไป" ไม่ใช่เลขหน้า 1 2 3 … เหมือนหน้าอื่นในระบบ: หน้าอื่นโหลดข้อมูลทั้งชุด
 * มาไว้ในเบราว์เซอร์แล้วค่อยตัดหน้า จึงรู้จำนวนหน้าทั้งหมดตั้งแต่แรก — แต่ตารางประวัติโตไม่หยุดและไม่มีการ
 * ลบอัตโนมัติ บริษัทที่ใช้มาสองสามปีอาจมีเป็นแสนแถว จึงต้องดึงทีละหน้าจากฐานข้อมูล ซึ่งทำให้ไม่รู้จำนวน
 * หน้าทั้งหมดโดยไม่สั่งนับทั้งตารางทุกครั้ง (แพงโดยไม่จำเป็น) — รู้แค่ "ยังมีต่อไหม" ก็พอสำหรับการไล่ดู
 */

const ACTION_OPTIONS: { value: AuditAction | 'all'; label: string }[] = [
  { value: 'all', label: 'ทุกการกระทำ' },
  { value: 'insert', label: 'เพิ่ม' },
  { value: 'update', label: 'แก้ไข' },
  { value: 'delete', label: 'ลบ' },
  { value: 'restore_end', label: 'กู้คืนข้อมูล' },
  // ต้องกรองหาได้ด้วย — เป็นร่องรอยของ "ช่วงที่การบันทึกประวัติถูกพักไว้" ซึ่งเป็นสิ่งแรกที่ต้องตามดูเวลา
  // สงสัยว่าทำไมประวัติช่วงหนึ่งถึงหายไป (ดูหัวข้อ 3 ใน supabase/migration_026_audit_logs.sql)
  { value: 'restore_begin', label: 'เริ่มกู้คืนข้อมูล (พักการบันทึก)' },
];

/** สีป้ายตามความ "ย้อนกลับยากแค่ไหน" ไม่ใช่ตามชนิดเฉยๆ — ลบคือสิ่งที่ต้องสะดุดตาที่สุดเวลากวาดสายตาหา */
const ACTION_BADGE: Record<AuditAction, string> = {
  insert: 'bg-success/15 text-success',
  update: 'bg-warning/15 text-warning',
  delete: 'bg-danger/15 text-danger',
  restore_begin: 'bg-primary/12 text-primary',
  restore_end: 'bg-primary/12 text-primary',
};

export default function ActivityLogPage() {
  const { session } = useAuth();
  const { selectedCompanyId } = useCompany();

  const [filter, setFilter] = useState<AuditLogFilter>(DEFAULT_AUDIT_FILTER);
  const [page, setPage] = useState(1);
  // ช่องค้นหาแยก state จาก filter.search เพราะยิง query ต่อการพิมพ์ทุกตัวอักษรจะถี่เกินไป — ผู้ใช้กด Enter
  // หรือกดปุ่มค้นหาเองเมื่อพิมพ์เสร็จ (ตั้งใจไม่ใช้ debounce เพื่อให้พฤติกรรมคาดเดาได้ว่าค้นตอนไหน)
  const [searchDraft, setSearchDraft] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const {
    data,
    error: loadErrorObj,
    isLoading,
  } = useSWR(
    session && selectedCompanyId ? [AUDIT_LOGS_SWR_KEY, selectedCompanyId, filter, page] : null,
    () => fetchAuditLogs(selectedCompanyId!, filter, page)
  );

  const loadError = loadErrorObj
    ? loadErrorObj instanceof Error
      ? loadErrorObj.message
      : 'โหลดประวัติไม่สำเร็จ'
    : null;

  const entries = useMemo(() => data?.entries ?? [], [data]);
  // รายชื่อผู้ทำสร้างจากหน้าที่กำลังดูอยู่ — ไม่ใช่รายชื่อสมาชิกทั้งบริษัท จึงอาจไม่ครบทุกคนถ้าหน้านี้ไม่มี
  // รายการของเขา ยอมรับได้เพราะจุดประสงค์คือ "กรองคนที่เพิ่งเห็นชื่อในรายการ" ไม่ใช่ไดเรกทอรีสมาชิก
  const actorOptions = useMemo(() => collectActorEmails(entries), [entries]);

  function updateFilter(patch: Partial<AuditLogFilter>) {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1); // เปลี่ยนเงื่อนไขแล้วต้องกลับหน้าแรกเสมอ ไม่งั้นอาจไปโผล่หน้าที่ไม่มีข้อมูลแล้วดูเหมือนว่าง
    setExpandedId(null);
  }

  function handleSearch() {
    updateFilter({ search: searchDraft });
  }

  function handleResetFilter() {
    setSearchDraft('');
    setFilter(DEFAULT_AUDIT_FILTER);
    setPage(1);
    setExpandedId(null);
  }

  const filterActive =
    filter.table !== 'all' || filter.action !== 'all' || filter.actorEmail !== 'all' || filter.search !== '';

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6" data-testid="activity-log-page">
      <p className="mb-5 text-sm text-text-sub">
        บันทึกว่าใครเพิ่ม แก้ไข หรือลบข้อมูลอะไรของบริษัทนี้บ้าง เรียงใหม่สุดก่อน — กดที่แถวเพื่อดูว่าค่าไหน
        เปลี่ยนจากอะไรเป็นอะไร ประวัตินี้แก้ไขหรือลบไม่ได้ทั้งจากหน้าเว็บและจากบัญชีผู้ดูแล
      </p>

      {/* แถบตัวกรอง */}
      <div className="card-surface mb-4 rounded-2xl p-3.5" data-testid="activity-log-filters">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-sub">ประเภทข้อมูล</span>
            <select
              value={filter.table}
              onChange={(e) => updateFilter({ table: e.target.value as AuditedTable | 'all' })}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              data-testid="activity-log-filter-table"
            >
              <option value="all">ทุกประเภท</option>
              {AUDITED_TABLES.map((table) => (
                <option key={table} value={table}>
                  {tableLabel(table)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-sub">การกระทำ</span>
            <select
              value={filter.action}
              onChange={(e) => updateFilter({ action: e.target.value as AuditAction | 'all' })}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              data-testid="activity-log-filter-action"
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[190px] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-sub">ทำโดย</span>
            <select
              value={filter.actorEmail}
              onChange={(e) => updateFilter({ actorEmail: e.target.value })}
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              data-testid="activity-log-filter-actor"
            >
              <option value="all">ทุกคน</option>
              {/* ค่าที่เลือกไว้อาจไม่อยู่ในรายการของหน้านี้ ต้องใส่กลับเข้าไปเองไม่งั้น <select> จะเด้งกลับ */}
              {(filter.actorEmail !== 'all' && !actorOptions.includes(filter.actorEmail)
                ? [filter.actorEmail, ...actorOptions]
                : actorOptions
              ).map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[200px] flex-[2] flex-col gap-1.5">
            <span className="text-xs font-medium text-text-sub">ค้นหาจากชื่อรายการ</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="เช่น ชื่อผู้ขาย เลขที่ใบรับรอง"
                className="min-w-0 flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm text-text placeholder:text-text-sub focus:border-primary focus:outline-none"
                data-testid="activity-log-search-input"
              />
              <button
                type="button"
                onClick={handleSearch}
                className="btn-press flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary"
                data-testid="activity-log-search-submit"
              >
                <Search size={15} aria-hidden="true" />
                ค้นหา
              </button>
            </div>
          </label>

          {filterActive && (
            <button
              type="button"
              onClick={handleResetFilter}
              className="btn-press flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-sub transition-colors hover:text-primary"
              data-testid="activity-log-reset-filter"
            >
              <RotateCcw size={15} aria-hidden="true" />
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <p
          role="alert"
          className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          data-testid="activity-log-error"
        >
          {loadError}
        </p>
      )}

      {isLoading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : entries.length === 0 ? (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-12 text-center text-sm text-text-sub"
          data-testid="activity-log-empty"
        >
          {filterActive
            ? 'ไม่พบประวัติที่ตรงกับเงื่อนไขที่เลือก — ลองล้างตัวกรองแล้วดูใหม่'
            : 'ยังไม่มีประวัติการใช้งาน — รายการจะเริ่มถูกบันทึกตั้งแต่ครั้งถัดไปที่มีคนเพิ่ม แก้ไข หรือลบข้อมูล'}
        </div>
      ) : (
        <div className="card-surface overflow-hidden rounded-2xl" data-testid="activity-log-table">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เมื่อไหร่</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ทำอะไร</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">โดยใคร</th>
                <th className="w-10 px-[18px] py-[18px]" aria-label="ดูรายละเอียด" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {entries.map((entry, index) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  zebra={index % 2 === 1}
                  expanded={expandedId === entry.id}
                  onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || data?.hasMore) && (
        <div className="mt-4 flex items-center justify-between" data-testid="activity-log-pagination">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              setExpandedId(null);
            }}
            className="btn-press rounded-lg border border-border px-3.5 py-2 text-sm text-text disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="activity-log-prev"
          >
            ← ก่อนหน้า
          </button>
          <span className="text-xs text-text-sub">หน้า {page}</span>
          <button
            type="button"
            disabled={!data?.hasMore}
            onClick={() => {
              setPage((p) => p + 1);
              setExpandedId(null);
            }}
            className="btn-press rounded-lg border border-border px-3.5 py-2 text-sm text-text disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="activity-log-next"
          >
            ถัดไป →
          </button>
        </div>
      )}
    </main>
  );
}

function AuditRow({
  entry,
  zebra,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  zebra: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const changes = describeChanges(entry);
  const snapshot = describeSnapshot(entry);
  const hasDetail = changes.length > 0 || snapshot.length > 0;

  return (
    <>
      <tr
        className={`transition-colors duration-150 hover:bg-table-row-hover ${zebra ? 'bg-table-row-zebra' : ''} ${
          hasDetail ? 'cursor-pointer' : ''
        }`}
        onClick={hasDetail ? onToggle : undefined}
        data-testid={`activity-log-row-${entry.id}`}
      >
        {/* ทั้งแถวคลิกได้เพื่อความสะดวก แต่ "ทางเข้าหลัก" สำหรับคีย์บอร์ด/screen reader คือปุ่มลูกศรท้ายแถว
            (มี aria-expanded/aria-controls ครบ) — จงใจไม่ใส่ role="button"+tabIndex ที่ <tr> ด้วย เพราะจะ
            กลายเป็นว่าทุกแถวถูก Tab ซ้ำสองจุดที่ทำงานเหมือนกัน ทำให้ไล่ตารางยาวๆ ด้วยคีย์บอร์ดช้าลงเท่าตัว */}
        <td className="px-[18px] py-[14px] align-top whitespace-nowrap text-text-sub">
          {formatAuditTimestamp(entry.created_at)}
        </td>
        <td className="px-[18px] py-[14px] align-top">
          <span
            className={`mr-2 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ACTION_BADGE[entry.action]}`}
          >
            {actionLabel(entry.action)}
          </span>
          <span className="text-text">{describeEntry(entry)}</span>
          {changes.length > 0 && (
            <span className="ml-2 text-xs text-text-sub">({changes.length} รายการที่เปลี่ยน)</span>
          )}
        </td>
        <td className="px-[18px] py-[14px] align-top text-text-sub">{actorLabel(entry)}</td>
        <td className="px-[18px] py-[14px] align-top text-right">
          {hasDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-expanded={expanded}
              aria-controls={`activity-log-detail-${entry.id}`}
              aria-label={`${expanded ? 'ยุบ' : 'ขยาย'}รายละเอียด`}
              className="text-text-sub transition-colors hover:text-primary"
              data-testid={`activity-log-toggle-${entry.id}`}
            >
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={`transition-transform duration-[250ms] ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </td>
      </tr>

      {expanded && hasDetail && (
        // ใช้ bg-primary/12 ไม่ใช่ bg-table-header — โทนตารางเป็นสีโปร่งแสงอ่อนมากอยู่แล้ว (alpha .07)
        // ถ้าเอามาใช้ซ้ำ แถวรายละเอียดจะแทบแยกไม่ออกจากแถวปกติ ต้องเข้มกว่าพอให้เห็นว่าเป็นส่วนขยายของแถวบน
        <tr
          id={`activity-log-detail-${entry.id}`}
          className="bg-primary/12"
          data-testid={`activity-log-detail-${entry.id}`}
        >
          <td colSpan={4} className="px-[18px] py-3.5">
            {changes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {changes.map((change) => (
                  <li key={change.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="min-w-[140px] font-medium text-text">{change.label}</span>
                    <span className="text-text-sub line-through decoration-danger/50">{change.before}</span>
                    <span className="text-text-sub">→</span>
                    <span className="font-medium text-text">{change.after}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="mb-2 text-xs text-text-sub">
                  {entry.action === 'delete'
                    ? 'ค่าสุดท้ายก่อนถูกลบ'
                    : entry.action === 'restore_end'
                      ? 'รายละเอียดการกู้คืน'
                      : 'ค่าที่บันทึกไว้ตอนสร้าง'}
                </p>
                <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {snapshot.map((item) => (
                    <li key={item.field} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="min-w-[140px] text-text-sub">{item.label}</span>
                      <span className="text-text">{item.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
