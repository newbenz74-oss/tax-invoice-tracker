-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 010: ระบบอนุมัติสมาชิกใหม่ (Option B ที่ผู้ใช้เลือก — เปิดให้สมัครสมาชิกเองได้ตามเดิมที่หน้า
-- login แต่บัญชีใหม่จะใช้งานอะไรไม่ได้จนกว่าจะมีสมาชิกบริษัทที่มีอยู่แล้วคนใดคนหนึ่งอนุมัติให้เข้าบริษัทนั้น)
--
-- ส่วนที่ 1: ปิดช่องโหว่จาก migration_008/009 — policy "insert_own_membership" เดิมเช็คแค่ "ผูกตัวเองเท่านั้น"
-- (user_id = auth.uid()) แต่ไม่ได้เช็คว่า company_id ที่จะผูกเข้าไปเป็นบริษัทที่เพิ่งสร้างใหม่จริงหรือเปล่า —
-- ในทางทฤษฎีถ้าใครก็ตามที่ login ได้ (รวมถึงคนที่เพิ่งสมัครเองแล้วยังไม่ได้รับอนุมัติ) รู้ UUID ของบริษัทที่มี
-- อยู่แล้ว จะเรียก insert ตรงเข้า company_members ผูกตัวเองเข้าบริษัทนั้นได้เลยโดยไม่ต้องรอใครอนุมัติ (ยากที่จะ
-- เดา UUID ได้ก็จริง แต่ไม่ควรปล่อยเป็นช่องโหว่ทิ้งไว้) — แก้โดยจำกัดให้ self-insert ทำได้เฉพาะตอนบริษัทนั้น
-- "ยังไม่มีสมาชิกเลย" เท่านั้น (คือกรณีเพิ่งสร้างบริษัทใหม่ผ่าน create_company() เท่านั้น) การเพิ่มสมาชิกเข้า
-- บริษัทที่มีสมาชิกอยู่แล้วต้องผ่าน RPC approve_member() ด้านล่างเท่านั้นนับจากนี้
--
-- หมายเหตุสำคัญ (พบระหว่างทดสอบด้วย impersonate จริง ก่อนจะยืนยันไฟล์นี้): เขียนแบบ "not exists (select 1
-- from company_members existing where existing.company_id = ...)" ตรงๆ ใน with_check ไม่ได้ผล เพราะ subquery
-- ที่อ้างอิงตาราง company_members ซ้ำแบบนี้ก็ยังถูกกรองด้วย policy select_own_membership (user_id = auth.uid())
-- เหมือนกัน — เห็นแค่แถวของ "ตัวเอง" เท่านั้น ไม่เห็นแถวของสมาชิกคนอื่นในบริษัทเดียวกันเลย ทำให้เช็ค "บริษัทนี้
-- มีสมาชิกอยู่แล้วหรือยัง" เป็นเท็จเสมอสำหรับทุกกรณี self-join ใหม่ (ช่องโหว่เดิมไม่ถูกปิดจริง) ต้องห่อการเช็คนี้
-- เป็น security definer function แยกต่างหาก (company_has_members ด้านล่าง) เพื่อ bypass RLS ให้เห็นทุกแถวจริง
create or replace function public.company_has_members(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = target_company_id
  );
$$;

revoke all on function public.company_has_members(uuid) from public;
grant execute on function public.company_has_members(uuid) to authenticated;
revoke execute on function public.company_has_members(uuid) from anon;

drop policy if exists "insert_own_membership" on public.company_members;
create policy "insert_own_membership" on public.company_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and not public.company_has_members(company_id)
  );

-- ส่วนที่ 2: list_pending_users() — คืนรายชื่อ auth.users ที่ยังไม่มีแถวใน company_members เลย (สมัครแล้วแต่
-- ยังไม่ได้รับอนุมัติเข้าบริษัทไหน) ต้องเป็น security definer เพราะ client role (authenticated) ไม่มีสิทธิ์
-- อ่าน auth.users ตรงๆ ผ่าน PostgREST อยู่แล้วโดยดีไซน์ของ Supabase — ป้องกันการเรียกโดยไม่มีสิทธิ์ด้วยการเช็ค
-- ในฟังก์ชันเองว่าผู้เรียกต้องเป็นสมาชิกบริษัทอย่างน้อย 1 บริษัทอยู่แล้ว (คือ "ผ่านการอนุมัติมาแล้วอย่างน้อย
-- ครั้งหนึ่ง") ถึงจะดูรายชื่อคนรออนุมัติคนอื่นได้ — สอดคล้องกับดีไซน์เดิมที่ทุกคนในบริษัทเดียวกันมีสิทธิ์เท่ากัน
-- ไม่มีระดับ role แยก (ใครก็ตามที่เป็นสมาชิกบริษัทอยู่แล้วอนุมัติคนใหม่ได้เหมือนกันหมด ไม่ใช่แค่ Ben คนเดียว)
create or replace function public.list_pending_users()
returns table (id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.company_members where user_id = auth.uid()) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงรายชื่อนี้ — ต้องเป็นสมาชิกบริษัทอย่างน้อย 1 บริษัทก่อน';
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

revoke all on function public.list_pending_users() from public;
grant execute on function public.list_pending_users() to authenticated;
-- หมายเหตุ: "revoke all from public" ไม่ได้ปิดสิทธิ์ role anon โดยอัตโนมัติ เพราะ Supabase ตั้ง default
-- privilege ของ schema public ไว้ให้ทุกฟังก์ชันใหม่ถูก grant execute ให้ anon+authenticated ตั้งแต่ตอน
-- สร้างอยู่แล้ว (คนละกลไกกับ PUBLIC pseudo-role) ต้อง revoke จาก anon ตรงๆ อีกทีเสมอสำหรับฟังก์ชัน
-- security definer ที่ไม่อยากให้คนไม่ login เรียกได้เลยแม้แต่ทางเทคนิค (ตรวจพบจาก Supabase security
-- advisor หลัง apply migration นี้ครั้งแรก — ฟังก์ชันข้างในเช็ค auth.uid() เป็น null อยู่แล้วเลยไม่มีทางเข้าถึง
-- ข้อมูลจริงได้ แต่ปิดที่ชั้น grant ด้วยเพื่อความรัดกุม ไม่ต้องพึ่ง logic ภายในฟังก์ชันอย่างเดียว)
revoke execute on function public.list_pending_users() from anon;

-- ส่วนที่ 3: approve_member() — เพิ่มคนอื่น (ไม่ใช่ตัวเอง) เข้าเป็นสมาชิกบริษัทที่มีอยู่แล้ว ต้องเป็น security
-- definer เพราะ RLS ปกติของ company_members (ส่วนที่ 1 ด้านบน) ไม่อนุญาตให้ insert แถวของคนอื่นเลย — ฟังก์ชัน
-- นี้เช็คสิทธิ์เองแทน RLS: ผู้เรียกต้องเป็นสมาชิกของ "บริษัทเป้าหมาย" (p_company_id) อยู่แล้วเท่านั้น ถึงจะเพิ่ม
-- คนใหม่เข้าบริษัทนั้นได้ — กันไม่ให้ใครก็ได้ (แม้จะเป็นสมาชิกบริษัทอื่นอยู่แล้ว) ไปอนุมัติคนเข้าบริษัทที่ตัวเอง
-- ไม่มีส่วนเกี่ยวข้องด้วย
create or replace function public.approve_member(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke all on function public.approve_member(uuid, uuid) from public;
grant execute on function public.approve_member(uuid, uuid) to authenticated;
revoke execute on function public.approve_member(uuid, uuid) from anon;
