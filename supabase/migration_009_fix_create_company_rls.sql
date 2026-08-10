-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 009: แก้บั๊ก create_company() ชนกับ RLS ตอนใช้ RETURNING
--
-- ปัญหา: migration_008 เขียน create_company() แบบ "insert into companies ... returning * into v_result"
-- แต่ Postgres RLS จะเช็ค SELECT policy ของตารางด้วยทุกครั้งที่มี RETURNING clause (ไม่ใช่แค่ WITH CHECK ของ
-- INSERT) — ตอนที่ statement นี้รัน ผู้เรียกยังไม่ได้เป็นสมาชิกของบริษัทที่เพิ่ง insert เลย (แถว company_members
-- ยังไม่ถูกสร้าง จะสร้างใน statement ถัดไป) ทำให้ select_member_companies policy (is_company_member(id)) ไม่ผ่าน
-- แล้ว Postgres โยน error "new row violates row-level security policy for table companies" ทันที ทั้งที่
-- WITH CHECK ของ insert_own_company (with check (true)) ผ่านสบายๆ — ยืนยันด้วยการทดสอบจริงผ่าน execute_sql
-- โดย impersonate role authenticated: insert ธรรมดาไม่มี returning ผ่าน, insert ... returning ไม่ผ่าน
--
-- วิธีแก้: กำหนด id เองล่วงหน้าด้วย gen_random_uuid() แทนการพึ่ง returning จาก insert แรก — insert บริษัทโดย
-- ไม่มี returning เลย (ไม่ชน SELECT policy เพราะไม่มีการอ่านค่ากลับ) ตามด้วย insert สมาชิกตัวเอง (ตอนนี้เป็น
-- สมาชิกแล้ว) แล้วค่อย select แถวบริษัทกลับมาทีหลังสุด (ตอนนี้ is_company_member(id) เป็นจริงแล้ว select
-- policy จึงผ่านปกติ)

create or replace function public.create_company(p_name text)
returns public.companies
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid := gen_random_uuid();
  v_result public.companies;
begin
  if v_name = '' then
    raise exception 'กรุณาระบุชื่อบริษัท';
  end if;

  insert into public.companies (id, name)
  values (v_id, v_name);

  insert into public.company_members (company_id, user_id)
  values (v_id, auth.uid());

  select * into v_result from public.companies where id = v_id;
  return v_result;
end;
$$;

revoke all on function public.create_company(text) from public;
grant execute on function public.create_company(text) to authenticated;
