-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 012: เพิ่มยอด "หัก ณ ที่จ่าย" (WHT) ในรายการบันทึกการจ่ายเงิน
--
-- ผู้ใช้ระบุว่าบางรายการจ่ายเงินจะมีการหัก ณ ที่จ่าย บางรายการไม่มี ถ้าไม่กรอกตัวเลขให้ถือว่าไม่มียอดหักไปเลย
-- (ค่าเริ่มต้น 0 ไม่ใช่ null — กรอกยอดเงินตรงๆ ไม่มีตัวเลือกอัตรา % ตามที่ผู้ใช้ยืนยัน)
--
-- total_amount เป็น generated column (amount_excl_vat + vat_amount) แก้ให้รวม WHT เข้าไปด้วยไม่ได้ (และไม่ควร
-- เพราะ total_amount ยังต้องคงความหมายเดิมคือ "ยอดรวมตามใบกำกับภาษี" ไว้สำหรับรายงานภาษีซื้อ) จึงเพิ่มเป็น
-- คอลัมน์แยกต่างหาก ส่วน "ยอดจ่ายสุทธิ" (total_amount - wht_amount) คำนวณฝั่ง frontend เท่านั้น (ดู
-- lib/invoiceLogic.ts calcNetPayment) ไม่เก็บเป็นคอลัมน์ในฐานข้อมูล
alter table public.pending_tax_invoices
  add column wht_amount numeric(14,2) not null default 0 check (wht_amount >= 0);

comment on column public.pending_tax_invoices.wht_amount is
  'ยอดหัก ณ ที่จ่าย (บาท) — ไม่บังคับกรอก ค่าเริ่มต้น 0 หมายถึงไม่มีการหัก ณ ที่จ่ายสำหรับรายการนี้';
