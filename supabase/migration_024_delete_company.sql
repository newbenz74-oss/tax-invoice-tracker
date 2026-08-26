-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 024: รองรับฟีเจอร์ "ลบบริษัท" ในหน้าตั้งค่าบริษัท (2026-08-18 ตามคำขอผู้ใช้)
--
-- companies ไม่เคยมี DELETE policy เลยตั้งแต่แรก (migration_007 ตั้งใจเปิดแค่ SELECT, migration_013 เพิ่ม
-- UPDATE ให้สมาชิกทุกคนแก้ไขข้อมูลบริษัทได้) — เพิ่ม DELETE policy เข้ามาตอนนี้ ใช้ is_company_member() เดียวกับ
-- ทุก policy อื่นของ companies (ไม่มี role/สิทธิ์แยกระดับ สมาชิกบริษัทคนไหนก็ลบบริษัทของตัวเองได้เหมือนกันหมด
-- ตามปรัชญาการออกแบบทั้งระบบ — ความปลอดภัยจากการลบพลาดอยู่ที่ชั้น UI แทน คือต้องพิมพ์คำว่า "confirm" ก่อนถึงจะ
-- กดยืนยันลบได้ ดู components/CompanySettingsPage.tsx)
--
-- ตาราง company-scoped อื่นๆ ทั้งหมดมี FK ไปที่ companies(id) พร้อม "on delete cascade" อยู่แล้วตั้งแต่ตอน
-- สร้าง ยกเว้น 3 ตารางนี้ที่เพิ่ม company_id เข้ามาทีหลังผ่าน "alter table ... add column" เฉยๆ ใน
-- migration_007 (ไม่ได้ระบุ on delete ไว้ ค่าเริ่มต้นคือ NO ACTION — ลบบริษัทที่มีข้อมูลเหล่านี้อยู่จะติด foreign
-- key violation ทันที): pending_tax_invoices, business_partners, bank_reconcile_reports (ตารางลูกของ
-- bank_reconcile_reports เอง คือ match_groups/bank_rows/gl_rows มี on delete cascade ผ่าน report_id อยู่แล้ว
-- ตั้งแต่ migration_006 ไม่ต้องแก้เพิ่ม) — แก้ทั้ง 3 ให้ on delete cascade เหมือนตารางอื่นให้ครบ เพื่อให้ลบแถว
-- companies แถวเดียวแล้วข้อมูลทั้งหมดของบริษัทนั้นหายไปพร้อมกันแบบ atomic ในคำสั่งเดียว ไม่ต้องมี RPC พิเศษคอย
-- ลบทีละตารางเอง (ยืนยันชื่อ constraint จริงจากฐานข้อมูลก่อนเขียนไฟล์นี้แล้ว — เป็นชื่อ default ของ Postgres
-- "{table}_{column}_fkey" ทั้ง 3 ตัว)
--
-- หมายเหตุ: ไฟล์โลโก้บริษัทใน storage bucket "company-logos" (migration_017) ไม่ได้ลบอัตโนมัติจาก FK cascade
-- นี้ (Postgres FK cascade ไม่รู้จัก Supabase Storage) — ฝั่ง client ต้องเรียก removeCompanyLogo() ก่อนเรียก
-- ลบบริษัทเสมอถ้ามีโลโก้อยู่ (ดู lib/companyApi.ts deleteCompany())

alter table public.pending_tax_invoices
  drop constraint pending_tax_invoices_company_id_fkey,
  add constraint pending_tax_invoices_company_id_fkey
    foreign key (company_id) references public.companies (id) on delete cascade;

alter table public.business_partners
  drop constraint business_partners_company_id_fkey,
  add constraint business_partners_company_id_fkey
    foreign key (company_id) references public.companies (id) on delete cascade;

alter table public.bank_reconcile_reports
  drop constraint bank_reconcile_reports_company_id_fkey,
  add constraint bank_reconcile_reports_company_id_fkey
    foreign key (company_id) references public.companies (id) on delete cascade;

drop policy if exists "delete_member_companies" on public.companies;
create policy "delete_member_companies" on public.companies
  for delete
  using (public.is_company_member(id));
