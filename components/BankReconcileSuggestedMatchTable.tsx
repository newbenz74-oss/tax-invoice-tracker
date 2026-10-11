'use client';

import { Fragment, useMemo, useState } from 'react';
import { CheckCircle2, Sparkles, X } from 'lucide-react';
import BankReconcilePagination from './BankReconcilePagination';
import { formatThaiDate } from '@/lib/thaiDate';
import { MIN_COMBINATION_MEMBER_AMOUNT, type CombinationSuggestion } from '@/lib/bankReconcileCombinationMatch';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const DEFAULT_PAGE_SIZE = 20;

// ใช้ตัวจัดรูปแบบวันที่ตัวเดียวกับอีกสามตารางในหน้านี้ (แสดงปี พ.ศ. — ดูคอมเมนต์ formatThaiDate ใน lib/thaiDate.ts)
const formatDateDisplay = formatThaiDate;

function money(amount: number): string {
  return amount.toLocaleString('th-TH', THB2);
}

interface BankReconcileSuggestedMatchTableProps {
  suggestions: CombinationSuggestion[];
  /** true = ระบบหยุดค้นหาก่อนครบเพราะหมดงบประมาณการค้นหา (ดู lib/bankReconcileCombinationMatch.ts) */
  budgetExhausted: boolean;
  skippedAnchorCount: number;
  onAccept: (suggestion: CombinationSuggestion) => void;
  onDismiss: (suggestion: CombinationSuggestion) => void;
}

/**
 * SECTION 4 "จับคู่อัตโนมัติ (รอยืนยัน)" — เพิ่มเข้ามา 2026-10-10 ตามคำขอผู้ใช้
 *
 * หมวดนี้ไม่ใช่ผลลัพธ์ที่เกิดขึ้นแล้ว แต่เป็น "ข้อเสนอ" ที่ระบบเดาให้ว่าแถวเดี่ยวฝั่งหนึ่งน่าจะตรงกับหลายแถว
 * ฝั่งตรงข้ามรวมกัน (เช่น Bank 1,500 = GL 1,000 + 500) ทุกใบรอผู้ใช้กด "ยอมรับ" เองเท่านั้น กดแล้วจะกลายเป็น
 * กลุ่มที่กระทบยอดสำเร็จจริงและเด้งขึ้นไปอยู่ในหมวด "กระทบยอดสำเร็จ" ด้านบนทันที — กด "ไม่ใช่" แค่เลิกเสนอ
 * ใบนั้น ไม่กระทบแถวในตารางไหนเลย เพราะแถวที่ถูกเสนอยังอยู่ในตาราง "ไม่สำเร็จ" ตามปกติอยู่แล้วตลอดเวลา
 * (ตั้งใจออกแบบแบบนี้ เพื่อไม่ให้ผู้ใช้สับสนว่าแถวหายไปไหนระหว่างที่ยังไม่ได้ตัดสินใจ)
 *
 * ========================= รูปแบบตาราง (แก้ 2026-10-11 ตามที่ผู้ใช้วาด Excel มาให้ดู) =========================
 * 1 ข้อเสนอ = หลายแถว แถวละ 1 รายการ ไม่ใช่ย่อเป็นแถวเดียวแบบตาราง "กระทบยอดสำเร็จ"
 *
 * ของเดิมย่อทุกอย่างไว้ในแถวเดียวแล้วให้กดขยายดู ผู้ใช้สะท้อนว่า "ขาดข้อมูลยอดเงินฝั่ง Bank และขาดเลขที่
 * เอกสารฝั่ง GL เพื่อให้ตรวจสอบเองได้ง่ายกว่า" — ซึ่งตรงประเด็น เพราะหมวดนี้ต่างจากหมวด "กระทบยอดสำเร็จ"
 * ตรงที่ผู้ใช้ต้อง "ตรวจก่อนตัดสินใจ" ทุกใบ ไม่ใช่แค่ดูผ่านๆ ว่าจบแล้ว การบังคับให้กดขยายทีละใบจึงทำให้ช้า
 * กว่าเดิม ซึ่งสวนทางกับเหตุผลที่สร้างหมวดนี้ขึ้นมาตั้งแต่แรก
 *
 * ผลคือเลิกใช้ปุ่มย่อ/ขยายทั้งหมด (ไม่มี state expandedIds อีกแล้ว) และแยกช่อง "รับ/จ่าย" ของสองฝั่งออกจากกัน
 * เหมือนที่ผู้ใช้วาดมา — ฝั่งละ 4 ช่อง รวม 10 คอลัมน์ ช่อง "ห่างวันที่" กับ "ยืนยัน" ใช้ rowSpan คร่อมทุกแถว
 * ของข้อเสนอนั้น เพราะเป็นค่าของทั้งกลุ่มไม่ใช่ของรายแถว
 */
