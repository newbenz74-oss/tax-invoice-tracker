-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 007: รองรับหลายบริษัท (multi-company)
-- เพิ่มตาราง companies + company_members ใหม่ทั้งหมด, เพิ่มคอลัมน์ company_id ใน 3 ตารางเดิมที่มีข้อมูลจริง
-- (pending_tax_invoices, business_partners, bank_reconcile_reports — ตาราง 3 ตัวลูกของ bank_reconcile_reports
-- คือ match_groups/bank_rows/gl_rows ไม่ต้องมี company_id ของตัวเอง ใช้ join ผ่าน report_id แทน เพราะเขียนผ่าน
-- RPC เดียว save_bank_reconcile_report() เท่านั้น ไม่มีทาง insert ตรงๆ จากฝั่ง client อยู่แล้ว)
-- ย้ายข้อมูลปัจจุบันทั้งหมดให้เป็นของบริษัทแรก "บริษัท ซีบีซอฟท์ จำกัด" และผูกสมาชิกทั้ง 2 คนที่มีอยู่ในระบบ
-- (newbenz74@gmail.com, kiadtisack1998@gmail.com) เข้ากับบริษัทนี้ ไม่มีใครเสียสิทธิ์เข้าถึงข้อมูลเดิมของตัวเอง
-- รันทั้งไฟล์นี้ผ่าน Supabase SQL editor หรือ apply_migration (MCP) ครั้งเดียว — ไม่ปลอดภัยที่จะรันซ้ำเต็มรูปแบบ
-- เหมือนไฟล์อื่น เพราะมีขั้นตอน backfill ข้อมูลจริงอยู่ (ถ้ารันซ้ำ ส่วน create table/policy จะ idempotent ตาม
-- ปกติ แต่ insert บริษัทแรก/สมาชิกจะซ้ำถ้าไม่มี guard — ได้ใส่ guard กันซ้ำไว้แล้วด้านล่างทุกจุด)

/* ============================== 1. ตาราง companies ============================== */
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

/* ============================== 2. ตาราง company_members ============================== */
-- เชื่อม user (auth.users) กับบริษัทที่ดูได้ — 1 user มีได้หลายแถว (ดูได้หลายบริษัท), 1 บริษัทมีได้หลายสมาชิก
-- ไม่มี role/สิทธิ์แยกระดับ ตามที่ผู้ใช้ยืนยันว่า "ทุกคนที่มีรหัสเข้าใช้งานมีสิทธิ์เท่ากัน" ภายในบริษัทเดียวกัน
create table if not exists public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_members_user_id_idx on public.company_members (user_id);

/* ============================== 3. ฟังก์ชันช่วยเช็คสิทธิ์ ============================== */
-- คืนค่า true ถ้า user ที่ login อยู่ตอนนี้ (auth.uid()) เป็นสมาชิกของบริษัทที่ระบุ — ใช้ซ้ำในทุก RLS policy
-- ด้านล่าง เป็น security invoker ธรรมดา (ไม่ใช่ definer) เพราะ company_members มี policy ให้ user เห็นแถวของ
-- ตัวเองอยู่แล้ว จึง query ผ่านได้ปกติโดยไม่ต้อง bypass RLS
create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = target_company_id and m.user_id = auth.uid()
  );
$$;

/* ============================== 4. เพิ่มคอลัมน์ company_id (nullable ชั่วคราวระหว่าง backfill) ============ */
alter table public.pending_tax_invoices add column if not exists company_id uuid references public.companies (id);
alter table public.business_partners add column if not exists company_id uuid references public.companies (id);
alter table public.bank_reconcile_reports add column if not exists company_id uuid references public.companies (id);

/* ============================== 5. สร้างบริษัทแรก + ผูกสมาชิกเดิม + backfill ข้อมูลเดิม ================= */
do $$
declare
  v_company_id uuid;
