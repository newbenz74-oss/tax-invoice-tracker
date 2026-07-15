-- BENZ — เว็บติดตามใบกำกับภาษีที่ยังไม่ได้รับ
-- Migration 002: เพิ่ม field รองรับ "รายงานภาษีซื้อ" (VAT Reconcile)
-- เพิ่มคอลัมน์ใหม่ 4 คอลัมน์เข้า pending_tax_invoices ที่มีอยู่แล้วเท่านั้น — ทุกคอลัมน์เป็น nullable
-- จึงไม่กระทบข้อมูลเดิม/แถวเดิมเลย (แถวเก่าจะมีค่าเป็น NULL ในคอลัมน์ใหม่จนกว่าจะแก้ไข)
-- ปลอดภัยที่จะรันซ้ำ (idempotent) — รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP)

-- เลขประจำตัวผู้เสียภาษีของผู้ขาย (13 หลัก) — กรอกตอนเพิ่ม/แก้ไขรายการ (ไม่บังคับ เพื่อไม่กระทบ
-- validation เดิมของฟอร์มและไม่ต้องย้อนกรอกข้อมูลเก่า) ใช้แสดงในรายงานภาษีซื้อ
alter table public.pending_tax_invoices
  add column if not exists vendor_tax_id text;

-- วันที่พิมพ์อยู่บนใบกำกับภาษีจริง (คนละค่ากับ received_date ที่มีอยู่แล้วซึ่งหมายถึงวันที่บริษัท
-- ได้รับเอกสาร — สองวันที่นี้อาจไม่ตรงกัน เช่น ใบกำกับภาษีลงวันที่ 28/06 แต่บริษัทได้รับเอกสารจริง 05/07)
-- กรอกตอนกดปุ่ม "ได้รับแล้ว"
alter table public.pending_tax_invoices
  add column if not exists tax_invoice_date date;

-- เดือน/ปีที่บริษัทนำใบกำกับภาษีนี้ไปใช้ยื่น ภ.พ.30 (อาจไม่ใช่เดือนเดียวกับ tax_invoice_date หรือ
-- received_date) — ใช้เป็นตัวกรองหลักของรายงานภาษีซื้อ ปีเก็บเป็น พ.ศ. ตรงกับที่แสดงใน dropdown
alter table public.pending_tax_invoices
  add column if not exists vat_claim_month smallint;

alter table public.pending_tax_invoices
  add column if not exists vat_claim_year smallint;

-- ลบ constraint เดิมก่อนสร้างใหม่ (เผื่อรันซ้ำ) แล้วค่อยเพิ่ม check ให้ครบ — แยกคำสั่งเพื่อให้
-- rerun ได้ปลอดภัยแม้ constraint จะยังไม่เคยถูกสร้างมาก่อนในบางสภาพแวดล้อม
alter table public.pending_tax_invoices
  drop constraint if exists pending_tax_invoices_vat_claim_month_check;
alter table public.pending_tax_invoices
  add constraint pending_tax_invoices_vat_claim_month_check
  check (vat_claim_month is null or (vat_claim_month >= 1 and vat_claim_month <= 12));

alter table public.pending_tax_invoices
  drop constraint if exists pending_tax_invoices_vat_claim_year_check;
alter table public.pending_tax_invoices
  add constraint pending_tax_invoices_vat_claim_year_check
  check (vat_claim_year is null or (vat_claim_year >= 2500 and vat_claim_year <= 2700));

-- index สำหรับ filter รายงานภาษีซื้อตามเดือน/ปีเครดิต VAT (ใช้บ่อยในหน้ารายงาน)
create index if not exists pending_tax_invoices_vat_claim_idx
  on public.pending_tax_invoices (vat_claim_year, vat_claim_month);

-- ไม่ต้องแก้ RLS policy ใดๆ — policy เดิมใช้ USING(true)/WITH CHECK(true) ครอบคลุมทุกคอลัมน์ในตาราง
-- อยู่แล้ว (ทีมทุกคนที่ login แล้วมีสิทธิ์เท่ากัน) คอลัมน์ใหม่จึงเข้าถึงได้ทันทีโดยไม่ต้องเพิ่ม policy
