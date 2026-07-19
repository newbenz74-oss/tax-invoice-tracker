-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 006: บันทึกประวัติการกระทบยอด Bank Reconcile (จับคู่เอง + บันทึกเป็นรายการประวัติ)
-- เป็นตารางใหม่ทั้งหมด 4 ตาราง ไม่แก้ไข/ไม่ลบตารางเดิมใดๆ เลยแม้แต่คอลัมน์เดียว (pending_tax_invoices,
-- business_partners, ...) ปลอดภัยที่จะรันซ้ำ (idempotent) รันทั้งไฟล์นี้ผ่าน Supabase SQL editor ครั้งเดียว
--
-- หมายเหตุสำคัญ: migration_005_bank_reconcile.sql ที่มีอยู่ในโปรเจกต์ก่อนหน้านี้ยังคง "orphaned" (ไม่เคยถูก
-- apply กับฐานข้อมูลจริงเลย) เหมือนเดิม — ไฟล์นี้ไม่แตะ/ไม่ลบ/ไม่อ้างอิงไฟล์นั้นเลย และตั้งใจตั้งชื่อตาราง
-- ทั้งหมดด้านล่างให้ไม่ซ้ำกับชื่อตารางใน migration_005 เพื่อไม่ให้ชนกันถ้ามีใครรันไฟล์นั้นภายหลัง โมเดลข้อมูล
-- ก็ต่างกันโดยพื้นฐาน (migration_005 ไม่มีแนวคิด "กลุ่มจับคู่" เลย ส่วนไฟล์นี้ออกแบบมาเพื่อรองรับการจับคู่เอง
-- แบบ N:M โดยเฉพาะ ซึ่งเป็นฟีเจอร์ใหม่ที่เพิ่งถูกร้องขอ 2026-07-19)
--
-- ธรรมเนียมที่ยึดตามไฟล์ migration เดิมทุกไฟล์ในโปรเจกต์นี้ (migration.sql, migration_004_business_partners.sql):
--   - uuid primary key default gen_random_uuid() (pgcrypto ถูกเปิดใช้แล้วตั้งแต่ migration.sql ไม่ต้องเปิดซ้ำ)
--   - created_by/updated_by uuid references auth.users (id) on delete set null คู่กับ _email สำรอง
--   - RLS: ทีมทุกคนที่ login แล้ว (authenticated) มีสิทธิ์เท่ากันทุกแถว ไม่มีสิทธิ์ anon/public เลย
--   - reuse public.set_updated_at() ตัวเดิม (สร้างไว้แล้วใน migration.sql) ไม่สร้างฟังก์ชันซ้ำ
--   - create table if not exists + drop policy if exists ก่อน create ทุกครั้ง เพื่อความ idempotent เต็มรูปแบบ

