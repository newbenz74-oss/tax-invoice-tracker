-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration: Bank Reconcile เฟส 4 — บันทึกรอบกระทบยอด + ประวัติ + Audit Log
-- รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP) ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent)
--
-- สร้างตารางใหม่ 6 ตาราง เฉพาะของฟีเจอร์ Bank Reconcile เท่านั้น (ตามสเปกส่วน "2. DATABASE TABLES" ตรงๆ):
--   1. bank_reconcile_sessions          — หัวรอบกระทบยอดหนึ่งรอบ
--   2. bank_reconcile_bank_transactions — แถว Bank Statement ที่บันทึกไว้ของแต่ละรอบ
--   3. bank_reconcile_gl_transactions   — แถว GL ที่บันทึกไว้ของแต่ละรอบ
--   4. bank_reconcile_match_groups      — กลุ่มการจับคู่ (อัตโนมัติที่ยืนยันแล้ว + จับคู่ด้วยตนเอง)
--   5. bank_reconcile_match_group_items — สมาชิกของแต่ละกลุ่มจับคู่ (แถว Bank/GL ที่อยู่ในกลุ่มนั้น)
--   6. bank_reconcile_audit_logs        — ประวัติการแก้ไขทุกรอบ (append-only)
--
-- ไม่แก้ไขตารางเดิมของฟีเจอร์อื่นเลยแม้แต่คอลัมน์เดียว (pending_tax_invoices, business_partners, ...) ตาม
-- ข้อจำกัดส่วน "20. IMPORTANT RESTRICTIONS" ของสเปก
--
-- ธรรมเนียมที่ยึดตามไฟล์ migration เดิมทุกไฟล์ในโปรเจกต์นี้ (migration.sql, migration_004_business_partners.sql):
--   - uuid primary key default gen_random_uuid() ยกเว้น bank_reconcile_match_groups.id (ดูเหตุผลเฉพาะที่ตาราง)
--   - created_by/updated_by/... uuid references auth.users (id) on delete set null คู่กับ _email สำรอง
--   - RLS: ทีมทุกคนที่ login แล้ว (authenticated) มีสิทธิ์เท่ากันทุกแถว ไม่มีสิทธิ์ anon/public เลย
--   - reuse public.set_updated_at() ตัวเดิม (สร้างไว้แล้วใน migration.sql) ไม่สร้างซ้ำ

create extension if not exists "pgcrypto";