export default function BankReconcileSuggestedMatchTable({
  suggestions,
  budgetExhausted,
  skippedAnchorCount,
  onAccept,
  onDismiss,
}: BankReconcileSuggestedMatchTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(suggestions.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => suggestions.slice((safePage - 1) * pageSize, safePage * pageSize),
    [suggestions, safePage, pageSize]
  );

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(1);
  }

  // ยอดรวมของข้อเสนอที่แสดงอยู่ในหน้านี้ (ไม่ใช่ทุกหน้า) — กติกาเดียวกับอีกสามตาราง "ผลรวมของตารางใครตารางมัน"
  // แยกสองฝั่งเพราะตารางนี้มีช่องรับ/จ่ายของ Bank และของ GL คนละชุด (ยอดต้องเท่ากันเสมอตามกติกาการเสนอ —
  // ถ้าสองฝั่งไม่เท่ากันแปลว่ามีบั๊ก จึงเป็นจุดตรวจสายตาที่มีประโยชน์ไปในตัว)
  const pageTotals = useMemo(() => {
    let bankReceive = 0;
    let bankPayment = 0;
    let glReceive = 0;
    let glPayment = 0;
    for (const item of paged) {
      for (const row of item.bankRows) {
        if (row.type === 'receive') bankReceive += row.amount;
        else bankPayment += row.amount;
      }
      for (const row of item.glRows) {
        if (row.type === 'receive') glReceive += row.amount;
        else glPayment += row.amount;
      }
    }
    return { bankReceive, bankPayment, glReceive, glPayment };
  }, [paged]);

  return (
    <section className="mb-8" data-testid="suggested-section">
      <div className="mb-3">
        <h2 className="flex items-center gap-1.5 text-base font-bold text-text">
          <Sparkles size={16} className="text-primary" aria-hidden="true" />
          จับคู่อัตโนมัติ (รอยืนยัน)
          <span className="font-numeric text-sm font-semibold text-text-sub" data-testid="suggested-count">
            {suggestions.length.toLocaleString('th-TH')} รายการ
          </span>
        </h2>
        <p className="mt-1 max-w-4xl text-xs text-text-sub">
          ระบบคาดเดาให้ว่ารายการเดี่ยวฝั่งหนึ่งน่าจะตรงกับหลายรายการฝั่งตรงข้ามรวมกัน (เช่น Bank 1,500 เท่ากับ GL
          1,000 + 500) ยอดรวมต้องเท่ากันเป๊ะ วันที่ต้องอยู่ในช่วงที่เลือกไว้ และไม่นำรายการที่ต่ำกว่า{' '}
          {MIN_COMBINATION_MEMBER_AMOUNT.toLocaleString('th-TH')} บาทมารวม — ทุกรายการรอให้คุณกด &quot;ยอมรับ&quot;
          เองเท่านั้น ระบบไม่จับคู่ให้เองโดยพลการ
        </p>
      </div>

      {/* แจ้งตรงๆ เมื่อระบบค้นไม่ครบ — การหาคู่ผสมเป็นปัญหาที่ใหญ่แบบ exponential จึงมีเพดานเวลาไว้กันหน้าค้าง
          ไม่บอกผู้ใช้ก็ได้ แต่จะทำให้เข้าใจผิดว่า "ระบบหาแล้วไม่มี" ซึ่งไม่จริง (ดู budgetExhausted ใน lib) */}
      {budgetExhausted && (
        <div
          className="card-surface mb-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-text"
          data-testid="suggested-budget-note"
        >
          ข้อมูลรอบนี้มีรายการค้างเยอะ ระบบจึงหยุดค้นหาคู่ผสมก่อนจะครบทุกรายการ (ข้ามไป{' '}
          {skippedAnchorCount.toLocaleString('th-TH')} รายการ) เพื่อไม่ให้หน้าค้าง — อาจยังมีคู่ผสมที่ระบบหาไม่เจอ
          หากต้องการจับคู่รายการที่เหลือ ใช้วิธีติ๊กเลือกจับคู่เองในสองตารางด้านบนได้ตามปกติ
        </div>
      )}

      {suggestions.length === 0 ? (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub"
          data-testid="suggested-empty"
        >
          ไม่มีคู่ผสมที่ระบบคาดเดาให้ได้จากรายการที่เหลือ
        </div>
      ) : (
        <>
          <div className="card-surface max-h-[36rem] overflow-auto overscroll-contain rounded-2xl">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card-bg/95 backdrop-blur-sm">
                <tr>
                  <th
                    colSpan={4}
                    className="border-b border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub"
                  >
                    Bank Statement
                  </th>
                  <th
                    colSpan={4}
                    className="border-b border-l border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub"
                  >
                    GL
                  </th>
                  <th
                    rowSpan={2}
                    className="border-b border-l border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub"
                  >
                    ห่างวันที่
                  </th>
                  <th
                    rowSpan={2}
                    className="border-b border-border px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-sub"
                  >
                    ยืนยัน
                  </th>
                </tr>
                <tr>
                  <th className="border-b border-border px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                  <th className="border-b border-border px-3.5 py-2.5 text-left font-medium text-text-sub">รายการ</th>
                  <th className="border-b border-border px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="border-b border-border px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                  <th className="border-b border-l border-border px-3.5 py-2.5 text-left font-medium text-text-sub">
                    เลขที่เอกสาร
                  </th>
                  <th className="border-b border-border px-3.5 py-2.5 text-left font-medium text-text-sub">รายการ</th>
                  <th className="border-b border-border px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                  <th className="border-b border-border px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((item, itemIndex) => {
                  // 1 ข้อเสนอกินพื้นที่เท่ากับฝั่งที่มีรายการเยอะกว่า — อีกฝั่งที่สั้นกว่าปล่อยช่องว่างไว้
                  const lineCount = Math.max(item.bankRows.length, item.glRows.length);
                  const lines = Array.from({ length: lineCount }, (_, i) => i);
                  // แถบสีสลับ "ต่อข้อเสนอ" ไม่ใช่ต่อแถว เพื่อให้เห็นด้วยตาว่าแถวไหนเป็นก้อนเดียวกัน
                  const zebra = itemIndex % 2 === 1 ? 'bg-table-row-zebra' : '';

                  return (
                    <Fragment key={item.suggestionId}>
                      {lines.map((lineIndex) => {
                        const bankRow = item.bankRows[lineIndex];
                        const glRow = item.glRows[lineIndex];
                        const isFirst = lineIndex === 0;
                        // เส้นคั่นหนาเฉพาะแถวแรกของแต่ละข้อเสนอ (ยกเว้นใบแรกสุดของหน้า) — แทนการใช้กรอบ
                        // รอบก้อน ซึ่งทำกับ <table> ให้สวยยากและพังง่ายเวลา sticky header/footer
                        const topBorder = isFirst && itemIndex > 0 ? 'border-t-2 border-border' : '';

                        return (
                          <tr
                            key={`${item.suggestionId}-${lineIndex}`}
                            className={`${zebra} ${topBorder} hover:bg-table-row-hover`}
                            data-testid={isFirst ? `suggested-row-${item.suggestionId}` : undefined}
                          >
                            <td className="whitespace-nowrap px-3.5 py-2 align-top text-text-sub">
                              {bankRow ? formatDateDisplay(bankRow.date) : ''}
                            </td>
                            <td className="px-3.5 py-2 align-top text-text-sub">{bankRow?.description ?? ''}</td>
                            <td className="font-numeric whitespace-nowrap px-3.5 py-2 text-right align-top text-text">
                              {bankRow && bankRow.type === 'receive' ? money(bankRow.amount) : ''}
                            </td>
                            <td className="font-numeric whitespace-nowrap px-3.5 py-2 text-right align-top text-text">
                              {bankRow && bankRow.type === 'payment' ? money(bankRow.amount) : ''}
                            </td>
                            <td className="whitespace-nowrap border-l border-border px-3.5 py-2 align-top text-text-sub">
                              {glRow ? glRow.documentNo || '-' : ''}
                            </td>
                            <td className="px-3.5 py-2 align-top text-text-sub">{glRow?.description ?? ''}</td>
                            <td className="font-numeric whitespace-nowrap px-3.5 py-2 text-right align-top text-text">
                              {glRow && glRow.type === 'receive' ? money(glRow.amount) : ''}
                            </td>
                            <td className="font-numeric whitespace-nowrap px-3.5 py-2 text-right align-top text-text">
                              {glRow && glRow.type === 'payment' ? money(glRow.amount) : ''}
                            </td>

                            {/* สองช่องสุดท้ายเป็นค่าของทั้งกลุ่ม ไม่ใช่ของรายแถว จึง rowSpan คร่อมทุกแถวของข้อเสนอ */}
                            {isFirst && (
                              <>
                                <td
                                  rowSpan={lineCount}
                                  className="whitespace-nowrap border-l border-border px-3.5 py-2 align-top"
                                >
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                      item.dateSpread === 0 ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                                    }`}
                                  >
                                    {item.dateSpread === 0
                                      ? 'วันเดียวกัน'
                                      : `±${item.dateSpread.toLocaleString('th-TH')} วัน`}
                                  </span>
                                </td>
                                <td rowSpan={lineCount} className="px-3.5 py-2 align-top">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => onAccept(item)}
                                      className="btn-press flex shrink-0 items-center gap-1 rounded-[10px] bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
                                      data-testid={`suggested-accept-${item.suggestionId}`}
                                    >
                                      <CheckCircle2 size={14} aria-hidden="true" />
                                      ยอมรับ
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onDismiss(item)}
                                      className="btn-press flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20"
                                      data-testid={`suggested-dismiss-${item.suggestionId}`}
                                    >
                                      <X size={14} aria-hidden="true" />
                                      ไม่ใช่
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              {/* แถวสรุป sticky ติดขอบล่าง พร้อมพื้นหลัง bg-card-bg ทึบ 100% — เหตุผลเดียวกับอีกสามตารางในหน้านี้
                  (พื้นหลังโปร่งใสทำให้ข้อความแถวที่เลื่อนผ่านด้านหลังทะลุมาปนกับตัวเลขสรุป) */}
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-primary bg-card-bg shadow-[0_-4px_8px_rgba(0,0,0,0.25)]">
                <tr>
                  <td colSpan={2} className="px-3.5 py-2.5 text-sm font-bold text-text">
                    รวมหน้านี้ ({paged.length.toLocaleString('th-TH')} จาก {suggestions.length.toLocaleString('th-TH')}{' '}
                    รายการ)
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="suggested-total-bank-receive"
                  >
                    {money(pageTotals.bankReceive)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="suggested-total-bank-payment"
                  >
                    {money(pageTotals.bankPayment)}
                  </td>
                  <td colSpan={2} className="border-l border-border px-3.5 py-2.5" />
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="suggested-total-gl-receive"
                  >
                    {money(pageTotals.glReceive)}
                  </td>
                  <td
                    className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                    data-testid="suggested-total-gl-payment"
                  >
                    {money(pageTotals.glPayment)}
                  </td>
                  <td colSpan={2} className="border-l border-border px-3.5 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix="suggested"
            page={safePage}
            totalPages={totalPages}
            totalItems={suggestions.length}
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
