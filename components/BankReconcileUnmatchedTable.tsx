'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import BankReconcilePagination from './BankReconcilePagination';
import { buildUnmatchedTableExcelBlob } from '@/lib/bankReconcileHistoryExport';
import { downloadBlob } from '@/lib/reportExport';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const DEFAULT_PAGE_SIZE = 20;

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
  /** คำอธิบายรายการ (เพิ่มเข้ามา 2026-08-07) — มีเฉพาะฝั่ง GL เท่านั้น (BankTransaction ไม่มีฟิลด์นี้) ใช้
   * คู่กับ prop showDescription ด้านล่าง */
  description?: string;
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
  /** แสดงคอลัมน์ "คำอธิบาย" ต่อจากคอลัมน์เลขที่เอกสาร (เพิ่มเข้ามา 2026-08-07 ตามคำขอผู้ใช้ — เฉพาะตาราง
   * "GL ไม่สำเร็จ" เท่านั้น) ดึงค่าจาก row.description ตรงๆ (มาจากคอลัมน์ "คำอธิบาย"/description ของไฟล์ GL
   * ต้นฉบับ — ดู lib/bankReconcileParse.ts) แถวที่ไฟล์ต้นฉบับไม่มีคอลัมน์นี้เลยจะแสดง "-" แทน */
  showDescription?: boolean;
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
  showDescription = false,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: BankReconcileUnmatchedTableProps) {
  const [page, setPage] = useState(1);
  // จำนวนรายการต่อหน้า (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้ — เลือกได้ 10/20/30/40/50 ต่อหน้า ไม่เลือกก็ใช้
  // ค่าเดิมปกติ 20 เหมือนก่อนหน้านี้) เปลี่ยนจาก PAGE_SIZE ค่าคงที่มาเป็น state ในนี้ — component นี้ถูก mount
  // แยก 2 instance (Bank Statement ไม่สำเร็จ / GL ไม่สำเร็จ) จึงมี state pageSize เป็นอิสระต่อกันเองอยู่แล้ว
  // โดยธรรมชาติของ React (คนละ instance คนละ state) ไม่ต้องทำอะไรเพิ่มเพื่อแยกสองตารางนี้ออกจากกัน
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => rows.slice((safePage - 1) * pageSize, safePage * pageSize), [rows, safePage, pageSize]);

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(1);
  }

  // ผลรวมรับ/จ่าย ของทั้งตารางนี้ (เพิ่มเข้ามา 2026-08-05 ตามคำขอผู้ใช้ — จะเอาไปชนยอดกับเอกสารจริง) คำนวณ
  // จาก "rows" ทั้งก้อน (ทุกหน้า ไม่ใช่แค่ paged ที่กำลังแสดงอยู่หน้าปัจจุบัน) เพราะเป้าหมายคือยอดรวมของทั้ง
  // ตารางนี้ทั้งหมด ไม่ใช่แค่หน้าที่กำลังเปิดดู — component เดียวกันนี้ใช้ซ้ำทั้ง "Bank Statement ไม่สำเร็จ"
  // และ "GL ไม่สำเร็จ" จึงคำนวณแยกอิสระของ rows ที่ส่งเข้ามาแต่ละครั้งเท่านั้น ไม่ปนกันข้าม instance */
  // ยอดรวม "ทุกแถวในตารางนี้ทุกหน้า" — ใช้เฉพาะตอน export Excel เท่านั้น (ไฟล์ export มีข้อมูลครบทุกแถวเสมอ
  // ไม่ผูกกับหน้าที่กำลังเปิดดูอยู่บนจอ) ไม่ได้ใช้แสดงในแถวสรุปท้ายตารางบนจอแล้ว (ดู pageTotals ด้านล่าง)
  const allRowsTotals = useMemo(() => {
    let totalReceive = 0;
    let totalPayment = 0;
    for (const row of rows) {
      if (row.type === 'receive') totalReceive += row.amount;
      else totalPayment += row.amount;
    }
    return { totalReceive, totalPayment };
  }, [rows]);

  // ยอดรวม "เฉพาะแถวที่แสดงอยู่ในตารางบนจอตอนนี้" (แก้ไข 2026-08-06 ตามที่ผู้ใช้ยืนยันชัดเจนว่า "ผลรวมของ
  // ตารางใครตารางมัน" — ถ้าตารางกำลังแสดงแถวรับรวม 800,000 แถวสรุปก็ต้องขึ้น 800,000 ไม่ใช่ยอดรวมข้ามหน้าอื่น
  // ที่มองไม่เห็น) คำนวณจาก "paged" (เฉพาะหน้าปัจจุบัน) เท่านั้น — เปลี่ยนหน้าแล้วยอดนี้จะเปลี่ยนตามไปด้วยโดย
  // ตั้งใจ เพราะ "ตาราง" ในความหมายของผู้ใช้คือสิ่งที่มองเห็นอยู่จริง ไม่ใช่ข้อมูลทั้งก้อนที่ยังไม่ได้เลื่อนไปดู
  const pageTotals = useMemo(() => {
    let totalReceive = 0;
    let totalPayment = 0;
    for (const row of paged) {
      if (row.type === 'receive') totalReceive += row.amount;
      else totalPayment += row.amount;
    }
    return { totalReceive, totalPayment };
  }, [paged]);

  // ปุ่ม "Export Excel" (เพิ่มเข้ามา 2026-08-05 ตามคำขอผู้ใช้ — ต้องการยืนยันได้ด้วยตัวเองว่ายอดรวมมาจาก
  // แถวในตารางนี้เท่านั้นจริงๆ) ไฟล์ที่ export รวมแถวทุกหน้า (allRowsTotals) เพราะเป็นไฟล์แยกต่างหากที่ตั้งใจ
  // ให้ครบทุกรายการไว้ตรวจสอบ ไม่ใช่ยอดที่ต้องตรงกับแถวสรุปบนจอ ณ ขณะนั้น (ซึ่งตอนนี้เป็นยอดเฉพาะหน้าแล้ว)
  function handleExportExcel() {
    const blob = buildUnmatchedTableExcelBlob(rows, allRowsTotals, title, showDocumentNo, showDescription);
    downloadBlob(blob, `${title}.xlsx`);
  }

  return (
    <section className="mb-8" data-testid={`${testId}-section`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-text">{title}</h2>
        <button
          type="button"
          onClick={handleExportExcel}
          disabled={rows.length === 0}
          className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3 py-1.5 text-xs font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`${testId}-export-excel`}
        >
          <FileSpreadsheet size={14} aria-hidden="true" />
          Export Excel
        </button>
      </div>
      {rows.length === 0 ? (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub"
          data-testid={`${testId}-empty`}
        >
          <p>{emptyText}</p>
          {/* ยืนยันกฎที่ผู้ใช้ระบุไว้อย่างชัดเจน (2026-08-05): "ถ้ามีการจับคู่จนครบ ยอดจะเหลือ 0" — โชว์ 0.00
              ตรงๆ แทนที่จะซ่อนแถวสรุปไปเฉยๆ ตอนตารางว่าง เพื่อให้เห็นภาพว่ายอดรวมวิ่งไปจนถึง 0 จริงเมื่อจับคู่
              ครบทุกแถวแล้ว (ไม่ใช่แค่ทฤษฎี) — data-testid เดียวกับตอนตารางไม่ว่างด้านล่าง เพราะแสดงความหมาย
              เดียวกัน (ยอดรวมรับ/จ่ายของตารางนี้ ณ ขณะนี้) แค่คนละสถานะของ UI */}
          <p className="mt-2 font-numeric font-semibold text-success">
            รวม 0 รายการ — ยอดรวมรับ{' '}
            <span data-testid={`${testId}-total-receive`}>{(0).toLocaleString('th-TH', THB2)}</span> · ยอดรวมจ่าย{' '}
            <span data-testid={`${testId}-total-payment`}>{(0).toLocaleString('th-TH', THB2)}</span>
          </p>
        </div>
      ) : (
        <>
          {/* overscroll-contain (2026-08-17 ตามคำขอผู้ใช้) — กัน scroll ไหลทะลุออกไปเลื่อนหน้าเว็บต่อ
              (scroll chaining) ตอนเลื่อนถึงขอบบน/ล่างของกล่องตารางนี้แล้ว ต้องเอาเมาส์ออกจากตารางก่อนถึงจะ
              เลื่อนหน้าเว็บต่อได้ */}
          <div className="card-surface max-h-[28rem] overflow-auto overscroll-contain rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 z-10 bg-card-bg/90 backdrop-blur-sm">
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
                  {showDescription && <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">คำอธิบาย</th>}
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {/* ดับเบิ้ลคลิกที่แถว = ติ๊ก/ยกเลิกติ๊กเหมือนคลิก checkbox โดยตรง (เพิ่มเข้ามา 2026-08-17
                    ตามคำขอผู้ใช้ — เดิมต้องเล็งคลิก checkbox แคบๆ ในคอลัมน์แรกเท่านั้น) เรียก onToggleRow
                    ตัวเดียวกับ checkbox เป๊ะๆ ไม่มี logic แยก จึงยังทำงานถูกต้องกับ selectedIds/onToggleAll/
                    toolbar ยืนยันจับคู่ในไฟล์ BankReconcileWorkspace.tsx เหมือนเดิมทุกประการ ไม่ต้องแก้ที่อื่น */}
                {paged.map((row) => (
                  <tr
                    key={row.id}
                    onDoubleClick={() => onToggleRow(row.id)}
                    className={`cursor-pointer select-none hover:bg-table-row-hover ${selectedIds.has(row.id) ? 'bg-primary-light/40' : ''}`}
                    title="ดับเบิ้ลคลิกเพื่อติ๊กเลือกแถวนี้"
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
                    {showDescription && <td className="px-3.5 py-2.5 text-text-sub">{row.description || '-'}</td>}
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
              {/* รอบแก้ไขที่ 2 (2026-08-05) — เหตุผลเดียวกับ BankReconcileMatchedTable.tsx: กลับมา sticky
                  bottom-0 อีกครั้งตามที่ผู้ใช้ขอ (ไม่อยากให้แถวสรุป "จมหายไป" ต้องเลื่อนสุดตารางถึงจะเห็น) แต่
                  เปลี่ยนพื้นหลังจาก bg-primary-light (โปร่งใส 18%) เป็น bg-card-bg ทึบเต็ม 100% แทน — ต้นเหตุจริง
                  ของปัญหา "ทับซ้อน" ที่เจอในรอบแรกคือพื้นหลังโปร่งใสปล่อยให้ข้อความแถวข้อมูลที่เลื่อนผ่านด้านหลัง
                  ทะลุขึ้นมาปนกัน ไม่ใช่ตัว sticky เอง */}
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-primary bg-card-bg shadow-[0_-4px_8px_rgba(0,0,0,0.25)]">
                <tr>
                  <td className="px-3.5 py-2.5" />
                  <td className="px-3.5 py-2.5 text-sm font-bold text-text">
                    {/* แก้ไข 2026-08-06 — เปลี่ยนจากยอดรวม "ทุกหน้า" กลับมาเป็นยอดรวมเฉพาะแถวที่แสดงอยู่ในตาราง
                        บนจอ ณ ขณะนี้เท่านั้น (paged.length แถว) ตามที่ผู้ใช้ยืนยันชัดเจนว่าต้องการ "ผลรวมของ
                        ตารางใครตารางมัน" — เปลี่ยนหน้าแล้วเลขนี้จะเปลี่ยนตาม ตั้งใจให้เป็นแบบนั้น */}
                    รวมหน้านี้ ({paged.length.toLocaleString('th-TH')} จาก {rows.length.toLocaleString('th-TH')} รายการ)
                  </td>
                  {showDocumentNo && <td className="px-3.5 py-2.5" />}
                  {showDescription && <td className="px-3.5 py-2.5" />}
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid={`${testId}-total-receive`}
                  >
                    {pageTotals.totalReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid={`${testId}-total-payment`}
                  >
                    {pageTotals.totalPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td className="px-3.5 py-2.5" />
                </tr>
                {/* บรรทัดที่ 2 ของแถวสรุป (เพิ่มกลับมา 2026-08-06 เพื่อความสม่ำเสมอกับ BankReconcileMatchedTable.tsx)
                    ยอดรวมทั้งหมดทุกหน้า แยกไว้อีกบรรทัดต่างหากจากยอดรวมเฉพาะหน้านี้ด้านบน */}
                <tr className="border-t border-border/60">
                  <td className="px-3.5 py-2" />
                  <td className="px-3.5 py-2 text-xs font-semibold text-text-sub">
                    รวมทั้งหมดทุกหน้า ({rows.length.toLocaleString('th-TH')} รายการ)
                  </td>
                  {showDocumentNo && <td className="px-3.5 py-2" />}
                  {showDescription && <td className="px-3.5 py-2" />}
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid={`${testId}-total-all-receive`}
                  >
                    {allRowsTotals.totalReceive.toLocaleString('th-TH', THB2)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2 text-right text-xs font-semibold text-text-sub"
                    data-testid={`${testId}-total-all-payment`}
                  >
                    {allRowsTotals.totalPayment.toLocaleString('th-TH', THB2)}
                  </td>
                  <td className="px-3.5 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix={testId}
            page={safePage}
            totalPages={totalPages}
            totalItems={rows.length}
            pageSize={pageSize}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
    </section>
  );
}
