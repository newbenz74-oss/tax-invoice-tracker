'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MatchGroup } from '@/types/bankReconcileMatch';
import BankReconcilePagination from './BankReconcilePagination';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const PAGE_SIZE = 20;

function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function sumOf(rows: Array<{ amount: number }>): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

interface BankReconcileMatchedTableProps {
  groups: MatchGroup[];
}

/** SECTION 1 "กระทบยอดสำเร็จ" — Bank Statement ทางซ้าย, GL ทางขวา ในตารางเดียวกัน 1 แถว = 1 กลุ่มที่จับคู่
 * สำเร็จ (เพิ่มเข้ามา 2026-07-19: ก่อนหน้านี้ 1 แถว = 1 คู่ 1:1 เท่านั้น ตอนนี้รองรับกลุ่มแบบ N:M จากการจับคู่
 * เองด้วย — ดู types/bankReconcileMatch.ts) กลุ่มที่มาจากอัลกอริทึมอัตโนมัติจะมี Bank 1 + GL 1 เสมอ (เหมือน
 * พฤติกรรมเดิม 100%) จึงแสดงวันที่/เลขที่เอกสารจริงตรงๆ เหมือนเดิมทุกประการ ไม่มีอะไรเปลี่ยนสำหรับเคสนี้ —
 * กลุ่มที่มีมากกว่า 1 แถวฝั่งใดฝั่งหนึ่ง (มาจากการจับคู่เองแบบ N:M เท่านั้น) จะย่อแสดงเป็น "N รายการ" + ยอดรวม
 * พร้อมปุ่มขยายดูรายละเอียดทุกแถวย่อย — คอลัมน์ขยาย/badge ที่เพิ่มเข้ามาไม่กระทบจำนวนแถวของกลุ่ม 1:1 เดิมเลย
 * (ไม่มีแถวรายละเอียดเพิ่มสำหรับกลุ่มที่ไม่ใช่ N:M) จึงไม่กระทบ e2e assertion เดิมที่นับจำนวนแถวในตารางนี้ */
export default function BankReconcileMatchedTable({ groups }: BankReconcileMatchedTableProps) {
  const [page, setPage] = useState(1);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [groups, safePage]);

  function toggleExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <section className="mb-8" data-testid="matched-section">
      <h2 className="mb-3 text-base font-bold text-text">กระทบยอดสำเร็จ</h2>
      {groups.length === 0 ? (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub"
          data-testid="matched-empty"
        >
          ไม่มีรายการที่กระทบยอดสำเร็จ
        </div>
      ) : (
        <>
          <div className="card-surface max-h-[32rem] overflow-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 z-10 bg-table-header">
                <tr>
                  <th rowSpan={2} className="w-10 px-3.5 py-2" aria-hidden="true" />
                  <th colSpan={3} className="px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub">
                    Bank Statement
                  </th>
                  <th colSpan={5} className="border-l border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub">
                    GL
                  </th>
                  <th rowSpan={2} className="px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub">
                    วิธีจับคู่
                  </th>
                </tr>
                <tr>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="border-l border-border px-3.5 py-2.5 text-left font-medium text-text-sub">เลขที่เอกสาร</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paged.map((group) => {
                  const isMulti = group.bankRows.length > 1 || group.glRows.length > 1;
                  const isExpanded = isMulti && expandedGroupIds.has(group.groupId);
                  const bankTotal = sumOf(group.bankRows);
                  const glTotal = sumOf(group.glRows);
                  const singleBank = group.bankRows.length === 1 ? group.bankRows[0] : null;
                  const singleGl = group.glRows.length === 1 ? group.glRows[0] : null;

                  return (
                    <Fragment key={group.groupId}>
                      <tr className="hover:bg-table-row-hover" data-testid={`matched-row-${group.groupId}`}>
                        <td className="px-3.5 py-2.5 text-center">
                          {isMulti && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(group.groupId)}
                              className="text-text-sub hover:text-text"
                              aria-label={isExpanded ? 'ย่อรายละเอียด' : 'ขยายรายละเอียด'}
                              data-testid={`matched-row-expand-${group.groupId}`}
                            >
                              {isExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                            </button>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-text-sub">
                          {singleBank ? formatDateDisplay(singleBank.date) : `${group.bankRows.length} รายการ`}
                        </td>
                        <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                          {group.type === 'receive' ? bankTotal.toLocaleString('th-TH', THB2) : '-'}
                        </td>
                        <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                          {group.type === 'payment' ? bankTotal.toLocaleString('th-TH', THB2) : '-'}
                        </td>
                        <td className="border-l border-border px-3.5 py-2.5 text-text-sub">
                          {singleGl ? singleGl.documentNo || '-' : `${group.glRows.length} รายการ`}
                        </td>
                        <td className="px-3.5 py-2.5 text-text-sub">{singleGl ? formatDateDisplay(singleGl.date) : '-'}</td>
                        <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                          {group.type === 'receive' ? glTotal.toLocaleString('th-TH', THB2) : '-'}
                        </td>
                        <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                          {group.type === 'payment' ? glTotal.toLocaleString('th-TH', THB2) : '-'}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">สำเร็จ</span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              group.matchType === 'auto' ? 'bg-primary-light text-primary' : 'bg-violet-500/20 text-violet-300'
                            }`}
                            data-testid={`matched-row-badge-${group.groupId}`}
                          >
                            {group.matchType === 'auto' ? 'จับคู่อัตโนมัติ' : 'จับคู่เอง'}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr data-testid={`matched-row-detail-${group.groupId}`}>
                          <td colSpan={10} className="bg-page-bg px-6 py-3">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <div>
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-sub">
                                  Bank Statement ({group.bankRows.length} รายการ)
                                </p>
                                <ul className="space-y-1 text-sm text-text-sub">
                                  {group.bankRows.map((row) => (
                                    <li key={row.id} className="flex justify-between gap-3">
                                      <span>{formatDateDisplay(row.date)}</span>
                                      <span className="font-numeric text-text">{row.amount.toLocaleString('th-TH', THB2)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-sub">
                                  GL ({group.glRows.length} รายการ)
                                </p>
                                <ul className="space-y-1 text-sm text-text-sub">
                                  {group.glRows.map((row) => (
                                    <li key={row.id} className="flex justify-between gap-3">
                                      <span>
                                        {row.documentNo || '-'} · {formatDateDisplay(row.date)}
                                      </span>
                                      <span className="font-numeric text-text">{row.amount.toLocaleString('th-TH', THB2)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix="matched"
            page={safePage}
            totalPages={totalPages}
            totalItems={groups.length}
            pageSize={PAGE_SIZE}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
          />
        </>
      )}
    </section>
  );
}
