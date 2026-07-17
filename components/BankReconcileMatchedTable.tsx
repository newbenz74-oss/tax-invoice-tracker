'use client';

import { useMemo, useState } from 'react';
import type { MatchedPair } from '@/types/bankReconcile';
import BankReconcilePagination from './BankReconcilePagination';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const PAGE_SIZE = 20;

function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function amountCell(amount: number, rowType: 'receive' | 'payment', column: 'receive' | 'payment'): string {
  return rowType === column ? amount.toLocaleString('th-TH', THB2) : '-';
}

interface BankReconcileMatchedTableProps {
  pairs: MatchedPair[];
}

/** SECTION 1 "กระทบยอดสำเร็จ" — Bank Statement ทางซ้าย, GL ทางขวา ในตารางเดียวกัน 1 แถว = 1 คู่ที่จับคู่
 * สำเร็จ ตามตัวอย่าง layout ในสเปกเป๊ะๆ (หัวตาราง 2 แถว: แถวบนแบ่งกลุ่ม Bank Statement/GL, แถวล่างเป็นชื่อ
 * คอลัมน์จริง มีเส้นแบ่งตรงกลางให้เห็นชัดว่าฝั่งไหนเป็นข้อมูลจากไฟล์ไหน) */
export default function BankReconcileMatchedTable({ pairs }: BankReconcileMatchedTableProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(pairs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => pairs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [pairs, safePage]);

  return (
    <section className="mb-8" data-testid="matched-section">
      <h2 className="mb-3 text-base font-bold text-text">กระทบยอดสำเร็จ</h2>
      {pairs.length === 0 ? (
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
                  <th colSpan={3} className="px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub">
                    Bank Statement
                  </th>
                  <th colSpan={5} className="border-l border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub">
                    GL
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
                {paged.map((pair) => (
                  <tr key={`${pair.bank.id}-${pair.gl.id}`} className="hover:bg-table-row-hover" data-testid={`matched-row-${pair.bank.id}`}>
                    <td className="px-3.5 py-2.5 text-text-sub">{formatDateDisplay(pair.bank.date)}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {amountCell(pair.bank.amount, pair.bank.type, 'receive')}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {amountCell(pair.bank.amount, pair.bank.type, 'payment')}
                    </td>
                    <td className="border-l border-border px-3.5 py-2.5 text-text-sub">{pair.gl.documentNo || '-'}</td>
                    <td className="px-3.5 py-2.5 text-text-sub">{formatDateDisplay(pair.gl.date)}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {amountCell(pair.gl.amount, pair.gl.type, 'receive')}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                      {amountCell(pair.gl.amount, pair.gl.type, 'payment')}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">สำเร็จ</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix="matched"
            page={safePage}
            totalPages={totalPages}
            totalItems={pairs.length}
            pageSize={PAGE_SIZE}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
          />
        </>
      )}
    </section>
  );
}