begin
  select id into v_company_id from public.companies where name = 'บริษัท ซีบีซอฟท์ จำกัด' limit 1;

  if v_company_id is null then
    insert into public.companies (name) values ('บริษัท ซีบีซอฟท์ จำกัด')
    returning id into v_company_id;
  end if;

  insert into public.company_members (company_id, user_id)
  select v_company_id, u.id
  from auth.users u
  where u.email in ('newbenz74@gmail.com', 'kiadtisack1998@gmail.com')
  on conflict (company_id, user_id) do nothing;

  update public.pending_tax_invoices set company_id = v_company_id where company_id is null;
  update public.business_partners set company_id = v_company_id where company_id is null;
  update public.bank_reconcile_reports set company_id = v_company_id where company_id is null;
end $$;

/* ============================== 6. บังคับ company_id ห้ามว่างอีกต่อไป ================================= */
alter table public.pending_tax_invoices alter column company_id set not null;
alter table public.business_partners alter column company_id set not null;
alter table public.bank_reconcile_reports alter column company_id set not null;

create index if not exists pending_tax_invoices_company_id_idx on public.pending_tax_invoices (company_id);
create index if not exists business_partners_company_id_idx on public.business_partners (company_id);
create index if not exists bank_reconcile_reports_company_id_idx on public.bank_reconcile_reports (company_id);

/* ============================== 7. RLS: companies / company_members ==================================== */
alter table public.companies enable row level security;
drop policy if exists "select_member_companies" on public.companies;
create policy "select_member_companies" on public.companies
  for select
  to authenticated
  using (public.is_company_member(id));
-- ไม่มี policy insert/update/delete สำหรับ authenticated เลยโดยตั้งใจ — สร้าง/แก้บริษัทใหม่ทำผ่าน SQL
-- editor หรือ service role เท่านั้นตามที่ผู้ใช้ยืนยัน (ยังไม่ต้องมี UI จัดการบริษัทตอนนี้)

alter table public.company_members enable row level security;
drop policy if exists "select_own_membership" on public.company_members;
create policy "select_own_membership" on public.company_members
  for select
  to authenticated
  using (user_id = auth.uid());
-- เหตุผลเดียวกับ companies — เพิ่ม/ลบสมาชิกทำผ่าน SQL editor เท่านั้น ไม่มี policy insert/update/delete

/* ============================== 8. RLS: 3 ตารางที่มี company_id ตรงๆ =================================== */
-- แทนที่ policy เดิมที่เปิดกว้าง using(true)/with check(true) ทุกตัว ด้วย policy ที่กรองตามบริษัทที่เป็น
-- สมาชิกอยู่เท่านั้น — รูปแบบเดียวกันทั้ง 3 ตาราง
drop policy if exists "authenticated_select" on public.pending_tax_invoices;
create policy "company_member_select" on public.pending_tax_invoices
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "authenticated_insert" on public.pending_tax_invoices;
create policy "company_member_insert" on public.pending_tax_invoices
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "authenticated_update" on public.pending_tax_invoices;
create policy "company_member_update" on public.pending_tax_invoices
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists "authenticated_delete" on public.pending_tax_invoices;
create policy "company_member_delete" on public.pending_tax_invoices
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists "authenticated_select" on public.business_partners;
create policy "company_member_select" on public.business_partners
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "authenticated_insert" on public.business_partners;
create policy "company_member_insert" on public.business_partners
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "authenticated_update" on public.business_partners;
create policy "company_member_update" on public.business_partners
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists "authenticated_delete" on public.business_partners;
create policy "company_member_delete" on public.business_partners
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists "authenticated_select" on public.bank_reconcile_reports;
create policy "company_member_select" on public.bank_reconcile_reports
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "authenticated_insert" on public.bank_reconcile_reports;
create policy "company_member_insert" on public.bank_reconcile_reports
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "authenticated_update" on public.bank_reconcile_reports;
create policy "company_member_update" on public.bank_reconcile_reports
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists "authenticated_delete" on public.bank_reconcile_reports;
create policy "company_member_delete" on public.bank_reconcile_reports
  for delete to authenticated using (public.is_company_member(company_id));

