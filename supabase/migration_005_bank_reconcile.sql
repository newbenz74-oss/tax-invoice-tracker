-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration: Bank Reconcile — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูล Bank Reconcile ทั้งโมดูล
-- ตามสเปก "REBUILD Bank Reconcile module from scratch" — แก้ไขไฟล์เดิมในที่ (ไม่สร้างไฟล์ migration ใหม่)
-- เพราะ migration_005 เดิมยังไม่เคยถูก apply กับฐานข้อมูลจริงเลย (ยืนยันแล้วหลายครั้งตลอดโปรเจกต์นี้ — บัญชี
-- Supabase MCP ที่เชื่อมต่ออยู่ไม่มีสิทธิ์เข้าถึงฐานข้อมูลจริงของ BENZ) การแก้ไฟล์นี้ในที่จึงไม่มีความเสี่ยงต่อ
-- ข้อมูล production ใดๆ ทั้งสิ้น รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP) ครั้งเดียว
-- ปลอดภัยที่จะรันซ้ำ (idempotent)
--
-- ลดจาก 6 ตางรางเดิมเหลือ 3 ตาราง (ตามสเปกส่วน "21. DATABASE CLEANUP" — ตัดฟิลด์/ฟังก์ชันเฉพาะของโมเดลเดิม
-- ทิ้งเมื่อยืนยันแล้วว่าเป็นของ Bank Reconcile เท่านั้น):
--   1. bank_reconcile_sessions          — หัวรอบกระทบยอดหนึ่งรอบ + KPI ที่คำนวณไว้ ณ ตอนบันทึก
--   2. bank_reconcile_bank_transactions — แถว Bank Statement ที่บันทึกไว้ของแต่ละรอบ (รวมธงตรวจสอบในตัว)
--   3. bank_reconcile_gl_transactions   — แถว GL ที่บันทึกไว้ของแต่ละรอบ (รวมธงตรวจสอบในตัว)
--
-- ตัดออกจากโมเดลเดิมทั้งหมด (ไม่มีในสเปกใหม่เลยสักส่วน — ดู FINAL SUMMARY ตอนส่งมอบสำหรับเหตุผลเต็ม):
--   - bank_reconcile_match_groups / bank_reconcile_match_group_items — ไม่มีแนวคิด "กลุ่มจับคู่" อีกต่อไป
--     ผลกระทบยอดคำนวณสดจาก bankRows/glRows ทุกครั้งผ่าน runSimpleReconciliation() ไม่ถูกบันทึกแยกต่างหากเลย
--   - bank_reconcile_audit_logs — สเปกใหม่ไม่ได้ร้องขอ audit log ที่ใดเลย
--   - match_score/date_tolerance_days/amount_tolerance/manual_match/match_type/suggested_match ทุกฟิลด์ —
--     ไม่มีแนวคิดค่าคลาดเคลื่อน/การจับคู่ด้วยตนเองแบบกลุ่มในโมเดลใหม่เลย (จับคู่ด้วยทิศทาง+จำนวนเงินเท่านั้น)
--   - completion_note/reopened_by/reopened_by_email/reopened_at/reopen_reason — สถานะเหลือแค่ 2 ค่าเป็นป้าย
--     กำกับล้วนๆ ไม่มีกลไกล็อกการแก้ไข/ตรวจสอบเงื่อนไขก่อนปิดรอบอีกต่อไป (ดู types/bankReconcileSession.ts)
--
-- ไม่แก้ไขตารางเดิมของฟีเจอร์อื่นเลยแม้แต่คอลัมน์เดียว (pending_tax_invoices, business_partners, ...) ตาม
-- ข้อจำกัด "Do not modify Login, Authentication, Supabase Auth, VAT modules, Expense module, Contacts,
-- Sidebar, or unrelated routes" ของสเปก
--
-- ธรรมเนียมที่ยึดตามไฟล์ migration เดิมทุกไฟล์ในโปรเจกต์นี้ (migration.sql, migration_004_business_partners.sql):
--   - uuid primary key default gen_random_uuid()
--   - created_by/updated_by/... uuid references auth.users (id) on delete set null คู่กับ _email สำรอง
--   - RLS: ทีมทุกคนที่ login แล้ว (authenticated) มีสิทธิ์เท่ากันทุกแถว ไม่มีสิทธิ์ anon/public เลย
--   - reuse public.set_updated_at() ตัวเดิม (สร้างไว้แล้วใน migration.sql) ไม่สร้างซ้ำ

