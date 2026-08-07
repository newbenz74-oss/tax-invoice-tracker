-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 008: เปิดให้สร้างบริษัทใหม่เองได้จากหน้าเว็บ (self-service) แทนที่จะต้องผ่าน SQL editor ทุกครั้ง
-- (เดิม migration_007 ตั้งใจปิด insert ทั้งหมดของ companies/company_members ไว้ก่อน ตอนนี้ผู้ใช้ยืนยันแล้วว่า
-- อยากให้สมาชิกที่ login เข้ามาสร้างบริษัทใหม่เองได้ ไม่ต้องรอแอดมิน)
--
-- แนวทาง: เพิ่ม RPC create_company(p_name) เป็น security invoker (ตามธรรมเนียมเดิมของโปรเจกต์นี้ทั้งหมด ดู
-- is_company_member()/save_bank_reconcile_report() ใน migration_007) — insert 2 แถว (companies + company_members
-- ผูกตัวเองเป็นสมาชิกทันที) ในทรานแซกชันเดียว ต้องมี RLS insert policy รองรับทั้ง 2 ตารางด้วย เพราะเป็น
-- security invoker (รันผ่าน RLS ของผู้เรียกเองเสมอ ไม่ bypass)
--
-- ขอบเขตสิทธิ์: ใครก็ตามที่ login เข้าระบบได้ (authenticated) สร้างบริษัทใหม่ได้เสมอ และจะกลายเป็นสมาชิกของ
-- บริษัทที่ตัวเองสร้างโดยอัตโนมัติ — ยังไม่มีสิทธิ์เพิ่ม/ลบสมาชิกคนอื่นเข้าบริษัทที่มีอยู่แล้วจากหน้าเว็บ (ยังต้อง
-- ผ่าน SQL editor เหมือนเดิม อันนี้เป็นแค่ "สร้างบริษัทใหม่" อย่างเดียว)

/* ============================== 1. RLS insert policy: companies ============================== */
drop policy if exists "insert_own_company" on public.companies;
create policy "insert_own_company" on public.companies
  for insert
  to authenticated
  with check (true);

/* ============================== 2. RLS insert policy: company_members ======================= */
-- ผู้ใช้เพิ่มตัวเองเข้าเป็นสมาชิกได้เท่านั้น (user_id ต้องตรงกับ auth.uid() ของคนที่เรียก) ป้องกันไม่ให้ใคร
-- เผลอ/แกล้งเพิ่มคนอื่นเข้าบริษัทผ่านทางนี้
drop policy if exists "insert_own_membership" on public.company_members;
create policy "insert_own_membership" on public.company_members
  for insert
  to authenticated
  with check (user_id = auth.uid());

/* ============================== 3. RPC: create_company ======================================= */
create or replace function public.create_company(p_name text)
returns public.companies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_result public.companies;
begin
  if v_name = '' then
    raise exception 'กรุณาระบุชื่อบริษัท';
  end if;

  insert into public.companies (name)
  values (v_name)
  returning * into v_result;

  insert into public.company_members (company_id, user_id)
  values (v_result.id, auth.uid());

  return v_result;
end;
$$;

revoke all on function public.create_company(text) from public;
grant execute on function public.create_company(text) to authenticated;
