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
 * แปลงรูปแบบก่อน — ตั้งใจไม่รวม documentNo ไว้ในนี้ เพราะสเปกระบุชัดว่าตาราง "GL ไม่สำเร็จ" ไม่แสดง
 * เลขที่เอกสาร (ต่างจากตาราง "กระทบยอดสำเร็จ" ที่แสดง) */
export interface UnmatchedRowInput {
  id: string;
  date: string;
  type: 'receive' | 'payment';
  amount: number;
}

interface BankReconcileUnmatchedTableProps {
  title: string;
  testId: string;
  statusText: string;
  emptyText: string;
  rows: UnmatchedRowInput[];
}

/** SECTION 2 "Bank Statement ไม่สำเร็จ" และ SECTION 3 "GL ไม่สำเร็จ" ใช้ตารางหน้าตาเดียวกันทุกประการ
 * (คอลัมน์: วันที่ / รับ / จ่าย / สถานะ เท่านั้น — ไม่มีคอลัมน์ของอีกฝั่งปนอยู่เลยตามสเปก) จึงรวมเป็น
 * component เดียว ใช้ซ้ำ 2 จุด ต่างกันแค่ title/testId/statusText/emptyText/ข้อมูลที่ส่งเข้ามา */
export default function BankReconcileUnmatchedTable({ title, testId, statusText, emptyText, rows }: BankReconcileUnmatchedTableProps) {
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
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paged.map((row) => (
                  <tr key={row.id} className="hover:bg-table-row-hover" data-testid={`${testId}-row-${row.id}`}>
                    <td className="px-3.5 py-2.5 text-text-sub">{formatDateDisplay(row.date)}</td>
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
