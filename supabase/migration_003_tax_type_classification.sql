-- BENZ — เว็บติดตามใบกำกับภาษีที่ยังไม่ได้รับ
-- Migration 003: เพิ่มการจำแนกประเภทภาษี (tax_type) ให้ "บันทึกค่าใช้จ่าย"
-- เพิ่มคอลัมน์ใหม่ 1 คอลัมน์เข้า pending_tax_invoices ที่มีอยู่แล้วเท่านั้น เป็น nullable ไม่มีค่า default
-- และไม่ backfill ข้อมูลเดิมเลยโดยเจตนา (แถวเก่าจะมีค่าเป็น NULL จนกว่าผู้ใช้จะแก้ไขรายการนั้นเอง)
-- เพื่อไม่เดา/ไม่เขียนทับประเภทภาษีของข้อมูลเก่าตามที่ตกลงกันไว้ — แถวที่ tax_type เป็น NULL จะแสดง
-- เป็น "รอตรวจสอบประเภทภาษี" ในตาราง และยังคงทำงาน/แสดงผลในรายงานภาษีซื้อได้เหมือนก่อนมีฟีเจอร์นี้ทุก
-- ประการ (ดู lib/vatReportLogic.ts filterPurchaseTaxReport — ปฏิบัติกับ tax_type ที่เป็น NULL เหมือน
-- claimable_vat เพื่อไม่ให้รายการเก่าที่เคยแสดงอยู่แล้วหายไปจากรายงาน)
-- ปลอดภัยที่จะรันซ้ำ (idempotent) — รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP)

alter table public.pending_tax_invoices
  add column if not exists tax_type text;

alter table public.pending_tax_invoices
  drop constraint if exists pending_tax_invoices_tax_type_check;
alter table public.pending_tax_invoices
  add constraint pending_tax_invoices_tax_type_check
  check (tax_type is null or tax_type in ('no_vat', 'claimable_vat', 'non_claimable_vat'));

-- index สำหรับกรอง/แสดงผลตามประเภทภาษี (จะยิ่งมีประโยชน์มากขึ้นเมื่อข้อมูลมากขึ้นเรื่อยๆ)
create index if not exists pending_tax_invoices_tax_type_idx
  on public.pending_tax_invoices (tax_type);

-- ไม่ต้องแก้ RLS policy ใดๆ — policy เดิมใช้ USING(true)/WITH CHECK(true) ครอบคลุมทุกคอลัมน์ในตาราง
-- อยู่แล้ว (ทีมทุกคนที่ login แล้วมีสิทธิ์เท่ากัน) คอลัมน์ใหม่จึงเข้าถึงได้ทันทีโดยไม่ต้องเพิ่ม policy