/* ============================== 1. bank_reconcile_sessions ============================== */
-- ฟิลด์ตรงตามสเปกส่วน "1. RECONCILIATION SESSION" ทุกตัว บวกฟิลด์เสริมที่จำเป็นสำหรับส่วนอื่นของสเปกเดียวกัน
-- ที่ระบุไว้ตรงๆ ว่าต้องเก็บแต่ไม่อยู่ในลิสต์ฟิลด์หลัก: completion_note (ส่วน "9. COMPLETION VALIDATION" —
-- บังคับกรอกเมื่อผลต่าง≠0/มีรายการค้าง/มีรายการรอตรวจสอบ), reopened_by/reopened_by_email/reopened_at/
-- reopen_reason (ส่วน "11. REOPEN COMPLETED SESSION" — "store reopened_by/reopened_at/reopen_reason" ตรงๆ),
-- deleted_at (soft delete ตามที่ส่วน "6. SESSION LIST PAGE" ขอ "prefer soft delete if possible" — แยกจาก
-- status='cancelled' โดยเจตนา เพราะ "ยกเลิก" (ปุ่ม ยกเลิก) กับ "ลบ" (ปุ่ม ลบ) เป็นสองแอ็กชันต่างกันตามสเปก)
create table if not exists public.bank_reconcile_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null,
  bank_account_no text,
  bank_name text,
  period_start date,
  period_end date,
  bank_file_name text not null,
  gl_file_name text not null,
  bank_row_count integer not null default 0 check (bank_row_count >= 0),
  gl_row_count integer not null default 0 check (gl_row_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  suggested_count integer not null default 0 check (suggested_count >= 0),
  manual_match_count integer not null default 0 check (manual_match_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  unmatched_bank_count integer not null default 0 check (unmatched_bank_count >= 0),
  unmatched_gl_count integer not null default 0 check (unmatched_gl_count >= 0),
  bank_total numeric(14, 2) not null default 0,
  gl_total numeric(14, 2) not null default 0,
  matched_bank_total numeric(14, 2) not null default 0,
  matched_gl_total numeric(14, 2) not null default 0,
  unmatched_bank_total numeric(14, 2) not null default 0,
  unmatched_gl_total numeric(14, 2) not null default 0,
  net_difference numeric(14, 2) not null default 0,
  date_tolerance_days integer not null default 0 check (date_tolerance_days >= 0),
  amount_tolerance numeric(14, 2) not null default 0 check (amount_tolerance >= 0),
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'reopened', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  completed_by uuid references auth.users (id) on delete set null,
  completed_by_email text,
  completed_at timestamptz,
  completion_note text,
  reopened_by uuid references auth.users (id) on delete set null,
  reopened_by_email text,
  reopened_at timestamptz,
  reopen_reason text,
  deleted_at timestamptz
);

create index if not exists bank_reconcile_sessions_status_idx on public.bank_reconcile_sessions (status);
create index if not exists bank_reconcile_sessions_deleted_at_idx on public.bank_reconcile_sessions (deleted_at);
create index if not exists bank_reconcile_sessions_created_at_idx on public.bank_reconcile_sessions (created_at);
create index if not exists bank_reconcile_sessions_bank_account_no_idx on public.bank_reconcile_sessions (bank_account_no);

drop trigger if exists trg_bank_reconcile_sessions_updated_at on public.bank_reconcile_sessions;
create trigger trg_bank_reconcile_sessions_updated_at
  before update on public.bank_reconcile_sessions
  for each row execute function public.set_updated_at();

alter table public.bank_reconcile_sessions enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_sessions;
create policy "authenticated_select" on public.bank_reconcile_sessions for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_sessions;
create policy "authenticated_insert" on public.bank_reconcile_sessions for insert to authenticated with check (true);
drop policy if exists "authenticated_update" on public.bank_reconcile_sessions;
create policy "authenticated_update" on public.bank_reconcile_sessions for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_delete" on public.bank_reconcile_sessions;
create policy "authenticated_delete" on public.bank_reconcile_sessions for delete to authenticated using (true);

/* ============================== 2. bank_reconcile_bank_transactions ============================== */
-- raw_data = raw_bank_row เดิมจากไฟล์ต้นฉบับเป๊ะ (array ดิบ) — normalized_data = ค่าที่ normalize แล้วทั้งหมด
-- (ยกเว้น id ของแถวเองและ raw_data) เก็บแยกกันเสมอตามสเปก "Never overwrite original imported values — store
-- both raw_data and normalized_data" — review_note/note_updated_by/note_updated_at/reviewed_by/reviewed_at:
-- Phase 3 (types/bankReconcile.ts) ออกแบบให้หมายเหตุทั่วไปของแถว (RowNote) กับหมายเหตุตอนทำเครื่องหมาย
-- "ต้องตรวจสอบ" ใช้ช่องเดียวกันเสมอ ("ข้อความหมายเหตุของการตรวจสอบใช้ร่วมกับ RowNote ของแถวเดียวกันเสมอ") จึง
-- ใช้คอลัมน์ review_note ตามชื่อที่สเปกแนะนำเป็นช่องหมายเหตุเดียวของแถว บวก note_updated_by/note_updated_at
-- (ผู้แก้/เวลาแก้หมายเหตุ) และ reviewed_by/reviewed_at (ผู้ทำเครื่องหมาย/เวลาทำเครื่องหมาย ตาม ReviewFlag) ที่
-- ไม่มีในลิสต์ฟิลด์แนะนำของสเปกแต่จำเป็นเพื่อให้โหลดกลับเป็น RowNote/ReviewFlag ของเฟส 3 ได้ครบทุกฟิลด์จริง
create table if not exists public.bank_reconcile_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  source_row_number integer not null,
  bank_transaction_date date,
  bank_description text not null default '',
  bank_money_in numeric(14, 2) not null default 0,
  bank_money_out numeric(14, 2) not null default 0,
  bank_amount numeric(14, 2) not null default 0,
  bank_balance numeric(14, 2) not null default 0,
  raw_data jsonb not null default '[]'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  reconcile_status text not null default 'not_found_in_gl' check (
    reconcile_status in (
      'matched_exact', 'matched_tolerance', 'ambiguous', 'pending_review', 'not_found_in_gl',
      'confirmed_manual', 'confirmed_tolerance', 'confirmed_variance'
    )
  ),
  review_required boolean not null default false,
  review_note text,
  note_updated_by text,
  note_updated_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bank_reconcile_bank_txn_session_id_idx on public.bank_reconcile_bank_transactions (session_id);
create index if not exists bank_reconcile_bank_txn_date_idx on public.bank_reconcile_bank_transactions (bank_transaction_date);
create index if not exists bank_reconcile_bank_txn_amount_idx on public.bank_reconcile_bank_transactions (bank_amount);
create index if not exists bank_reconcile_bank_txn_status_idx on public.bank_reconcile_bank_transactions (reconcile_status);

alter table public.bank_reconcile_bank_transactions enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_bank_transactions;
create policy "authenticated_select" on public.bank_reconcile_bank_transactions for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_bank_transactions;
create policy "authenticated_insert" on public.bank_reconcile_bank_transactions for insert to authenticated with check (true);
drop policy if exists "authenticated_update" on public.bank_reconcile_bank_transactions;
create policy "authenticated_update" on public.bank_reconcile_bank_transactions for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_delete" on public.bank_reconcile_bank_transactions;
create policy "authenticated_delete" on public.bank_reconcile_bank_transactions for delete to authenticated using (true);

/* ============================== 3. bank_reconcile_gl_transactions ============================== */
create table if not exists public.bank_reconcile_gl_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  source_row_number integer not null,
  gl_date date,
  gl_document_no text not null default '',
  gl_description text not null default '',
  gl_debit numeric(14, 2) not null default 0,
  gl_credit numeric(14, 2) not null default 0,
  gl_amount numeric(14, 2) not null default 0,
  raw_data jsonb not null default '[]'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  is_used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists bank_reconcile_gl_txn_session_id_idx on public.bank_reconcile_gl_transactions (session_id);
create index if not exists bank_reconcile_gl_txn_date_idx on public.bank_reconcile_gl_transactions (gl_date);
create index if not exists bank_reconcile_gl_txn_amount_idx on public.bank_reconcile_gl_transactions (gl_amount);
create index if not exists bank_reconcile_gl_txn_is_used_idx on public.bank_reconcile_gl_transactions (is_used);

alter table public.bank_reconcile_gl_transactions enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_gl_transactions;
create policy "authenticated_select" on public.bank_reconcile_gl_transactions for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_gl_transactions;
create policy "authenticated_insert" on public.bank_reconcile_gl_transactions for insert to authenticated with check (true);
drop policy if exists "authenticated_update" on public.bank_reconcile_gl_transactions;
create policy "authenticated_update" on public.bank_reconcile_gl_transactions for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_delete" on public.bank_reconcile_gl_transactions;
create policy "authenticated_delete" on public.bank_reconcile_gl_transactions for delete to authenticated using (true);

/* ============================== 4. bank_reconcile_match_groups ============================== */
-- id เป็น "text" (ไม่ใช่ uuid) โดยเจตนา — client (components/BankReconcileResults.tsx เฟส 3 เดิม) สร้าง
-- match_group_id เป็น `mg-${crypto.randomUUID()}` อยู่แล้วตั้งแต่ก่อนมีเฟส 4 (ไม่ใช่ uuid ล้วนๆ มี prefix
-- "mg-") การให้คอลัมน์นี้เป็น text แล้วใช้ค่าเดิมจาก client ตรงๆ ทำให้ไม่ต้องแก้โค้ดเฟส 3 ที่ทำงานถูกต้อง/มี
-- unit test คุ้มครองอยู่แล้วแม้แต่บรรทัดเดียว (ตามข้อจำกัด "ห้าม rebuild เฟส 1/2/3") — ตัดสินใจเองและระบุไว้ใน
-- สรุปผลตอนส่งมอบด้วย
create table if not exists public.bank_reconcile_match_groups (
  id text primary key,
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  match_type text not null check (match_type in ('one_to_one', 'one_to_many', 'many_to_one', 'manual_override')),
  bank_total numeric(14, 2) not null default 0,
  gl_total numeric(14, 2) not null default 0,
  amount_difference numeric(14, 2) not null default 0,
  match_score numeric(6, 2),
  match_reason text,
  manual_match boolean not null default true,
  status text not null check (status in ('confirmed_manual', 'confirmed_tolerance', 'confirmed_variance')),
  note text not null default '',
  matched_by text not null default '',
  matched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_reconcile_match_groups_session_id_idx on public.bank_reconcile_match_groups (session_id);

drop trigger if exists trg_bank_reconcile_match_groups_updated_at on public.bank_reconcile_match_groups;
create trigger trg_bank_reconcile_match_groups_updated_at
  before update on public.bank_reconcile_match_groups
  for each row execute function public.set_updated_at();

alter table public.bank_reconcile_match_groups enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_match_groups;
create policy "authenticated_select" on public.bank_reconcile_match_groups for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_match_groups;
create policy "authenticated_insert" on public.bank_reconcile_match_groups for insert to authenticated with check (true);
drop policy if exists "authenticated_update" on public.bank_reconcile_match_groups;
create policy "authenticated_update" on public.bank_reconcile_match_groups for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_delete" on public.bank_reconcile_match_groups;
create policy "authenticated_delete" on public.bank_reconcile_match_groups for delete to authenticated using (true);

/* ============================== 5. bank_reconcile_match_group_items ============================== */
-- session_id เป็นคอลัมน์ denormalize เพิ่มเติมจากลิสต์ฟิลด์แนะนำของสเปก (ซึ่งอ้างอิง session ผ่าน
-- match_group_id -> bank_reconcile_match_groups.session_id ทางอ้อมเท่านั้น) — เพิ่มเข้ามาเพื่อให้ทุกตารางลูก
-- ของ session กรองด้วย session_id ตรงๆ ได้แบบเดียวกันหมด (ไม่ต้อง join/สอง query ตอนโหลด session กลับมา
-- ทั้งชุด) และเพื่อให้ index บน session_id ตามที่สเปกส่วน "3. DATABASE SAFETY" กำหนด ("Indexes required on:
-- session_id, ...") ครอบคลุมตารางนี้ด้วยตรงๆ เหมือนอีก 3 ตารางลูก
create table if not exists public.bank_reconcile_match_group_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  match_group_id text not null references public.bank_reconcile_match_groups (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('bank', 'gl')),
  bank_transaction_id uuid references public.bank_reconcile_bank_transactions (id) on delete cascade,
  gl_transaction_id uuid references public.bank_reconcile_gl_transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint bank_reconcile_match_group_items_txn_check check (
    (transaction_type = 'bank' and bank_transaction_id is not null and gl_transaction_id is null)
    or
    (transaction_type = 'gl' and gl_transaction_id is not null and bank_transaction_id is null)
  )
);

create index if not exists bank_reconcile_match_group_items_session_id_idx on public.bank_reconcile_match_group_items (session_id);
create index if not exists bank_reconcile_match_group_items_group_id_idx on public.bank_reconcile_match_group_items (match_group_id);
create index if not exists bank_reconcile_match_group_items_bank_txn_id_idx on public.bank_reconcile_match_group_items (bank_transaction_id);
create index if not exists bank_reconcile_match_group_items_gl_txn_id_idx on public.bank_reconcile_match_group_items (gl_transaction_id);

alter table public.bank_reconcile_match_group_items enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_match_group_items;
create policy "authenticated_select" on public.bank_reconcile_match_group_items for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_match_group_items;
create policy "authenticated_insert" on public.bank_reconcile_match_group_items for insert to authenticated with check (true);
drop policy if exists "authenticated_update" on public.bank_reconcile_match_group_items;
create policy "authenticated_update" on public.bank_reconcile_match_group_items for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_delete" on public.bank_reconcile_match_group_items;
create policy "authenticated_delete" on public.bank_reconcile_match_group_items for delete to authenticated using (true);

/* ============================== 6. bank_reconcile_audit_logs ============================== */
-- action_type เป็น text ธรรมดา (ไม่ใช้ check constraint) โดยเจตนา — ต่างจากทุกคอลัมน์ enum อื่นในไฟล์นี้
-- เพราะเป็น log แบบ append-only ที่อาจต้องเพิ่มประเภทเหตุการณ์ใหม่ในอนาคตโดยไม่ต้อง migrate schema อีก บังคับ
-- ชนิด/ครบ 15 ค่าตามสเปกที่ชั้น TypeScript แทน (ดู ReconcileAuditActionType ใน types/bankReconcileSession.ts)
-- entity_id เป็น text อ้างอิงเพื่อการอ่านเท่านั้น (ไม่ใช่ FK จริง) เพราะ id ของแถว Bank/GL อาจถูกสร้างใหม่ทุก
-- ครั้งที่บันทึกทับแบบ full-snapshot (ดูหมายเหตุที่ ReconcileAuditLogEntry ใน types/bankReconcileSession.ts)
create table if not exists public.bank_reconcile_audit_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconcile_sessions (id) on delete cascade,
  action_type text not null,
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  action_note text,
  performed_by uuid references auth.users (id) on delete set null,
  performed_by_email text,
  performed_at timestamptz not null default now()
);

create index if not exists bank_reconcile_audit_logs_session_id_idx on public.bank_reconcile_audit_logs (session_id);
create index if not exists bank_reconcile_audit_logs_performed_at_idx on public.bank_reconcile_audit_logs (performed_at);

alter table public.bank_reconcile_audit_logs enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_audit_logs;
create policy "authenticated_select" on public.bank_reconcile_audit_logs for select to authenticated using (true);
drop policy if exists "authenticated_insert" on public.bank_reconcile_audit_logs;
create policy "authenticated_insert" on public.bank_reconcile_audit_logs for insert to authenticated with check (true);
-- audit log เป็น append-only ตามเจตนา — ไม่มี policy update/delete ให้เลย (ไม่มีทางแก้ไข/ลบประวัติย้อนหลังได้
-- แม้แต่ผู้ใช้ authenticated เอง ต่างจาก 5 ตารางข้างต้นที่มีสิทธิ์เท่ากันทั้ง 4 การกระทำ เป็นทางเลือกออกแบบที่
-- ตั้งใจเพื่อให้ "ประวัติการแก้ไข" น่าเชื่อถือจริง แก้ไขย้อนหลังไม่ได้ตามธรรมชาติของ audit trail)

/* ============================== ฟังก์ชันบันทึกรอบกระทบยอดแบบ atomic (§3 DATABASE SAFETY) ============================== */
-- Supabase JS client (PostgREST) ไม่รองรับ transaction ข้ามหลายตารางจากฝั่ง client โดยตรง (แต่ละ .from()
-- เป็นคนละ HTTP request/transaction) วิธีเดียวที่ทำให้ "บันทึกรอบกระทบยอด = บันทึก session + Bank txns + GL
-- txns + match groups + match group items ทั้งหมดพร้อมกัน แล้ว rollback ทั้งหมดถ้าล้มเหลว (no partial saves)"
-- เป็นจริงได้ตามสเปกส่วน "3. DATABASE SAFETY" ตรงๆ คือรวมทุกอย่างไว้ใน Postgres function เดียว แล้วเรียกผ่าน
-- supabase.rpc(...) ครั้งเดียวจากฝั่ง client (ดู lib/bankReconcileSessionApi.ts) — ฟังก์ชันเดียวรันในธุรกรรม
-- เดียวโดยธรรมชาติของ Postgres อยู่แล้ว (ไม่ต้องเปิด/ปิด transaction เอง) exception ใดๆ ที่เกิดขึ้นระหว่างทาง
-- (เช่น cast วันที่ผิดรูปแบบ, ละเมิด check constraint) จะทำให้การเปลี่ยนแปลงทั้งหมดในฟังก์ชันถูก rollback
-- อัตโนมัติทั้งหมดโดย Postgres เอง แล้ว error จะถูกส่งกลับไปหา client ตรงๆ ผ่าน supabase.rpc() — ไม่ต้องดักจับ
-- exception เองในฟังก์ชัน (การดักจับเองจะยิ่งเสี่ยงบัง error ที่ควรเห็น)
--
-- กลยุทธ์การบันทึก: "แทนที่ทั้งหมด" (full-snapshot replace) เสมอ — ลบ Bank/GL/match groups เดิมของ session
-- นั้นทั้งหมดก่อน (match_group_items ถูกลบตาม cascade อัตโนมัติ) แล้วแทรกชุดข้อมูลปัจจุบันทั้งหมดใหม่ ไม่ diff/
-- upsert ทีละแถว — เลือกวิธีนี้เพราะข้อมูลในหน่วยความจำฝั่ง client (matchBankRows/matchGLRows/matchGroups)
-- เป็น "ภาพรวมล่าสุดที่ถูกต้องเสมอ" อยู่แล้วทุกครั้งที่ผู้ใช้แก้ไขอะไรสักอย่าง การ diff เองจะเพิ่มความซับซ้อน/
-- พื้นที่เกิดบั๊กโดยไม่จำเป็นสำหรับขนาดข้อมูลของฟีเจอร์นี้ (ไฟล์ Bank/GL ของทีมขนาดนี้อยู่ในหลักร้อยถึงพันแถว
-- ไม่ใช่หลักล้าน) — id ของแถว Bank/GL ที่เคยมี uuid ถาวรแล้ว (โหลดมาจากฐานข้อมูล หรือเคยบันทึกไปแล้วรอบก่อน)
-- จะถูกใช้ซ้ำเดิมเสมอ (ส่งมาจาก client ตรงๆ ผ่าน jsonb) ส่วนแถวที่เพิ่งอัปโหลดสดๆ ครั้งแรก client จะสร้าง uuid
-- ถาวรให้ก่อนส่งมาเสมอ (ดู lib/bankReconcileSessionMapping.ts) ฟังก์ชันนี้จึงไม่ต้องสร้าง id เองเลยสักครั้ง
-- (ยกเว้น session ใหม่ที่ sessionId เป็น null เท่านั้นที่ปล่อยให้ default ของคอลัมน์ id ทำงาน)
create or replace function public.save_bank_reconcile_session(
  p_session jsonb,
  p_bank_transactions jsonb,
  p_gl_transactions jsonb,
  p_match_groups jsonb,
  p_match_group_items jsonb
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
      session_name, bank_account_no, bank_name, period_start, period_end,
      bank_file_name, gl_file_name, bank_row_count, gl_row_count, matched_count,
      suggested_count, manual_match_count, review_count, unmatched_bank_count, unmatched_gl_count,
      bank_total, gl_total, matched_bank_total, matched_gl_total, unmatched_bank_total, unmatched_gl_total,
      net_difference, date_tolerance_days, amount_tolerance, status,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
      p_session ->> 'session_name',
      p_session ->> 'bank_account_no',
      p_session ->> 'bank_name',
      nullif(p_session ->> 'period_start', '')::date,
      nullif(p_session ->> 'period_end', '')::date,
      p_session ->> 'bank_file_name',
      p_session ->> 'gl_file_name',
      (p_session ->> 'bank_row_count')::int,
      (p_session ->> 'gl_row_count')::int,
      (p_session ->> 'matched_count')::int,
      (p_session ->> 'suggested_count')::int,
      (p_session ->> 'manual_match_count')::int,
      (p_session ->> 'review_count')::int,
      (p_session ->> 'unmatched_bank_count')::int,
      (p_session ->> 'unmatched_gl_count')::int,
      (p_session ->> 'bank_total')::numeric,
      (p_session ->> 'gl_total')::numeric,
      (p_session ->> 'matched_bank_total')::numeric,
      (p_session ->> 'matched_gl_total')::numeric,
      (p_session ->> 'unmatched_bank_total')::numeric,
      (p_session ->> 'unmatched_gl_total')::numeric,
      (p_session ->> 'net_difference')::numeric,
      (p_session ->> 'date_tolerance_days')::int,
      (p_session ->> 'amount_tolerance')::numeric,
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
      bank_account_no = p_session ->> 'bank_account_no',
      bank_name = p_session ->> 'bank_name',
      period_start = nullif(p_session ->> 'period_start', '')::date,
      period_end = nullif(p_session ->> 'period_end', '')::date,
      bank_file_name = p_session ->> 'bank_file_name',
      gl_file_name = p_session ->> 'gl_file_name',
      bank_row_count = (p_session ->> 'bank_row_count')::int,
      gl_row_count = (p_session ->> 'gl_row_count')::int,
      matched_count = (p_session ->> 'matched_count')::int,
      suggested_count = (p_session ->> 'suggested_count')::int,
      manual_match_count = (p_session ->> 'manual_match_count')::int,
      review_count = (p_session ->> 'review_count')::int,
      unmatched_bank_count = (p_session ->> 'unmatched_bank_count')::int,
      unmatched_gl_count = (p_session ->> 'unmatched_gl_count')::int,
      bank_total = (p_session ->> 'bank_total')::numeric,
      gl_total = (p_session ->> 'gl_total')::numeric,
      matched_bank_total = (p_session ->> 'matched_bank_total')::numeric,
      matched_gl_total = (p_session ->> 'matched_gl_total')::numeric,
      unmatched_bank_total = (p_session ->> 'unmatched_bank_total')::numeric,
      unmatched_gl_total = (p_session ->> 'unmatched_gl_total')::numeric,
      net_difference = (p_session ->> 'net_difference')::numeric,
      date_tolerance_days = (p_session ->> 'date_tolerance_days')::int,
      amount_tolerance = (p_session ->> 'amount_tolerance')::numeric,
      status = p_session ->> 'status',
      updated_by = nullif(p_session ->> 'updated_by', '')::uuid,
      updated_by_email = p_session ->> 'updated_by_email'
    where id = v_session_id;

    if not found then
      raise exception 'ไม่พบรอบกระทบยอด id=%', v_session_id;
    end if;

    -- แทนที่ข้อมูลลูกทั้งหมด (full-snapshot replace) — match_group_items ถูกลบตาม cascade เมื่อ
    -- match_groups ถูกลบ ไม่ต้องลบเองซ้ำอีกบรรทัด
    delete from public.bank_reconcile_bank_transactions where session_id = v_session_id;
    delete from public.bank_reconcile_gl_transactions where session_id = v_session_id;
    delete from public.bank_reconcile_match_groups where session_id = v_session_id;
  end if;

  insert into public.bank_reconcile_bank_transactions (
    id, session_id, source_row_number, bank_transaction_date, bank_description,
    bank_money_in, bank_money_out, bank_amount, bank_balance, raw_data, normalized_data,
    reconcile_status, review_required, review_note, note_updated_by, note_updated_at,
    reviewed_by, reviewed_at
  )
  select
    (x ->> 'id')::uuid,
    v_session_id,
    (x ->> 'source_row_number')::int,
    nullif(x ->> 'bank_transaction_date', '')::date,
    coalesce(x ->> 'bank_description', ''),
    coalesce((x ->> 'bank_money_in')::numeric, 0),
    coalesce((x ->> 'bank_money_out')::numeric, 0),
    coalesce((x ->> 'bank_amount')::numeric, 0),
    coalesce((x ->> 'bank_balance')::numeric, 0),
    coalesce(x -> 'raw_data', '[]'::jsonb),
    coalesce(x -> 'normalized_data', '{}'::jsonb),
    x ->> 'reconcile_status',
    coalesce((x ->> 'review_required')::boolean, false),
    x ->> 'review_note',
    x ->> 'note_updated_by',
    nullif(x ->> 'note_updated_at', '')::timestamptz,
    x ->> 'reviewed_by',
    nullif(x ->> 'reviewed_at', '')::timestamptz
  from jsonb_array_elements(coalesce(p_bank_transactions, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_gl_transactions (
    id, session_id, source_row_number, gl_date, gl_document_no, gl_description,
    gl_debit, gl_credit, gl_amount, raw_data, normalized_data, is_used
  )
  select
    (x ->> 'id')::uuid,
    v_session_id,
    (x ->> 'source_row_number')::int,
    nullif(x ->> 'gl_date', '')::date,
    coalesce(x ->> 'gl_document_no', ''),
    coalesce(x ->> 'gl_description', ''),
    coalesce((x ->> 'gl_debit')::numeric, 0),
    coalesce((x ->> 'gl_credit')::numeric, 0),
    coalesce((x ->> 'gl_amount')::numeric, 0),
    coalesce(x -> 'raw_data', '[]'::jsonb),
    coalesce(x -> 'normalized_data', '{}'::jsonb),
    coalesce((x ->> 'is_used')::boolean, false)
  from jsonb_array_elements(coalesce(p_gl_transactions, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_match_groups (
    id, session_id, match_type, bank_total, gl_total, amount_difference,
    match_score, match_reason, manual_match, status, note, matched_by, matched_at
  )
  select
    x ->> 'id',
    v_session_id,
    x ->> 'match_type',
    coalesce((x ->> 'bank_total')::numeric, 0),
    coalesce((x ->> 'gl_total')::numeric, 0),
    coalesce((x ->> 'amount_difference')::numeric, 0),
    nullif(x ->> 'match_score', '')::numeric,
    x ->> 'match_reason',
    coalesce((x ->> 'manual_match')::boolean, true),
    x ->> 'status',
    coalesce(x ->> 'note', ''),
    coalesce(x ->> 'matched_by', ''),
    coalesce(nullif(x ->> 'matched_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_match_groups, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_match_group_items (
    session_id, match_group_id, transaction_type, bank_transaction_id, gl_transaction_id
  )
  select
    v_session_id,
    x ->> 'match_group_id',
    x ->> 'transaction_type',
    nullif(x ->> 'bank_transaction_id', '')::uuid,
    nullif(x ->> 'gl_transaction_id', '')::uuid
  from jsonb_array_elements(coalesce(p_match_group_items, '[]'::jsonb)) as x;

  select * into v_result from public.bank_reconcile_sessions where id = v_session_id;
  return v_result;
end;
$$;

-- เปิดสิทธิ์เรียกฟังก์ชันนี้เฉพาะ authenticated เท่านั้น (ตัดสิทธิ์ default ของ PUBLIC/anon ทิ้งก่อนเสมอ) —
-- สอดคล้องกับโมเดล RLS "equal access ทุกคนในทีม ไม่มีสิทธิ์ anon" ของทั้งไฟล์นี้
revoke all on function public.save_bank_reconcile_session(jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_bank_reconcile_session(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
