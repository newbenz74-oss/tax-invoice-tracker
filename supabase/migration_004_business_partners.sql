-- BENZ — เว็บติดตามใบกำกับภาษีที่ยังไม่ได้รับ
-- Migration 004: สร้างตาราง business_partners (สมุดรายชื่อ — Master Data ลูกค้า/ผู้จัดจำหน่าย)
-- เป็นตารางใหม่ทั้งหมด ไม่แก้ไข/ไม่ลบตารางเดิม (pending_tax_invoices, payment_storage) หรือ column
-- ใดๆ ในตารางเดิมเลยแม้แต่คอลัมน์เดียว ปลอดภัยที่จะรันซ้ำ (idempotent)
-- รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP) ครั้งเดียว

create table if not exists public.business_partners (
  id uuid primary key default gen_random_uuid(),

  -- ลูกค้า / ผู้จัดจำหน่าย
  partner_type text not null check (partner_type in ('customer', 'vendor')),

  -- รหัส เช่น CUS0001 (ลูกค้า) / VEN0001 (ผู้จัดจำหน่าย) — สร้างให้อัตโนมัติแบบเรียงลำดับใน
  -- lib/contactLogic.ts แต่ผู้ใช้แก้ไขเองก่อนบันทึกได้ ต้องไม่ซ้ำกันทั้งระบบ (unique ด้านล่าง)
  -- normalize เป็นตัวพิมพ์ใหญ่เสมอก่อนบันทึก (ดู lib/contactLogic.ts normalizeContactCode) เพื่อไม่ให้
  -- "cus0001" กับ "CUS0001" ถือเป็นคนละรหัสกัน
  contact_code text not null,

  -- บุคคลธรรมดา / นิติบุคคล — กำหนดว่าฟิลด์ชื่อกลุ่มไหนบังคับกรอก (ดู constraint ด้านล่าง)
  entity_type text not null check (entity_type in ('individual', 'company')),

  company_name text,
  first_name text,
  last_name text,

  -- เลขประจำตัวผู้เสียภาษี — ไม่บังคับกรอก แต่ถ้ากรอกมาต้องเป็นตัวเลข 13 หลัก (ตรวจที่ชั้น
  -- lib/contactLogic.ts เหมือน vendor_tax_id ของ pending_tax_invoices ไม่ตรวจรูปแบบที่ชั้นฐานข้อมูล)
  tax_id text,

  -- สำนักงานใหญ่ / สาขาที่ — default เป็นสำนักงานใหญ่เสมอ (กรณีส่วนใหญ่) ถ้าเลือก "สาขาที่" ต้องกรอก
  -- เลขสาขา (branch_number) ด้วย — บังคับที่ชั้นฐานข้อมูลด้วย constraint ด้านล่าง
  branch_type text not null default 'head_office' check (branch_type in ('head_office', 'branch')),
  branch_number text,

  address text,
  subdistrict text,
  district text,
  province text,
  postal_code text,
  phone text,
  email text,
  contact_person text,
  note text,

  status text not null default 'active' check (status in ('active', 'inactive')),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ชื่อบริษัทบังคับกรอกถ้าเป็นนิติบุคคล / ชื่อ+นามสกุลบังคับกรอกถ้าเป็นบุคคลธรรมดา
  constraint business_partners_entity_name_check check (
    (entity_type = 'company' and company_name is not null and length(trim(company_name)) > 0)
    or
    (entity_type = 'individual' and first_name is not null and length(trim(first_name)) > 0
      and last_name is not null and length(trim(last_name)) > 0)
  ),

  -- เลือก "สาขาที่" ต้องกรอกเลขสาขาด้วยเสมอ (สำนักงานใหญ่ไม่บังคับ)
  constraint business_partners_branch_check check (
    branch_type = 'head_office'
    or (branch_type = 'branch' and branch_number is not null and length(trim(branch_number)) > 0)
  )
);

-- รหัสห้ามซ้ำกันทั้งระบบ (ไม่แยกตามประเภท — ลูกค้ากับผู้จัดจำหน่ายใช้ namespace เดียวกัน เพราะ prefix
-- CUS/VEN ต่างกันอยู่แล้วโดยธรรมชาติของการสร้างรหัส แต่ผู้ใช้แก้ไขเองได้จึงยังต้องกันซ้ำแบบ global)
alter table public.business_partners
  drop constraint if exists business_partners_contact_code_key;
alter table public.business_partners
  add constraint business_partners_contact_code_key unique (contact_code);

create index if not exists business_partners_partner_type_idx on public.business_partners (partner_type);
create index if not exists business_partners_status_idx on public.business_partners (status);

-- updated_at trigger — ใช้ฟังก์ชัน public.set_updated_at() เดิมที่มีอยู่แล้ว (สร้างไว้ตั้งแต่
-- migration.sql แรกสุด) ไม่ต้องสร้างฟังก์ชันใหม่ซ้ำ
drop trigger if exists trg_business_partners_updated_at on public.business_partners;
create trigger trg_business_partners_updated_at
  before update on public.business_partners
  for each row execute function public.set_updated_at();

-- Row Level Security: ทีมทุกคนที่ login แล้ว (authenticated) มีสิทธิ์เท่ากันในการอ่าน/เพิ่ม/แก้/ลบทุกแถว
-- ไม่มีสิทธิ์สำหรับ anon/public เลย — รูปแบบเดียวกับ pending_tax_invoices ทุกประการ
alter table public.business_partners enable row level security;

drop policy if exists "authenticated_select" on public.business_partners;
create policy "authenticated_select" on public.business_partners
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.business_partners;
create policy "authenticated_insert" on public.business_partners
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.business_partners;
create policy "authenticated_update" on public.business_partners
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.business_partners;
create policy "authenticated_delete" on public.business_partners
  for delete
  to authenticated
  using (true);
