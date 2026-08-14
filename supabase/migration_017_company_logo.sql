-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 017: โลโก้บริษัท (อัปโหลดเองจากหน้า "ตั้งค่าบริษัท" — ตัดพื้นหลังสีขาวออกฝั่ง client ก่อนอัปโหลด
-- ด้วย lib/logoBackgroundRemoval.ts แล้วค่อยเก็บเป็น PNG โปร่งใสจริง ไม่ได้ตัดพื้นหลังที่ฐานข้อมูล/storage)
--
-- หมายเหตุ: นี่คือการใช้งาน Supabase Storage ครั้งแรกจริงของระบบ (เดิมมี migration ชื่อ create_payment_storage
-- จากช่วงแรกๆ ของโปรเจกต์ แต่ตรวจสอบแล้วไม่มี bucket หลงเหลืออยู่จริงในฐานข้อมูลปัจจุบัน — select จาก
-- storage.buckets คืนค่าว่างเปล่า จึงไม่มี pattern เดิมให้อ้างอิง เขียนใหม่ทั้งหมดตรงนี้)

/* ============================== 1. คอลัมน์ logo_url บนตาราง companies ============================== */
alter table public.companies add column if not exists logo_url text;
comment on column public.companies.logo_url is
  'URL สาธารณะของโลโก้บริษัท (พื้นหลังโปร่งใส PNG) — เก็บใน storage bucket "company-logos" path {company_id}/logo.png ว่างได้ถ้ายังไม่ได้อัปโหลด';

/* ============================== 2. bucket "company-logos" (public — โลโก้ไม่ใช่ข้อมูลอ่อนไหว ใช้ public URL
   แสดงตรงๆ ใน <img> ได้เลยไม่ต้องขอ signed URL ทุกครั้งที่โหลดหน้า Header/เลือกบริษัท) ============ */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152, array['image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png'];

/* ============================== 3. RLS: storage.objects เฉพาะ bucket นี้ ==============================
   path convention: {company_id}/logo.png — ใช้ storage.foldername(name) ตัวแรกเทียบกับ is_company_member()
   เดียวกับที่ตาราง companies/pending_tax_invoices ฯลฯ ใช้อยู่แล้ว (migration_007) ไม่ต้องสร้างฟังก์ชันใหม่
   อ่านสาธารณะ (public bucket) ไม่ต้องมี select policy ก็เข้าถึงผ่าน public URL ได้อยู่แล้ว แต่ใส่ไว้ด้วยเพื่อให้
   client ที่ล็อกอินอยู่ list/select ผ่าน SDK ตามปกติได้เช่นกัน ไม่ต้องพึ่ง public URL เพียงทางเดียว */
drop policy if exists "company_logos_select" on storage.objects;
create policy "company_logos_select" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'company-logos' and public.is_company_member((storage.foldername(name))[1]::uuid));

drop policy if exists "company_logos_insert" on storage.objects;
create policy "company_logos_insert" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'company-logos' and public.is_company_member((storage.foldername(name))[1]::uuid));

drop policy if exists "company_logos_update" on storage.objects;
create policy "company_logos_update" on storage.objects
  for update
  to authenticated
  using (bucket_id = 'company-logos' and public.is_company_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'company-logos' and public.is_company_member((storage.foldername(name))[1]::uuid));

drop policy if exists "company_logos_delete" on storage.objects;
create policy "company_logos_delete" on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'company-logos' and public.is_company_member((storage.foldername(name))[1]::uuid));