drop function if exists public.save_bank_reconcile_session(jsonb, jsonb, jsonb, jsonb, jsonb);
drop table if exists public.bank_reconcile_match_group_items;
drop table if exists public.bank_reconcile_match_groups;
drop table if exists public.bank_reconcile_audit_logs;
drop table if exists public.bank_reconcile_bank_transactions;
drop table if exists public.bank_reconcile_gl_transactions;
drop table if exists public.bank_reconcile_sessions;
-- หมายเหตุ: drop table ตัวเดิมทั้งหมดก่อนสร้างใหม่ตั้งใจ (ไม่ใช้ "create table if not exists" ทับของเดิมเฉยๆ)
-- เพราะโครงสร้างคอลัมน์เปลี่ยนไปมากจนไม่สามารถ alter ให้ตรงกันได้อย่างปลอดภัย — ปลอดภัยที่จะทำเช่นนี้เพราะ
-- ไฟล์นี้ยังไม่เคย apply กับฐานข้อมูลจริงเลยตามที่อธิบายไว้ข้างต้น (ไม่มีข้อมูลจริงอยู่ในตารางเหล่านี้ให้เสีย)

create extension if not exists "pgcrypto";

/* ============================== 1. bank_reconcile_sessions ============================== */
create table public.bank_reconcile_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null,
  bank_file_name text not null,
  gl_file_name text not null,
  bank_source_file_type text not null check (bank_source_file_type in ('excel', 'csv', 'pdf')),
  gl_source_file_type text not null check (gl_source_file_type in ('excel', 'csv', 'pdf')),
  bank_row_count integer not null default 0 check (bank_row_count >= 0),
  gl_row_count integer not null default 0 check (gl_row_count >= 0),
  found_count integer not null default 0 check (found_count >= 0),
  bank_not_found_count integer not null default 0 check (bank_not_found_count >= 0),
  gl_not_found_count integer not null default 0 check (gl_not_found_count >= 0),
  bank_income_total numeric(14, 2) not null default 0,
  bank_payment_total numeric(14, 2) not null default 0,
  gl_income_total numeric(14, 2) not null default 0,
  gl_payment_total numeric(14, 2) not null default 0,
  income_difference numeric(14, 2) not null default 0,
  payment_difference numeric(14, 2) not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  completed_by uuid references auth.users (id) on delete set null,
  completed_by_email text,
  completed_at timestamptz,
  deleted_at timestamptz
);

create index bank_reconcile_sessions_status_idx on public.bank_reconcile_sessions (status);
create index bank_reconcile_sessions_deleted_at_idx on public.bank_reconcile_sessions (deleted_at);
create index bank_reconcile_sessions_created_at_idx on public.bank_reconcile_sessions (created_at);

drop trigger if exists trg_bank_reconcile_sessions_updated_at on public.bank_reconcile_sessions;
create trigger trg_bank_reconcile_sessions_updated_at
  before update on public.bank_reconcile_sessions
  for each row execute function public.set_updated_at();

alter table public.bank_reconcile_sessions enable row level security;

create policy "authenticated_select" on public.bank_reconcile_sessions for select to authenticated using (true);
create policy "authenticated_insert" on public.bank_reconcile_sessions for insert to authenticated with check (true);
create policy "authenticated_update" on public.bank_reconcile_sessions for update to authenticated using (true) with check (true);
create policy "authenticated_delete" on public.bank_reconcile_sessions for delete to authenticated using (true);

