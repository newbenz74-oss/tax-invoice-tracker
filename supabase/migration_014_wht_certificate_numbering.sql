-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 014: ระบบรันเลขที่ใบหัก ณ ที่จ่าย (พื้นฐานที่สองของฟีเจอร์ "ออกใบหัก ณ ที่จ่าย")
--
-- ผู้ใช้ระบุรูปแบบเลขที่ชัดเจน: {รหัสฟอร์ม}-{ปี พ.ศ. 2 หลักท้าย}{เดือน 2 หลัก}{ลำดับ 3 หลัก} เช่น
-- "53-6908001" (นิติบุคคล เดือน 8 ปี 2569 ลำดับที่ 1) — รหัสฟอร์ม "53" ใช้กับผู้ถูกหักที่เป็นนิติบุคคล (คู่กับ
-- แบบ ภ.ง.ด.53) และ "03" ใช้กับผู้ถูกหักที่เป็นบุคคลธรรมดา (คู่กับแบบ ภ.ง.ด.3) — ลำดับรีเซ็ตกลับเป็น 1 ทุก
-- ต้นเดือน แยกนับของฟอร์ม 53 กับ 03 คนละชุดกัน (ตามที่ผู้ใช้ยืนยัน) จึงต้องมีตัวนับแยกต่างหากต่อ
-- (บริษัท, รหัสฟอร์ม, ปี, เดือน) — ไม่ใช้วิธี "นับจากจำนวนใบที่ออกไปแล้ว" (select count(*)+1) เพราะเสี่ยง
-- race condition ถ้าออกใบพร้อมกัน 2 คน และจะมีปัญหาถ้าอนาคตมีฟีเจอร์ยกเลิก/ลบใบ (เลขจะไม่ต่อเนื่อง/ซ้ำได้)
-- จึงใช้ตารางตัวนับแยก + atomic upsert (insert ... on conflict do update ... returning) แทน ปลอดภัยกับการ
-- เรียกพร้อมกันหลายคนโดยธรรมชาติของ Postgres row lock ไม่ต้องพึ่ง SECURITY DEFINER หรือ advisory lock เพิ่ม
--
-- ยังไม่มี UI เรียกใช้ RPC นี้ในรอบนี้ (แค่วางระบบเลขที่ไว้ก่อนตามที่ผู้ใช้ระบุ "เริ่มจาก 1-2 ไปเลย" — ข้อ 3-6
-- ของแผนคือ UI ออกใบ/PDF/หน้าประวัติ จะทำในรอบถัดไป)
create table public.wht_certificate_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  form_type text not null check (form_type in ('53', '03')),
  period_year smallint not null check (period_year between 2500 and 2700),
  period_month smallint not null check (period_month between 1 and 12),
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, form_type, period_year, period_month)
);

comment on table public.wht_certificate_counters is
  'ตัวนับลำดับเลขที่ใบหัก ณ ที่จ่าย แยกต่อ (บริษัท, รหัสฟอร์ม 53/03, ปี พ.ศ., เดือน) รีเซ็ตกลับเป็น 1 ทุกต้นเดือนโดยธรรมชาติ (แต่ละเดือนมีแถวของตัวเอง)';

alter table public.wht_certificate_counters enable row level security;

create policy "select_own_counters" on public.wht_certificate_counters
  for select
  using (public.is_company_member(company_id));

create policy "insert_own_counters" on public.wht_certificate_counters
  for insert
  with check (public.is_company_member(company_id));

create policy "update_own_counters" on public.wht_certificate_counters
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ฟังก์ชัน "ขอเลขถัดไป" แบบ atomic — SECURITY INVOKER (ค่าเริ่มต้น ไม่ต้องใช้ SECURITY DEFINER เหมือน
-- create_company/approve_member เพราะไม่มีปัญหา RLS ซับซ้อนแบบนั้น: insert/update ตรงๆ ผ่าน RLS ปกติของ
-- ผู้เรียกเองก็เพียงพอแล้ว) เช็ค is_company_member() ซ้ำอีกชั้นในฟังก์ชันเพื่อให้ error message เป็นภาษาไทย
-- อ่านง่าย แทนที่จะปล่อยให้ RLS บล็อกเงียบๆ (0 แถว ไม่มี error ชัดเจน) เหมือนที่ approve_member/
-- list_pending_users ทำไว้
create or replace function public.get_next_wht_cert_number(
  p_company_id uuid,
  p_form_type text,
  p_period_year smallint,
  p_period_month smallint
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'คุณไม่ใช่สมาชิกของบริษัทนี้ ไม่มีสิทธิ์ขอเลขที่ใบหัก ณ ที่จ่าย';
  end if;

  if p_form_type not in ('53', '03') then
    raise exception 'รหัสฟอร์มไม่ถูกต้อง ต้องเป็น 53 หรือ 03 เท่านั้น';
  end if;

  insert into public.wht_certificate_counters (company_id, form_type, period_year, period_month, last_number)
  values (p_company_id, p_form_type, p_period_year, p_period_month, 1)
  on conflict (company_id, form_type, period_year, period_month)
  do update set last_number = public.wht_certificate_counters.last_number + 1, updated_at = now()
  returning last_number into v_next;

  return v_next;
end;
$$;

revoke all on function public.get_next_wht_cert_number(uuid, text, smallint, smallint) from public;
grant execute on function public.get_next_wht_cert_number(uuid, text, smallint, smallint) to authenticated;
revoke execute on function public.get_next_wht_cert_number(uuid, text, smallint, smallint) from anon;