/* ============================== 9. RLS: ตารางลูกของ bank_reconcile_reports (join ผ่าน report_id) ======== */
-- ไม่มี company_id ของตัวเอง เช็คสิทธิ์ผ่าน report_id -> bank_reconcile_reports.company_id เสมอ
drop policy if exists "authenticated_select" on public.bank_reconcile_match_groups;
create policy "company_member_select" on public.bank_reconcile_match_groups
  for select to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_match_groups.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_insert" on public.bank_reconcile_match_groups;
create policy "company_member_insert" on public.bank_reconcile_match_groups
  for insert to authenticated with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_match_groups.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_update" on public.bank_reconcile_match_groups;
create policy "company_member_update" on public.bank_reconcile_match_groups
  for update to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_match_groups.report_id and public.is_company_member(r.company_id)
  )) with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_match_groups.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_delete" on public.bank_reconcile_match_groups;
create policy "company_member_delete" on public.bank_reconcile_match_groups
  for delete to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_match_groups.report_id and public.is_company_member(r.company_id)
  ));

drop policy if exists "authenticated_select" on public.bank_reconcile_bank_rows;
create policy "company_member_select" on public.bank_reconcile_bank_rows
  for select to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_bank_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_insert" on public.bank_reconcile_bank_rows;
create policy "company_member_insert" on public.bank_reconcile_bank_rows
  for insert to authenticated with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_bank_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_update" on public.bank_reconcile_bank_rows;
create policy "company_member_update" on public.bank_reconcile_bank_rows
  for update to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_bank_rows.report_id and public.is_company_member(r.company_id)
  )) with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_bank_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_delete" on public.bank_reconcile_bank_rows;
create policy "company_member_delete" on public.bank_reconcile_bank_rows
  for delete to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_bank_rows.report_id and public.is_company_member(r.company_id)
  ));

drop policy if exists "authenticated_select" on public.bank_reconcile_gl_rows;
create policy "company_member_select" on public.bank_reconcile_gl_rows
  for select to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_gl_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_insert" on public.bank_reconcile_gl_rows;
create policy "company_member_insert" on public.bank_reconcile_gl_rows
  for insert to authenticated with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_gl_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_update" on public.bank_reconcile_gl_rows;
create policy "company_member_update" on public.bank_reconcile_gl_rows
  for update to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_gl_rows.report_id and public.is_company_member(r.company_id)
  )) with check (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_gl_rows.report_id and public.is_company_member(r.company_id)
  ));
drop policy if exists "authenticated_delete" on public.bank_reconcile_gl_rows;
create policy "company_member_delete" on public.bank_reconcile_gl_rows
  for delete to authenticated using (exists (
    select 1 from public.bank_reconcile_reports r
    where r.id = bank_reconcile_gl_rows.report_id and public.is_company_member(r.company_id)
  ));

/* ============================== 10. อัปเดต RPC save_bank_reconcile_report ให้รับ p_company_id =========== */
-- เพิ่มพารามิเตอร์ p_company_id เข้าไปเป็นตัวแรก — ใส่ company_id ตอน insert รายงานใหม่ (RLS with check ของ
-- policy "company_member_insert" ด้านบนจะปฏิเสธทันทีถ้า p_company_id ที่ส่งมาไม่ใช่บริษัทที่ user เป็นสมาชิก
-- อยู่จริง โดยไม่ต้องเช็คซ้ำในฟังก์ชันนี้เลย เพราะฟังก์ชันเป็น security invoker) ตอน update รายงานเดิมไม่แตะ
-- company_id ที่มีอยู่แล้ว (ย้ายบริษัทของรายงานที่บันทึกไปแล้วไม่ใช่ use case ที่ต้องรองรับ)
drop function if exists public.save_bank_reconcile_report(jsonb, jsonb, jsonb, jsonb);

