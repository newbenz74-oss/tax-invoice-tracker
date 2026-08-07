'use client';

interface BankReconcilePaginationProps {
  testIdPrefix: string;
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
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
}: BankReconcilePaginationProps) {
  if (totalItems === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="mt-3 flex items-center justify-between gap-3" data-testid={`${testIdPrefix}-pagination`}>
      <p className="text-xs text-text-sub">
        แสดง {from}–{to} จาก {totalItems} รายการ
      </p>
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
