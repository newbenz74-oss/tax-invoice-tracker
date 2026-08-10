-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 011: จำกัดสิทธิ์อนุมัติสมาชิกใหม่ให้เฉพาะบัญชีแอดมิน (Ben) เท่านั้น
--
-- เดิม (migration_010) ออกแบบให้สมาชิกบริษัทคนไหนก็อนุมัติคนใหม่เข้าบริษัทของตัวเองได้เหมือนกันหมด ตามดีไซน์
-- "ทุกคนสิทธิ์เท่ากัน ไม่มี role" ที่ใช้ทั้งระบบ — ผู้ใช้ (Ben) ระบุชัดเจนภายหลังว่าอยากให้เฉพาะบัญชีของตัวเอง
-- เท่านั้นที่อนุมัติได้ ("เพื่อไม่ให้อนุมัติโดยที่ฉันไม่ได้อนุญาต") จึงเป็นจุดแรกในระบบที่มีสิทธิ์ระดับ "แอดมิน"
-- แยกออกมาจริงๆ — ระบุตัวตนด้วย user id ตรงๆ (เสถียรกว่า email เพราะแก้ไขไม่ได้) เดียวกับที่ฝั่ง client ใช้ใน
-- lib/adminAccess.ts (ต้องแก้ทั้ง 2 จุดพร้อมกันเสมอถ้าจะเปลี่ยนตัวแอดมินในอนาคต)
--
-- เปลี่ยน list_pending_users() และ approve_member() จากเช็ค "เป็นสมาชิกบริษัทใดก็ได้อย่างน้อย 1 บริษัท" เป็น
-- เช็ค "เป็นบัญชีแอดมินที่ระบุไว้ตรงๆ เท่านั้น" — โครงสร้างอื่นๆ ทั้งหมด (security definer, การเช็ค auth.uid()
-- เป็น null สำหรับ anon, การ revoke จาก anon) เหมือนเดิมทุกประการ ไม่เปลี่ยน
create or replace function public.list_pending_users()
returns table (id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from '6d608f39-0240-4088-b086-6d10b36ec478'::uuid then
    raise exception 'ไม่มีสิทธิ์เข้าถึงรายชื่อนี้ — เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  return query
    select u.id, u.email::text, u.created_at
    from auth.users u
    where not exists (
      select 1 from public.company_members m where m.user_id = u.id
    )
    order by u.created_at asc;
end;
$$;

create or replace function public.approve_member(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from '6d608f39-0240-4088-b086-6d10b36ec478'::uuid then
    raise exception 'ไม่มีสิทธิ์อนุมัติสมาชิก — เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  if not exists (
    select 1 from public.company_members
    where user_id = auth.uid() and company_id = p_company_id
  ) then
    raise exception 'คุณไม่ใช่สมาชิกของบริษัทนี้ ไม่มีสิทธิ์อนุมัติคนเข้าบริษัทนี้';
  end if;

  insert into public.company_members (company_id, user_id)
  values (p_company_id, p_user_id)
  on conflict (company_id, user_id) do nothing;
end;
$$;