/* ============================== 2. bank_reconcile_bank_transactions ============================== */
-- raw_row = แถวดิบจากไฟล์ต้นฉบับเป๊ะ (array ของค่าตามคอลัมน์เดิม) เก็บแยกจากค่าที่ normalize แล้วเสมอ ตามสเปก
-- ส่วน "23. IMPORTANT RULES" ("Preserve original imported values. Never overwrite raw data.") ธงตรวจสอบ
-- (needs_gl_entry/reviewed/review_note ตามสเปกส่วน "17. REVIEW WORKFLOW") เป็นคอลัมน์ตรงบนแถวนี้เลย ไม่แยก
-- ตารางลูกต่างหาก เพราะเป็นข้อมูล 1:1 กับแถว Bank เสมอ (ไม่มีความสัมพันธ์แบบหลายต่อหลายใดๆ ในโมเดลใหม่)
create table public.bank_reconcile_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  row_number integer not null,
  transaction_date date,
  description text not null default '',
  money_in numeric(14, 2) not null default 0,
  money_out numeric(14, 2) not null default 0,
  direction text check (direction in ('income', 'payment')),
  amount numeric(14, 2) not null default 0,
  balance numeric(14, 2),
  account_no text not null default '',
  raw_row jsonb not null default '[]'::jsonb,
  excluded boolean not null default false,
  row_errors jsonb not null default '[]'::jsonb,
  needs_gl_entry boolean not null default false,
  reviewed boolean not null default false,
  review_note text not null default '',
  created_at timestamptz not null default now()
);

create index bank_reconcile_bank_txn_session_id_idx on public.bank_reconcile_bank_transactions (session_id);
create index bank_reconcile_bank_txn_direction_amount_idx on public.bank_reconcile_bank_transactions (direction, amount);

alter table public.bank_reconcile_bank_transactions enable row level security;

create policy "authenticated_select" on public.bank_reconcile_bank_transactions for select to authenticated using (true);
create policy "authenticated_insert" on public.bank_reconcile_bank_transactions for insert to authenticated with check (true);
create policy "authenticated_update" on public.bank_reconcile_bank_transactions for update to authenticated using (true) with check (true);
create policy "authenticated_delete" on public.bank_reconcile_bank_transactions for delete to authenticated using (true);

/* ============================== 3. bank_reconcile_gl_transactions ============================== */
create table public.bank_reconcile_gl_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  row_number integer not null,
  transaction_date date,
  description text not null default '',
  money_in numeric(14, 2) not null default 0,
  money_out numeric(14, 2) not null default 0,
  direction text check (direction in ('income', 'payment')),
  amount numeric(14, 2) not null default 0,
  doc_no text not null default '',
  account_code text not null default '',
  raw_row jsonb not null default '[]'::jsonb,
  excluded boolean not null default false,
  row_errors jsonb not null default '[]'::jsonb,
  needs_gl_review boolean not null default false,
  reviewed boolean not null default false,
  review_note text not null default '',
  created_at timestamptz not null default now()
);

create index bank_reconcile_gl_txn_session_id_idx on public.bank_reconcile_gl_transactions (session_id);
create index bank_reconcile_gl_txn_direction_amount_idx on public.bank_reconcile_gl_transactions (direction, amount);

alter table public.bank_reconcile_gl_transactions enable row level security;

create policy "authenticated_select" on public.bank_reconcile_gl_transactions for select to authenticated using (true);
create policy "authenticated_insert" on public.bank_reconcile_gl_transactions for insert to authenticated with check (true);
create policy "authenticated_update" on public.bank_reconcile_gl_transactions for update to authenticated using (true) with check (true);
create policy "authenticated_delete" on public.bank_reconcile_gl_transactions for delete to authenticated using (true);

