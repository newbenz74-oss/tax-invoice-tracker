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

function sumGroups(list: MatchGroup[]): { bankReceive: number; bankPayment: number; glReceive: number; glPayment: number } {
  let bankReceive = 0;
  let bankPayment = 0;
  let glReceive = 0;
  let glPayment = 0;
  for (const group of list) {
    const bankTotal = sumOf(group.bankRows);
    const glTotal = sumOf(group.glRows);
    if (group.type === 'receive') {
      bankReceive += bankTotal;
      glReceive += glTotal;
    } else {
      bankPayment += bankTotal;
      glPayment += glTotal;
    }
  }
  return { bankReceive, bankPayment, glReceive, glPayment };
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

  // ผลรวมรับ/จ่าย ทั้งฝั่ง Bank Statement และฝั่ง GL (เพิ่มเข้ามา 2026-08-05 ตามคำขอผู้ใช้ — จะเอาไปชนยอด
  // กับเอกสารจริง) แก้ไข 2026-08-06: เปลี่ยนจากคำนวณจาก "groups" ทั้งก้อนทุกหน้า มาเป็นคำนวณจาก "paged"
  // (เฉพาะกลุ่มที่แสดงอยู่ในตารางบนจอหน้าปัจจุบันเท่านั้น) ตามที่ผู้ใช้ยืนยันชัดเจนว่าต้องการ "ผลรวมของตาราง
  // ใครตารางมัน" — ถ้าตารางแสดงอะไรอยู่ ยอดสรุปก็ต้องรวมเฉพาะสิ่งที่แสดงอยู่นั้นเท่านั้น ไม่ใช่ข้อมูลทุกหน้า
  // ที่ยังไม่ได้เลื่อนไปดู — ฝั่ง Bank กับฝั่ง GL ของแต่ละ type (รับ/จ่าย) ต้องเท่ากันเสมอโดยธรรมชาติของข้อมูล
  // (ดู types/bankReconcileMatch.ts MatchGroup: "ผลรวม amount ของ bankRows ต้องเท่ากับผลรวม amount ของ
  // glRows เสมอ") แยกคำนวณทั้งสองฝั่งไว้ตรงๆ แทนที่จะสมมติว่าเท่ากันแล้วโชว์ค่าเดียว เพื่อให้เป็นการยืนยันซ้ำ
  // ในตัวว่าข้อมูลไม่ได้ผิดเพี้ยนไปจากที่ควรจะเป็น (ถ้าตัวเลขสองฝั่งต่างกันขึ้นมาจะเป็นสัญญาณว่ามีบัคที่อื่น)
  const totals = useMemo(() => sumGroups(paged), [paged]);

  // ยอดรวม "ทุกหน้ารวมกัน" (เพิ่มกลับมา 2026-08-06 ตามคำขอผู้ใช้ — อยากได้ทั้งสองบรรทัด: ยอดรวมเฉพาะหน้านี้
  // ที่มีอยู่แล้วด้านบน กับยอดรวมทั้งหมดทุกหน้าอีกบรรทัดแยกต่างหาก ไม่ใช่แทนที่กัน) คำนวณจาก "groups" ทั้งก้อน
  const allPagesTotals = useMemo(() => sumGroups(groups), [groups]);

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
              <thead className="sticky top-0 z-10 bg-card-bg/90 backdrop-blur-sm">
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
              {/* รอบแก้ไขที่ 2 (2026-08-05) — ผู้ใช้ยืนยันว่ายังอยากให้แถวสรุปนี้ sticky ติดขอบล่างเวลาเลื่อนดู
                  (ไม่อยากให้ "จมหายไป" ต้องเลื่อนสุดตารางถึงจะเห็น) รอบแรกที่ลอง sticky แล้วถอดออกไปเพราะแถว
                  ข้อมูลจริงแถวสุดท้าย "ทับซ้อน" กับแถวสรุปนี้ระหว่างเลื่อน — ต้นเหตุจริงๆ ไม่ใช่ sticky เอง แต่
                  เป็นเพราะพื้นหลัง bg-primary-light โปร่งใส (18% opacity ตาม --primary-light ใน globals.css)
                  ทำให้ข้อความของแถวที่เลื่อนผ่านด้านหลังทะลุขึ้นมาปนกับตัวเลขสรุป กลับมาใช้ sticky อีกครั้งแต่
                  เปลี่ยนพื้นหลังเป็น bg-card-bg ทึบเต็ม 100% แทน (สีเดียวกับพื้นการ์ดทั่วทั้งแอป ไม่มีความโปร่งใส
                  เลย — ต่างจาก sticky header ด้านบนที่ใช้ bg-card-bg/90 backdrop-blur-sm ได้เพราะตั้งใจให้เอฟเฟกต์
                  กระจกฝ้าเบลอสิ่งที่อยู่ข้างหลัง แต่แถวสรุปตัวเลขต้องการความคมชัด 100% ไม่ใช่เอฟเฟกต์ blur) พร้อม
                  เส้นขอบบนหนาสีฟ้าแยกจากแถวข้อมูลให้ชัดเจนขึ้นว่านี่คือแถวสรุป ไม่ใช่แถวข้อมูลตามปกติ */}
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-primary bg-card-bg shadow-[0_-4px_8px_rgba(0,0,0,0.25)]">
                <tr>
                  <td colSpan={2} className="px-3.5 py-2.5 text-sm font-bold text-text">
                    {/* แก้ไข 2026-08-06 — เปลี่ยนจากยอดรวม "ทุกหน้า" กลับมาเป็นยอดรวมเฉพาะกลุ่มที่แสดงอยู่ใน
                        ตารางบนจอ ณ ขณะนี้เท่านั้น (paged.length กลุ่ม) เปลี่ยนหน้าแล้วเลขนี้จะเปลี่ยนตาม */}
                    รวมหน้านี้ ({paged.length.toLocaleString('th-TH')} จาก {groups.length.toLocaleString('th-TH')} รายการ)
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="matched-total-bank-receive"
                  >
                    {totals.bankReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="matched-total-bank-payment"
                  >
                    {totals.bankPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td className="border-l border-border px-3.5 py-2.5" />
                  <td className="px-3.5 py-2.5" />
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="matched-total-gl-receive"
                  >
                    {totals.glReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="matched-total-gl-payment"
                  >
                    {totals.glPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td colSpan={2} className="px-3.5 py-2.5" />
                </tr>
                {/* บรรทัดที่ 2 ของแถวสรุป (เพิ่มกลับมา 2026-08-06) — ยอดรวมทั้งหมดทุกหน้า แยกไว้อีกบรรทัด
                    ต่างจากบรรทัดบนที่เป็นยอดรวมเฉพาะหน้านี้ — ใช้เส้นคั่นบางๆ กับสีตัวอักษรที่รองกว่าเพื่อไม่ให้
                    สับสนว่าเป็นยอดเดียวกัน */}
                <tr className="border-t border-border/60">
                  <td colSpan={2} className="px-3.5 py-2 text-xs font-semibold text-text-sub">
                    รวมทั้งหมดทุกหน้า ({groups.length.toLocaleString('th-TH')} รายการ)
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid="matched-total-all-bank-receive"
                  >
                    {allPagesTotals.bankReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid="matched-total-all-bank-payment"
                  >
                    {allPagesTotals.bankPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td className="border-l border-border px-3.5 py-2" />
                  <td className="px-3.5 py-2" />
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid="matched-total-all-gl-receive"
                  >
                    {allPagesTotals.glReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid="matched-total-all-gl-payment"
                  >
                    {allPagesTotals.glPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td colSpan={2} className="px-3.5 py-2" />
                </tr>
              </tfoot>
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