/* ============================== 1. bank_reconcile_reports (หัวรายการประวัติ) ============================== */
-- 1 แถว = 1 ครั้งที่ผู้ใช้กด "บันทึก" ไม่ว่าจะเป็นสถานะ draft (ทำค้างไว้) หรือ complete (เสร็จสมบูรณ์) — ทั้ง
-- สองสถานะเปิดกลับมาแก้ไขได้เสมอ ไม่มีกลไกล็อกถาวรใดๆ (ผู้ใช้ยืนยันแล้วว่าไม่ต้องการให้ล็อก)
create table if not exists public.bank_reconcile_reports (
  id uuid primary key default gen_random_uuid(),

  -- ชื่อที่แสดงในหน้าประวัติ สร้างจาก period_month/period_year เสมอ (เช่น "กระทบยอดเดือนมิถุนายน 2569")
  -- ไม่ใช่ free text ที่ผู้ใช้พิมพ์เอง — ดู lib/bankReconcileReportApi.ts
  report_name text not null,
  period_month smallint not null check (period_month >= 1 and period_month <= 12),
  -- เก็บเป็นปี พ.ศ. ตรงๆ ตามที่ buddhistYearOptions() (lib/thaiDate.ts) คืนค่ามาเลย ไม่แปลงเป็น ค.ศ. ก่อน —
  -- ช่วง 2500-2700 กันข้อมูลผิดพลาดแบบใส่ปี ค.ศ. เข้ามาโดยไม่ตั้งใจ (เช่น 2026 จะ fail constraint นี้ทันที)
  period_year smallint not null check (period_year >= 2500 and period_year <= 2700),
  status text not null default 'draft' check (status in ('draft', 'complete')),

  bank_file_name text,
  gl_file_name text,
  tolerance_days smallint not null default 1 check (tolerance_days in (1, 3)),

  -- ค่าสรุปแบบ denormalized ไว้ใช้แสดงในหน้ารายการประวัติโดยไม่ต้อง join ตารางลูกทุกครั้ง คำนวณสดใหม่ทุกครั้ง
  -- ที่บันทึก (ดู RPC ด้านล่าง) ไม่ใช่ค่าที่ผู้ใช้กรอกเอง
  bank_row_count integer not null default 0 check (bank_row_count >= 0),
  gl_row_count integer not null default 0 check (gl_row_count >= 0),
  matched_group_count integer not null default 0 check (matched_group_count >= 0),
  bank_unmatched_count integer not null default 0 check (bank_unmatched_count >= 0),
  gl_unmatched_count integer not null default 0 check (gl_unmatched_count >= 0),

  created_by uuid references auth.users (id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create index if not exists bank_reconcile_reports_period_idx
  on public.bank_reconcile_reports (period_year desc, period_month desc);
create index if not exists bank_reconcile_reports_status_idx on public.bank_reconcile_reports (status);

drop trigger if exists trg_bank_reconcile_reports_updated_at on public.bank_reconcile_reports;
create trigger trg_bank_reconcile_reports_updated_at
  before update on public.bank_reconcile_reports
  for each row execute function public.set_updated_at();

alter table public.bank_reconcile_reports enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_reports;
create policy "authenticated_select" on public.bank_reconcile_reports
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.bank_reconcile_reports;
create policy "authenticated_insert" on public.bank_reconcile_reports
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.bank_reconcile_reports;
create policy "authenticated_update" on public.bank_reconcile_reports
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.bank_reconcile_reports;
create policy "authenticated_delete" on public.bank_reconcile_reports
  for delete
  to authenticated
  using (true);

/* ============================== 2. bank_reconcile_match_groups ============================== */
-- 1 แถว = 1 กลุ่มที่กระทบยอดสำเร็จ (ทั้งแบบอัตโนมัติและจับคู่เอง) — ต้องสร้างตารางนี้ก่อน bank_rows/gl_rows
-- เสมอ เพราะสองตารางนั้นอ้างอิง id ของตารางนี้ผ่าน match_group_id
create table if not exists public.bank_reconcile_match_groups (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bank_reconcile_reports (id) on delete cascade,
  match_type text not null check (match_type in ('auto', 'manual')),
  type text not null check (type in ('receive', 'payment')),
  created_at timestamptz not null default now()
);

create index if not exists bank_reconcile_match_groups_report_id_idx
  on public.bank_reconcile_match_groups (report_id);

alter table public.bank_reconcile_match_groups enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_match_groups;
create policy "authenticated_select" on public.bank_reconcile_match_groups
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.bank_reconcile_match_groups;
create policy "authenticated_insert" on public.bank_reconcile_match_groups
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.bank_reconcile_match_groups;
create policy "authenticated_update" on public.bank_reconcile_match_groups
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.bank_reconcile_match_groups;
create policy "authenticated_delete" on public.bank_reconcile_match_groups
  for delete
  to authenticated
  using (true);

/* ============================== 3. bank_reconcile_bank_rows ============================== */
-- 1 แถว = 1 รายการ Bank Statement ที่ถูกบันทึกไว้ (ทั้งที่จับคู่แล้วและยังไม่จับคู่) — match_group_id เป็น
-- null หมายถึง "ยังไม่จับคู่" โดยตรง ไม่ต้องมีตาราง "unmatched" แยกต่างหากเลย (สถานะจับคู่/ไม่จับคู่ derive
-- จากคอลัมน์นี้เพียงคอลัมน์เดียวเสมอ)
create table if not exists public.bank_reconcile_bank_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bank_reconcile_reports (id) on delete cascade,
  match_group_id uuid references public.bank_reconcile_match_groups (id) on delete set null,
  -- ตำแหน่งเดิมในไฟล์ที่อัปโหลด (หรือลำดับตอนบันทึกครั้งล่าสุดถ้าโหลดจากประวัติมาแก้ไขต่อ) — เก็บไว้เพื่อให้
  -- กด "ตรวจสอบข้อมูล" ซ้ำหลัง reopen แล้วอัลกอริทึมอัตโนมัติ tie-break เหมือนเดิมทุกประการ
  row_order integer not null,
  transaction_date date not null,
  type text not null check (type in ('receive', 'payment')),
  amount numeric(14, 2) not null check (amount >= 0)
);

create index if not exists bank_reconcile_bank_rows_report_id_idx on public.bank_reconcile_bank_rows (report_id);
create index if not exists bank_reconcile_bank_rows_match_group_id_idx on public.bank_reconcile_bank_rows (match_group_id);

alter table public.bank_reconcile_bank_rows enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_bank_rows;
create policy "authenticated_select" on public.bank_reconcile_bank_rows
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.bank_reconcile_bank_rows;
create policy "authenticated_insert" on public.bank_reconcile_bank_rows
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.bank_reconcile_bank_rows;
create policy "authenticated_update" on public.bank_reconcile_bank_rows
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.bank_reconcile_bank_rows;
create policy "authenticated_delete" on public.bank_reconcile_bank_rows
  for delete
  to authenticated
  using (true);

/* ============================== 4. bank_reconcile_gl_rows ============================== */
-- เหมือน bank_rows ทุกประการ บวกคอลัมน์ document_no (เลขที่เอกสาร GL)
create table if not exists public.bank_reconcile_gl_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bank_reconcile_reports (id) on delete cascade,
  match_group_id uuid references public.bank_reconcile_match_groups (id) on delete set null,
  row_order integer not null,
  document_no text not null default '',
  transaction_date date not null,
  type text not null check (type in ('receive', 'payment')),
  amount numeric(14, 2) not null check (amount >= 0)
);

