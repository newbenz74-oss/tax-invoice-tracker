'use client';

import { useMemo, useState } from 'react';
import BankReconcilePagination from './BankReconcilePagination';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const PAGE_SIZE = 20;

function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** รูปร่างแถวขั้นต่ำที่ตารางนี้ต้องใช้ — ทั้ง BankTransaction และ GLTransaction มีฟิลด์ครบตามนี้อยู่แล้ว
 * (โครงสร้างแบบ structural typing ของ TypeScript) จึงส่ง array ของ type ใดก็ได้เข้ามาตรงๆ โดยไม่ต้อง
 * แปลงรูปแบบก่อน — documentNo เป็น optional เพราะ BankTransaction ไม่มีฟิลด์นี้เลย (ใช้ได้เฉพาะฝั่ง GL
 * ผ่าน prop showDocumentNo ด้านล่าง) */
export interface UnmatchedRowInput {
  id: string;
  date: string;
  type: 'receive' | 'payment';
  amount: number;
  documentNo?: string;
}

interface BankReconcileUnmatchedTableProps {
  title: string;
  testId: string;
  statusText: string;
  emptyText: string;
  rows: UnmatchedRowInput[];
  /** แสดงคอลัมน์ "เลขที่เอกสาร" ต่อจากคอลัมน์วันที่ (ก่อนคอลัมน์รับ) หรือไม่ — เดิมสเปกระบุว่า Section 3
   * "GL ไม่สำเร็จ" ไม่แสดงเลขที่เอกสารเลย แต่ผู้ใช้ขอเพิ่มกลับมาเฉพาะฝั่งนี้ทีหลัง (2026-07-17) หลังทดสอบ
   * ใช้งานจริงแล้วพบว่าอยากรู้เลขที่เอกสาร/ใบสำคัญของแต่ละแถวเพื่อไปตามหาในโปรแกรมบัญชีต่อ — Section 2
   * "Bank Statement ไม่สำเร็จ" ยังคงไม่มีคอลัมน์นี้เหมือนเดิม (ไม่ส่ง prop นี้เข้ามาเลย ค่าเริ่มต้นคือ false) */
  showDocumentNo?: boolean;
  /** แถวที่ถูกติ๊กเลือกไว้อยู่ตอนนี้ (จับคู่เอง, เพิ่มเข้ามา 2026-07-19) — ควบคุมจาก parent
   * (BankReconcileWorkspace) ทั้งหมด ไม่เก็บ state ในตารางเอง เพราะต้องอยู่รอดข้าม pagination ของตารางนี้
   * และต้องให้ toolbar ยืนยันจับคู่ (ซึ่งอยู่นอกตารางนี้) เห็นค่าเดียวกันพร้อมกันเสมอ */
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  /** เรียกพร้อม id ของ "ทุกแถวใน rows" (ทุกหน้า ไม่ใช่แค่หน้าปัจจุบัน) เสมอ — parent เป็นผู้ตัดสินว่าจะ
   * เลือกทั้งหมดหรือยกเลิกทั้งหมด (สลับตามว่าตอนนี้เลือกครบทุกแถวอยู่แล้วหรือยัง) */
  onToggleAll: (ids: string[]) => void;
}

/** SECTION 2 "Bank Statement ไม่สำเร็จ" และ SECTION 3 "GL ไม่สำเร็จ" ใช้ตารางหน้าตาเดียวกันเป็นหลัก (คอลัมน์
 * วันที่ / รับ / จ่าย / สถานะ) จึงรวมเป็น component เดียว ใช้ซ้ำ 2 จุด ต่างกันแค่ title/testId/statusText/
 * emptyText/ข้อมูลที่ส่งเข้ามา และคอลัมน์เลขที่เอกสารที่แสดงเฉพาะฝั่ง GL เมื่อ showDocumentNo=true เท่านั้น
 *
 * คอลัมน์ checkbox (เพิ่มเข้ามา 2026-07-19 สำหรับฟีเจอร์จับคู่เอง) เป็น <th>/<td> จริง ไม่ใช่ trick อะไร —
 * e2e/bankReconcile.spec.ts มี assertion แบบ exact-array กับหัวตารางฝั่ง GL อยู่ 1 จุด ต้องอัปเดต expected
 * array ให้รวมคอลัมน์นี้ด้วย (ดูคอมเมนต์ที่บรรทัดนั้นในไฟล์เทสต์) ตั้งใจทำแบบนี้แทนการใช้ td role=columnheader
 * เพื่อให้ markup ถูกต้องตามความหมาย (semantic HTML) และไม่กระทบ accessibility ของหัวตารางจริง */
export default function BankReconcileUnmatchedTable({
  title,
  testId,
  statusText,
  emptyText,
  rows,
  showDocumentNo = false,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: BankReconcileUnmatchedTableProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [rows, safePage]);

  return (
    <section className="mb-8" data-testid={`${testId}-section`}>
      <h2 className="mb-3 text-base font-bold text-text">{title}</h2>
      {rows.length === 0 ? (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub"
          data-testid={`${testId}-empty`}
        >
          {emptyText}
        </div>
      ) : (
        <>
          <div className="card-surface max-h-[28rem] overflow-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 bg-table-header">
                <tr>
                  <th className="w-10 px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={rows.length > 0 && rows.every((row) => selectedIds.has(row.id))}
                      onChange={() => onToggleAll(rows.map((row) => row.id))}
                      aria-label={`เลือกทั้งหมดใน${title}`}
                      data-testid={`${testId}-select-all`}
                    />
                  </th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                  {showDocumentNo && <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">เลขที่เอกสาร</th>}
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paged.map((row) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-table-row-hover ${selectedIds.has(row.id) ? 'bg-primary-light/40' : ''}`}
                    data-testid={`${testId}-row-${row.id}`}
                  >
                    <td className="px-3.5 py-2.5">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selectedIds.has(row.id)}
                        onChange={() => onToggleRow(row.id)}
                        aria-label={`เลือกแถว ${formatDateDisplay(row.date)}`}
                        data-testid={`${testId}-row-select-${row.id}`}
                      />
                    </td>
                    <td className="px-3.5 py-2.5 text-text-sub">{formatDateDisplay(row.date)}</td>
                    {showDocumentNo && <td className="px-3.5 py-2.5 text-text-sub">{row.documentNo || '-'}</td>}
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {row.type === 'receive' ? row.amount.toLocaleString('th-TH', THB2) : '-'}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {row.type === 'payment' ? row.amount.toLocaleString('th-TH', THB2) : '-'}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">{statusText}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix={testId}
            page={safePage}
            totalPages={totalPages}
            totalItems={rows.length}
            pageSize={PAGE_SIZE}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
          />
        </>
      )}
    </section>
  );
}