create or replace function public.save_bank_reconcile_report(
  p_company_id uuid,
  p_report jsonb,
  p_match_groups jsonb,
  p_bank_rows jsonb,
  p_gl_rows jsonb
)
returns public.bank_reconcile_reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_result public.bank_reconcile_reports;
begin
  v_report_id := nullif(p_report ->> 'id', '')::uuid;

  if v_report_id is null then
    insert into public.bank_reconcile_reports (
      company_id, report_name, period_month, period_year, status, bank_file_name, gl_file_name, tolerance_days,
      bank_row_count, gl_row_count, matched_group_count, bank_unmatched_count, gl_unmatched_count,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
      p_company_id,
      p_report ->> 'report_name',
      (p_report ->> 'period_month')::smallint,
      (p_report ->> 'period_year')::smallint,
      coalesce(p_report ->> 'status', 'draft'),
      nullif(p_report ->> 'bank_file_name', ''),
      nullif(p_report ->> 'gl_file_name', ''),
      coalesce((p_report ->> 'tolerance_days')::smallint, 1),
      jsonb_array_length(coalesce(p_bank_rows, '[]'::jsonb)),
      jsonb_array_length(coalesce(p_gl_rows, '[]'::jsonb)),
      jsonb_array_length(coalesce(p_match_groups, '[]'::jsonb)),
      (select count(*)::int from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) x
        where nullif(x ->> 'match_group_id', '') is null),
      (select count(*)::int from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) x
        where nullif(x ->> 'match_group_id', '') is null),
      nullif(p_report ->> 'created_by', '')::uuid,
      p_report ->> 'created_by_email',
      nullif(p_report ->> 'updated_by', '')::uuid,
      p_report ->> 'updated_by_email'
    )
    returning id into v_report_id;
  else
    update public.bank_reconcile_reports set
      report_name = p_report ->> 'report_name',
      period_month = (p_report ->> 'period_month')::smallint,
      period_year = (p_report ->> 'period_year')::smallint,
      status = coalesce(p_report ->> 'status', 'draft'),
      bank_file_name = nullif(p_report ->> 'bank_file_name', ''),
      gl_file_name = nullif(p_report ->> 'gl_file_name', ''),
      tolerance_days = coalesce((p_report ->> 'tolerance_days')::smallint, 1),
      bank_row_count = jsonb_array_length(coalesce(p_bank_rows, '[]'::jsonb)),
      gl_row_count = jsonb_array_length(coalesce(p_gl_rows, '[]'::jsonb)),
      matched_group_count = jsonb_array_length(coalesce(p_match_groups, '[]'::jsonb)),
      bank_unmatched_count = (select count(*)::int from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) x
        where nullif(x ->> 'match_group_id', '') is null),
      gl_unmatched_count = (select count(*)::int from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) x
        where nullif(x ->> 'match_group_id', '') is null),
      updated_by = nullif(p_report ->> 'updated_by', '')::uuid,
      updated_by_email = p_report ->> 'updated_by_email'
    where id = v_report_id;

    if not found then
      raise exception 'ไม่พบรายการกระทบยอด id=% หรือไม่มีสิทธิ์เข้าถึง', v_report_id;
    end if;

    delete from public.bank_reconcile_bank_rows where report_id = v_report_id;
    delete from public.bank_reconcile_gl_rows where report_id = v_report_id;
    delete from public.bank_reconcile_match_groups where report_id = v_report_id;
  end if;

  insert into public.bank_reconcile_match_groups (id, report_id, match_type, type)
  select (x ->> 'id')::uuid, v_report_id, x ->> 'match_type', x ->> 'type'
  from jsonb_array_elements(coalesce(p_match_groups, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_bank_rows (
    report_id, match_group_id, row_order, transaction_date, type, amount
  )
  select
    v_report_id,
    nullif(x ->> 'match_group_id', '')::uuid,
    (x ->> 'row_order')::int,
    (x ->> 'transaction_date')::date,
    x ->> 'type',
    (x ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_gl_rows (
    report_id, match_group_id, row_order, document_no, transaction_date, type, amount
  )
  select
    v_report_id,
    nullif(x ->> 'match_group_id', '')::uuid,
    (x ->> 'row_order')::int,
    coalesce(x ->> 'document_no', ''),
    (x ->> 'transaction_date')::date,
    x ->> 'type',
    (x ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) as x;

  select * into v_result from public.bank_reconcile_reports where id = v_report_id;
  return v_result;
end;
$$;

revoke all on function public.save_bank_reconcile_report(uuid, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_bank_reconcile_report(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