create index if not exists bank_reconcile_gl_rows_report_id_idx on public.bank_reconcile_gl_rows (report_id);
create index if not exists bank_reconcile_gl_rows_match_group_id_idx on public.bank_reconcile_gl_rows (match_group_id);

alter table public.bank_reconcile_gl_rows enable row level security;

drop policy if exists "authenticated_select" on public.bank_reconcile_gl_rows;
create policy "authenticated_select" on public.bank_reconcile_gl_rows
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated_insert" on public.bank_reconcile_gl_rows;
create policy "authenticated_insert" on public.bank_reconcile_gl_rows
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated_update" on public.bank_reconcile_gl_rows;
create policy "authenticated_update" on public.bank_reconcile_gl_rows
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_delete" on public.bank_reconcile_gl_rows;
create policy "authenticated_delete" on public.bank_reconcile_gl_rows
  for delete
  to authenticated
  using (true);

/* ============================== ฟังก์ชันบันทึกแบบ atomic ============================== */
-- เหตุผลเดียวกับทุกฟีเจอร์อื่นในระบบนี้ที่ต้องเขียนหลายตารางพร้อมกัน: Supabase JS client (PostgREST) ไม่
-- รองรับ transaction ข้ามหลายตารางจากฝั่ง client โดยตรง (แต่ละ .from() เป็นคนละ HTTP request) จึงรวมการเขียน
-- report + match_groups + bank_rows + gl_rows ทั้งหมดไว้ใน Postgres function เดียว เรียกผ่าน supabase.rpc(...)
-- ครั้งเดียว (ดู lib/bankReconcileReportApi.ts) รันในหนึ่งธุรกรรมโดยธรรมชาติของ Postgres เสมอ — exception
-- ใดๆ ระหว่างทางทำให้ทุกอย่างถูก rollback อัตโนมัติทั้งหมด ไม่มีทางเหลือข้อมูลครึ่งๆ กลางๆ ได้เลย
--
-- กลยุทธ์: "แทนที่ทั้งหมด" (full-snapshot replace) เสมอเมื่อบันทึกทับรายการเดิม — ลบ match_groups/bank_rows/
-- gl_rows เดิมของ report นั้นทั้งหมดก่อน แล้วแทรกชุดข้อมูลปัจจุบันทั้งหมดใหม่ ไม่ diff/upsert ทีละแถว (ข้อมูล
-- ในหน่วยความจำฝั่ง client ตอนกดบันทึกคือ "ภาพรวมล่าสุดที่ถูกต้องเสมอ" อยู่แล้ว ไม่ต้องเทียบว่าอะไรเปลี่ยน)
--
-- ต่างจากแนวทางนี้ในฟีเจอร์อื่น: match_groups.id ต้องใช้ uuid ที่ฝั่ง client ส่งมาตรงๆ (ไม่ปล่อยให้
-- gen_random_uuid() default สร้างใหม่) เพราะ bank_rows/gl_rows ต้องอ้างอิง match_group_id กลับไปหา group
-- เดียวกันภายใน insert ชุดเดียวกันนี้เอง — ฝั่ง client (createManualMatchGroup / wrapAutoMatchesAsGroups ใน
-- lib/bankReconcileManualMatch.ts) สร้าง id ด้วย crypto.randomUUID() ไว้ล่วงหน้าตั้งแต่ตอนจับคู่อยู่แล้ว จึง
-- ไม่ต้องทำ mapping table ระหว่าง id ชั่วคราวกับ id จริงหลัง insert เหมือนที่ต้องทำถ้าปล่อยให้ฐานข้อมูลสร้าง
-- id เอง
create or replace function public.save_bank_reconcile_report(
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
      report_name, period_month, period_year, status, bank_file_name, gl_file_name, tolerance_days,
      bank_row_count, gl_row_count, matched_group_count, bank_unmatched_count, gl_unmatched_count,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
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
      raise exception 'ไม่พบรายการกระทบยอด id=%', v_report_id;
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

revoke all on function public.save_bank_reconcile_report(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_bank_reconcile_report(jsonb, jsonb, jsonb, jsonb) to authenticated;
