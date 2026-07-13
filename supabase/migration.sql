-- BENZ — เว็บติดตามใบกำกับภาษีที่ยังไม่ได้รับ
-- Migration: สร้างตาราง pending_tax_invoices พร้อม RLS
-- รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP) ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent)

create extension if not exists "pgcrypto";

create table if not exists public.pending_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  transaction_date date not null,
  description text,
  amount_excl_vat numeric(14,2) not null check (amount_excl_vat >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  total_amount numeric(14,2) generated always as (amount_excl_vat + vat_amount) stored,
  reference_no text,
  expected_date date,
  status text not null default 'pending' check (status in ('pending', 'received', 'cancelled')),
  received_date date,
  tax_invoice_number text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_tax_invoices_status_idx on public.pending_tax_invoices (status);
create index if not exists pending_tax_invoices_expected_date_idx on public.pending_tax_invoices (expected_date);

-- updated_at trigger
-- (set search_path ตายตัวป้องกัน search_path hijacking — Supabase security advisor แนะนำ)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pending_tax_invoices_updated_at on public.pending_tax_invoices;
create trigger trg_pending_tax_invoices_updated_at
  before update on public.pending_tax_invoices
  for each row execute function public.set_updated_at();

-- Row Level Security: ทีมทุกคนที่ login แล้ว (authenticated) มีสิทธิ์เท่ากันในการอ่าน/เพิ่ม/แก้/ลบทุกแถว
-- ไม่มีสิทธิ์สำหรับ anon/public เลย ตามที่ตกลงกันไว้ (equal access ทุกคนในทีม)
alter table public.pending_tax_invoices enable row level security;

drop policy if exists "authenticated_select" on public.pending_tax_invoices;
create policy "authenticated_select" on public.pending_tax_invoices
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.pending_tax_invoices;
create policy "authenticated_insert" on public.pending_tax_invoices
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.pending_tax_invoices;
create policy "authenticated_update" on public.pending_tax_invoices
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.pending_tax_invoices;
create policy "authenticated_delete" on public.pending_tax_invoices
  for delete
  to authenticated
  using (true);
