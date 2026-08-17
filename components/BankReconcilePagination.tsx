'use client';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

interface BankReconcilePaginationProps {
  testIdPrefix: string;
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  /** ตัวเลือก "แสดงผลกี่รายการต่อหน้า" (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้ — "อยากให้มีปุ่มเลือกจำนวนการ
   * แสดงผลในตาราง 10/20/30/40/50 ทุกตาราง") — เป็น prop เสริม (optional) ไม่ใส่มาก็ยังทำงานได้ปกติเหมือนเดิม
   * ทุกประการ (ไม่ render dropdown นี้เลย) เพื่อไม่ให้กระทบจุดอื่นที่อาจยังไม่ทันอัปเดตมาส่ง prop นี้ — ผู้เรียก
   * เป็นเจ้าของ state pageSize เอง (ไม่ได้ยึดอยู่ใน component นี้) และต้องรีเซ็ต page กลับเป็น 1 เองตอนเปลี่ยน
   * ค่า (ดู handlePageSizeChange ในแต่ละตารางที่เรียกใช้) */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

/** แถบ pagination ที่ใช้ร่วมกันในทั้ง 3 ตารางของหน้ากระทบยอด Bank Reconcile — ดีไซน์/testid pattern
 * เดียวกับ pagination ในหน้า "บันทึกค่าใช้จ่าย" (app/dashboard/page.tsx) ทุกประการ ต่างกันแค่ testId
 * prefix เพื่อแยกแต่ละตารางออกจากกัน (เพราะหน้านี้มี 3 ตารางพร้อมกัน) */
export default function BankReconcilePagination({
  testIdPrefix,
  page,
  totalPages,
  totalItems,
  pageSize,
  onPrev,
  onNext,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: BankReconcilePaginationProps) {
  if (totalItems === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3" data-testid={`${testIdPrefix}-pagination`}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-text-sub">
          แสดง {from}–{to} จาก {totalItems} รายการ
        </p>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-text-sub">
            แสดง
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-[8px] border border-border bg-white/8 px-2 py-1 text-xs text-text focus:outline-none"
              data-testid={`${testIdPrefix}-page-size`}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            รายการ/หน้า
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrev}
          // แก้ไข 2026-08-07 — เดิมใช้ bg-white (สีขาวทึบ) ร่วมกับ text-text (สีตัวอักษร #f1f5f9 เกือบขาว
          // ตามธีมมืดของแอป) ทำให้ตัวหนังสือ "มองไม่เห็นเลย" เพราะเป็นสีขาวบนพื้นขาว — เปลี่ยนเป็น bg-white/8
          // (ขาวโปร่งแสง 8%) + hover:bg-white/15 ให้เข้ากับพื้นหลังเข้มของธีม เหมือนปุ่ม "Export Excel" ที่ใช้
          // สีชุดเดียวกันนี้อยู่แล้วในตารางอื่นของหน้านี้
          className="btn-press rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`${testIdPrefix}-pagination-prev`}
        >
          ก่อนหน้า
        </button>
        <span className="text-xs text-text-sub" data-testid={`${testIdPrefix}-pagination-page-indicator`}>
          หน้า {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={onNext}
          // แก้ไข 2026-08-07 — เดิมใช้ bg-white (สีขาวทึบ) ร่วมกับ text-text (สีตัวอักษร #f1f5f9 เกือบขาว
          // ตามธีมมืดของแอป) ทำให้ตัวหนังสือ "มองไม่เห็นเลย" เพราะเป็นสีขาวบนพื้นขาว — เปลี่ยนเป็น bg-white/8
          // (ขาวโปร่งแสง 8%) + hover:bg-white/15 ให้เข้ากับพื้นหลังเข้มของธีม เหมือนปุ่ม "Export Excel" ที่ใช้
          // สีชุดเดียวกันนี้อยู่แล้วในตารางอื่นของหน้านี้
          className="btn-press rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`${testIdPrefix}-pagination-next`}
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}
