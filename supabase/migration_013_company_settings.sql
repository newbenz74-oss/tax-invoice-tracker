-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 013: เพิ่มข้อมูลบริษัท (ที่อยู่ เลขผู้เสียภาษี สำนักงานใหญ่/สาขา ชื่อผู้ลงนามเริ่มต้น)
--
-- เพิ่มเข้ามาเป็นพื้นฐานของฟีเจอร์ "ออกใบหัก ณ ที่จ่าย" — ข้อมูลเหล่านี้คือฝั่ง "ผู้มีหน้าที่หักภาษี ณ ที่จ่าย"
-- (ผู้จ่ายเงิน = บริษัทของผู้ใช้เอง) บนแบบฟอร์มหนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ กรอกครั้งเดียว
-- ที่หน้า "ตั้งค่าบริษัท" แล้วใช้ซ้ำได้ทุกครั้งที่ออกใบ ไม่ต้องกรอกใหม่ทุกครั้ง
--
-- โครงสร้างที่อยู่ (address/subdistrict/district/province/postal_code) และ branch_type/branch_number
-- ใช้ชื่อ/รูปแบบเดียวกับตาราง business_partners (สมุดรายชื่อ, migration_004) เพื่อความสอดคล้องกันทั้งระบบ —
-- บริษัทของผู้ใช้เองถือเป็นนิติบุคคลเสมอ (ไม่มีแนวคิด "บุคคลธรรมดา" สำหรับ companies) จึงไม่มีคอลัมน์
-- entity_type แบบ business_partners
alter table public.companies
  add column tax_id text,
  add column branch_type text not null default 'head_office' check (branch_type in ('head_office', 'branch')),
  add column branch_number text,
  add column address text,
  add column subdistrict text,
  add column district text,
  add column province text,
  add column postal_code text,
  -- ชื่อผู้ลงนามเริ่มต้นตอนออกใบหัก ณ ที่จ่าย (เช่น "SAKKARIN" ในตัวอย่างที่ผู้ใช้ส่งมา) — แก้ไขได้ทุกครั้ง
  -- ตอนออกใบจริง ค่านี้เป็นแค่ค่าเริ่มต้นเพื่อไม่ต้องพิมพ์ซ้ำทุกครั้ง
  add column default_signer_name text;

alter table public.companies
  add constraint companies_tax_id_format check (tax_id is null or tax_id ~ '^\d{13}$'),
  add constraint companies_postal_code_format check (postal_code is null or postal_code ~ '^\d{5}$'),
  add constraint companies_branch_number_format
    check (branch_type = 'head_office' or (branch_number is not null and branch_number ~ '^\d{5}$'));

comment on column public.companies.tax_id is 'เลขประจำตัวผู้เสียภาษีของบริษัท (13 หลัก) — ฝั่งผู้จ่ายเงินบนใบหัก ณ ที่จ่าย';
comment on column public.companies.default_signer_name is 'ชื่อผู้ลงนามเริ่มต้นตอนออกใบหัก ณ ที่จ่าย แก้ไขได้ทุกครั้งตอนออกใบจริง';

-- เดิม companies มีแค่ policy select_own_company (SELECT) กับ insert_own_company (INSERT) เท่านั้น ยังไม่เคย
-- มีใครแก้ไขข้อมูลบริษัทได้เลย — เพิ่ม UPDATE policy ให้สมาชิกบริษัททุกคนแก้ไขข้อมูลบริษัทของตัวเองได้ (ไม่ใช่
-- แค่แอดมิน) สอดคล้องกับปรัชญาการออกแบบทั้งระบบที่สมาชิกทุกคนมีสิทธิ์เท่ากัน (ต่างจากเมนู "อนุมัติสมาชิกใหม่"
-- ที่จำกัดเฉพาะแอดมินเพราะเป็นเรื่องสิทธิ์เข้าใช้งาน ไม่ใช่ข้อมูลบริษัททั่วไป) ใช้ is_company_member() เดียวกับ
-- ที่ select_member_companies ใช้อยู่แล้ว
create policy "update_member_companies" on public.companies
  for update
  using (public.is_company_member(id))
  with check (public.is_company_member(id));