/* ============================== ฟังก์ชันบันทึกรอบกระทบยอดแบบ atomic ============================== */
-- เหตุผลเดียวกับโมเดลเดิม: Supabase JS client (PostgREST) ไม่รองรับ transaction ข้ามหลายตารางจากฝั่ง client
-- โดยตรง (แต่ละ .from() เป็นคนละ HTTP request) จึงรวมการเขียน session + Bank txns + GL txns ทั้งหมดไว้ใน
-- Postgres function เดียว เรียกผ่าน supabase.rpc(...) ครั้งเดียว (ดู lib/bankReconcileSessionApi.ts) รันในหนึ่ง
-- ธุรกรรมโดยธรรมชาติของ Postgres เสมอ — exception ใดๆ ระหว่างทางทำให้ทุกอย่างถูก rollback อัตโนมัติทั้งหมด
--
-- กลยุทธ์: "แทนที่ทั้งหมด" (full-snapshot replace) เสมอ — ลบ Bank/GL transactions เดิมของ session นั้นทั้งหมด
-- ก่อน (ถ้าเป็นการบันทึกทับ) แล้วแทรกชุดข้อมูลปัจจุบันทั้งหมดใหม่ ไม่ diff/upsert ทีละแถว เหตุผลเดียวกับโมเดล
-- เดิม (ข้อมูลในหน่วยความจำฝั่ง client เป็น "ภาพรวมล่าสุดที่ถูกต้องเสมอ" อยู่แล้ว) — id ของแถว Bank/GL ที่ส่งมา
-- จาก client ไม่ถูกใช้เลย ปล่อยให้ gen_random_uuid() default ของคอลัมน์สร้างให้ใหม่ทุกครั้งเสมอ (ต่างจากโมเดล
-- เดิมที่ต้องคง id เดิมไว้เพื่อให้ match_group_items อ้างอิงถูก — โมเดลใหม่ไม่มีตารางลูกแบบนั้นแล้ว จึงไม่จำเป็น
-- ต้องคง id เดิมอีกต่อไป ทำให้ฟังก์ชันนี้เรียบง่ายกว่าเดิมมาก)
create or replace function public.save_bank_reconcile_session(
  p_session jsonb,
  p_bank_transactions jsonb,
  p_gl_transactions jsonb
)
returns public.bank_reconcile_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_result public.bank_reconcile_sessions;
begin
  v_session_id := nullif(p_session ->> 'id', '')::uuid;

  if v_session_id is null then
    insert into public.bank_reconcile_sessions (
      session_name, bank_file_name, gl_file_name, bank_source_file_type, gl_source_file_type,
      bank_row_count, gl_row_count, found_count, bank_not_found_count, gl_not_found_count,
      bank_income_total, bank_payment_total, gl_income_total, gl_payment_total,
      income_difference, payment_difference, status,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
      p_session ->> 'session_name',
      p_session ->> 'bank_file_name',
      p_session ->> 'gl_file_name',
      p_session ->> 'bank_source_file_type',
      p_session ->> 'gl_source_file_type',
      (p_session ->> 'bank_row_count')::int,
      (p_session ->> 'gl_row_count')::int,
      (p_session ->> 'found_count')::int,
      (p_session ->> 'bank_not_found_count')::int,
      (p_session ->> 'gl_not_found_count')::int,
      (p_session ->> 'bank_income_total')::numeric,
      (p_session ->> 'bank_payment_total')::numeric,
      (p_session ->> 'gl_income_total')::numeric,
      (p_session ->> 'gl_payment_total')::numeric,
      (p_session ->> 'income_difference')::numeric,
      (p_session ->> 'payment_difference')::numeric,
      p_session ->> 'status',
      nullif(p_session ->> 'created_by', '')::uuid,
      p_session ->> 'created_by_email',
      nullif(p_session ->> 'updated_by', '')::uuid,
      p_session ->> 'updated_by_email'
    )
    returning id into v_session_id;
  else
    update public.bank_reconcile_sessions set
      session_name = p_session ->> 'session_name',
      bank_file_name = p_session ->> 'bank_file_name',
      gl_file_name = p_session ->> 'gl_file_name',
      bank_source_file_type = p_session ->> 'bank_source_file_type',
      gl_source_file_type = p_session ->> 'gl_source_file_type',
      bank_row_count = (p_session ->> 'bank_row_count')::int,
      gl_row_count = (p_session ->> 'gl_row_count')::int,
      found_count = (p_session ->> 'found_count')::int,
      bank_not_found_count = (p_session ->> 'bank_not_found_count')::int,
      gl_not_found_count = (p_session ->> 'gl_not_found_count')::int,
      bank_income_total = (p_session ->> 'bank_income_total')::numeric,
      bank_payment_total = (p_session ->> 'bank_payment_total')::numeric,
      gl_income_total = (p_session ->> 'gl_income_total')::numeric,
      gl_payment_total = (p_session ->> 'gl_payment_total')::numeric,
      income_difference = (p_session ->> 'income_difference')::numeric,
      payment_difference = (p_session ->> 'payment_difference')::numeric,
      status = p_session ->> 'status',
      updated_by = nullif(p_session ->> 'updated_by', '')::uuid,
      updated_by_email = p_session ->> 'updated_by_email'
    where id = v_session_id;

    if not found then
      raise exception 'ไม่พบรอบกระทบยอด id=%', v_session_id;
    end if;

    delete from public.bank_reconcile_bank_transactions where session_id = v_session_id;
    delete from public.bank_reconcile_gl_transactions where session_id = v_session_id;
  end if;

  insert into public.bank_reconcile_bank_transactions (
    session_id, row_number, transaction_date, description, money_in, money_out, direction, amount,
    balance, account_no, raw_row, excluded, row_errors, needs_gl_entry, reviewed, review_note
  )
  select
    v_session_id,
    (x ->> 'row_number')::int,
    nullif(x ->> 'transaction_date', '')::date,
    coalesce(x ->> 'description', ''),
    coalesce((x ->> 'money_in')::numeric, 0),
    coalesce((x ->> 'money_out')::numeric, 0),
    x ->> 'direction',
    coalesce((x ->> 'amount')::numeric, 0),
    nullif(x ->> 'balance', '')::numeric,
    coalesce(x ->> 'account_no', ''),
    coalesce(x -> 'raw_row', '[]'::jsonb),
    coalesce((x ->> 'excluded')::boolean, false),
    coalesce(x -> 'row_errors', '[]'::jsonb),
    coalesce((x ->> 'needs_gl_entry')::boolean, false),
    coalesce((x ->> 'reviewed')::boolean, false),
    coalesce(x ->> 'review_note', '')
  from jsonb_array_elements(coalesce(p_bank_transactions, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_gl_transactions (
    session_id, row_number, transaction_date, description, money_in, money_out, direction, amount,
    doc_no, account_code, raw_row, excluded, row_errors, needs_gl_review, reviewed, review_note
  )
  select
    v_session_id,
    (x ->> 'row_number')::int,
    nullif(x ->> 'transaction_date', '')::date,
    coalesce(x ->> 'description', ''),
    coalesce((x ->> 'money_in')::numeric, 0),
    coalesce((x ->> 'money_out')::numeric, 0),
    x ->> 'direction',
    coalesce((x ->> 'amount')::numeric, 0),
    coalesce(x ->> 'doc_no', ''),
    coalesce(x ->> 'account_code', ''),
    coalesce(x -> 'raw_row', '[]'::jsonb),
    coalesce((x ->> 'excluded')::boolean, false),
    coalesce(x -> 'row_errors', '[]'::jsonb),
    coalesce((x ->> 'needs_gl_review')::boolean, false),
    coalesce((x ->> 'reviewed')::boolean, false),
    coalesce(x ->> 'review_note', '')
  from jsonb_array_elements(coalesce(p_gl_transactions, '[]'::jsonb)) as x;

  select * into v_result from public.bank_reconcile_sessions where id = v_session_id;
  return v_result;
end;
$$;

revoke all on function public.save_bank_reconcile_session(jsonb, jsonb, jsonb) from public;
grant execute on function public.save_bank_reconcile_session(jsonb, jsonb, jsonb) to authenticated;
