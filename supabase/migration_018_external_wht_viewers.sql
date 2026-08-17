-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 018: ระบบ "ผู้ใช้ภายนอกดูใบหัก ณ ที่จ่าย" (เพิ่มเข้ามา 2026-08-15 ตามคำขอผู้ใช้)
--
-- บริบท: เว็บนี้เป็นระบบภายในของทีมบัญชี ไม่อนุญาตให้คนนอกเข้าสู่ระบบปกติ (/login) แต่ผู้ใช้ (Ben) ต้องการ
-- แยกช่องทางให้ "บุคคลภายนอก" (ส่วนมากเป็นพนักงานที่ไม่ใช่ฝ่ายบัญชีของบริษัทลูกค้า ไม่ใช่พนักงานบัญชีเอง)
-- สมัครสมาชิกเองด้วยอีเมล/รหัสผ่านปกติ (ไม่ใช่จับคู่ด้วยเลขผู้เสียภาษี — ผู้ใช้ปฏิเสธแนวทางนั้นชัดเจน) ผ่านหน้า
-- ล็อกอินแยกต่างหาก (/external/login) แล้วเข้าไปดู/ดาวน์โหลดใบหัก ณ ที่จ่ายของบริษัทที่ Ben อนุญาตเป็นรายบริษัท
-- ได้ — คนละแนวคิดกับ "อนุมัติสมาชิกใหม่" ภายใน (migration_010/011) ที่อนุมัติแล้วเข้าบริษัทได้ทุกฟีเจอร์เท่า
-- เทียมกับสมาชิกคนอื่น เพราะที่นี่ต้องการ "มองเห็นได้แค่ใบหัก ณ ที่จ่าย" ของบริษัทที่ระบุเท่านั้น (ไม่ใช่ทุก
-- ฟีเจอร์ของบริษัทนั้น) และ Ben ต้องเลือกเองว่าบริษัทไหนที่ผู้ใช้ภายนอกคนนั้นเห็นได้ — เพิ่ม/ถอนสิทธิ์รายบริษัท
-- ได้ตลอดเวลาแม้อนุมัติไปแล้ว ("อยากให้มีการถอนสิทธิหรือยกเลิกไม่ให้เห็นได้หรือเพิ่มสิทธิ์บริษัทเข้าไปได้")
--
-- ออกแบบ "รอการอนุมัติ" แบบเดียวกับ company_members เดิม (ไม่มีคอลัมน์ status แยก) — สมัครผ่านหน้า
-- /external/login แล้ว client จะ insert แถวตัวเองเข้า external_wht_viewers ทันที (ผ่าน RLS insert_own ด้านล่าง
-- นี้) เป็นการ "ประกาศตัว" ว่าสมัครผ่านช่องทางภายนอก ไม่ใช่ทาง /login ปกติ — ยังไม่เห็นข้อมูลอะไรทั้งนั้นจนกว่า
-- Ben จะให้สิทธิ์บริษัทอย่างน้อย 1 บริษัทผ่าน grant_external_wht_viewer_company() ด้านล่าง (การให้สิทธิ์ครั้ง
-- แรกก็คือ "การอนุมัติ" ในตัวเอง ไม่ต้องมี RPC approve แยกต่างหากอีกฟังก์ชัน)
--
-- สำคัญมาก: ต้องแก้ list_pending_users() (เดิมจาก migration_011) ให้ตัดคนที่สมัครผ่านช่องทางภายนอกออกจาก
-- รายชื่อ "รออนุมัติสมาชิกภายใน" ด้วย — ไม่งั้นคนที่สมัคร /external/login จะไปปนอยู่ในหน้า "อนุมัติสมาชิกใหม่"
-- (ManageMembersPage.tsx) เสี่ยงถูกอนุมัติเข้าเป็นสมาชิกภายในเต็มรูปแบบโดยไม่ได้ตั้งใจ (เห็นได้ทุกบริษัท/ทุก
-- ฟีเจอร์) ซึ่งผิดเจตนาเดิมของฟีเจอร์นี้โดยสิ้นเชิง

-- ส่วนที่ 1: ตาราง external_wht_viewers — แค่ "ประกาศตัว" ว่า user คนนี้สมัครผ่านช่องทางภายนอก (ไม่มีข้อมูล
-- อื่นนอกจาก user_id/created_at) แยกจาก company_members โดยสิ้นเชิง — 1 แถวต่อ 1 auth user เท่านั้น ผูกกับ
-- auth.users ตรงๆ (on delete cascade — ถ้าลบบัญชีผู้ใช้ทิ้ง แถวนี้และสิทธิ์บริษัททั้งหมดหายไปด้วยอัตโนมัติ)
create table public.external_wht_viewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.external_wht_viewers is 'รายชื่อผู้ใช้ที่สมัครผ่านช่องทางภายนอก (/external/login) — แถวในตารางนี้แค่บอกว่า "สมัครผ่านช่องทางนี้" เท่านั้น ยังไม่มีสิทธิ์เห็นข้อมูลอะไรจนกว่าจะมีแถวใน external_wht_viewer_companies อย่างน้อย 1 แถว';

alter table public.external_wht_viewers enable row level security;

-- ตัวเองสมัคร (insert แถวตัวเอง) ได้ทันทีหลัง auth.signUp() สำเร็จ — ไม่ต้องผ่าน RPC เพราะเป็นแค่การ
-- "ประกาศตัว" ไม่กระทบสิทธิ์เข้าถึงข้อมูลอะไรเลยในขั้นตอนนี้ (ต้องรอ Ben grant บริษัทก่อนถึงจะเห็นอะไรได้จริง)
create policy "insert_own_external_viewer" on public.external_wht_viewers
  for insert
  with check (user_id = auth.uid());

-- ให้ตัวเองเช็คสถานะ "รออนุมัติอยู่หรือยัง" ได้ (หน้า /external/pending ใช้เช็คว่ามีแถวตัวเองไหม)
create policy "select_own_external_viewer" on public.external_wht_viewers
  for select
  using (user_id = auth.uid());

-- ส่วนที่ 2: ตาราง external_wht_viewer_companies — ตารางเชื่อม many-to-many ว่า external viewer คนไหนเห็น
-- ใบหัก ณ ที่จ่ายของบริษัทไหนได้บ้าง (เห็นได้ "ทุกใบของบริษัทนั้น" ไม่ใช่กรองเฉพาะใบของตัวเอง — ยืนยันกับ
-- ผู้ใช้แล้วว่านี่คือพฤติกรรมที่ต้องการ เพราะคนที่ได้สิทธิ์ส่วนมากเป็นพนักงานที่ไม่ใช่ฝ่ายบัญชีของบริษัทลูกค้า
-- ต้องการเห็นภาพรวมใบหักทั้งหมดของบริษัทตัวเอง ไม่ใช่แค่ใบที่เกี่ยวกับตัวเอง) granted_by เก็บไว้เป็นข้อมูล
-- ตรวจสอบย้อนหลังเฉยๆ (audit trail) ไม่ได้ใช้ในตรรกะสิทธิ์ใดๆ
create table public.external_wht_viewer_companies (
  user_id uuid not null references public.external_wht_viewers(user_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  primary key (user_id, company_id)
);

comment on table public.external_wht_viewer_companies is 'สิทธิ์รายบริษัทของผู้ใช้ภายนอก — มีแถว = เห็นใบหัก ณ ที่จ่ายทุกใบของบริษัทนั้นได้ (บริษัทเดียวกันทั้งบริษัท ไม่กรองเฉพาะของตัวเอง) ลบแถว = ถอนสิทธิ์ทันที';

alter table public.external_wht_viewer_companies enable row level security;

-- ให้ external viewer อ่านสิทธิ์บริษัทของตัวเองได้ (หน้า /external/dashboard ใช้แสดงรายชื่อบริษัทที่เลือกดูได้)
-- ไม่มี policy insert/update/delete ให้ client เลย — เพิ่ม/ถอนสิทธิ์ทำได้เฉพาะผ่าน RPC
-- grant_external_wht_viewer_company()/revoke_external_wht_viewer_company() ด้านล่าง (security definer, เช็ค
-- สิทธิ์แอดมินเองภายในฟังก์ชัน) เท่านั้น
create policy "select_own_external_grants" on public.external_wht_viewer_companies
  for select
  using (user_id = auth.uid());

-- ส่วนที่ 3: is_external_wht_viewer() — helper function เช็คว่าผู้เรียกปัจจุบันมีสิทธิ์เห็นบริษัทนี้ผ่านช่อง
-- ทางภายนอกหรือไม่ ยึด pattern เดียวกับ is_company_member() ทุกประการ (plain STABLE SQL ไม่ใช่ SECURITY
-- DEFINER — ทำงานได้เพราะ policy "select_own_external_grants" ด้านบนอนุญาตให้เช็คแถวของตัวเองได้อยู่แล้ว)
create or replace function public.is_external_wht_viewer(target_company_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.external_wht_viewer_companies c
    where c.company_id = target_company_id and c.user_id = auth.uid()
  );
$$;

revoke all on function public.is_external_wht_viewer(uuid) from public;
grant execute on function public.is_external_wht_viewer(uuid) to authenticated;
revoke execute on function public.is_external_wht_viewer(uuid) from anon;

-- ส่วนที่ 4: ขยาย policy "select_own_certificates" บน wht_certificates (เดิมจาก migration_015) ให้ external
-- viewer ที่ได้รับสิทธิ์บริษัทนั้นแล้วอ่านได้ด้วย — เพิ่มเงื่อนไข "หรือ" เข้าไปเท่านั้น ไม่แตะ insert/update
-- policy เดิม (ผู้ใช้ภายนอกไม่มีสิทธิ์สร้าง/แก้ไขใบหัก ณ ที่จ่ายใดๆ ทั้งสิ้น อ่านได้อย่างเดียว)
drop policy if exists "select_own_certificates" on public.wht_certificates;
create policy "select_own_certificates" on public.wht_certificates
  for select
  using (public.is_company_member(company_id) or public.is_external_wht_viewer(company_id));

-- ส่วนที่ 5: ขยาย policy "select_member_companies" บน companies (เดิมจาก migration_007) ให้ external viewer
-- อ่านชื่อ/โลโก้/ที่อยู่บริษัทที่ตัวเองได้รับสิทธิ์ได้ด้วย (หน้า /external/dashboard ต้องแสดงชื่อบริษัทได้)
-- ไม่แตะ insert/update policy เดิม (ผู้ใช้ภายนอกแก้ไขข้อมูลบริษัทไม่ได้)
drop policy if exists "select_member_companies" on public.companies;
create policy "select_member_companies" on public.companies
  for select
  using (public.is_company_member(id) or public.is_external_wht_viewer(id));

-- ส่วนที่ 6: RPC สำหรับแอดมิน (Ben เท่านั้น — ตรวจด้วย user id ตรงๆ แบบเดียวกับ list_pending_users()/
-- approve_member() ใน migration_011 ทุกประการ) จัดการผู้ใช้ภายนอกทั้งหมด — ต้อง security definer เพราะต้อง
-- อ่าน auth.users (หา email) และอ่านข้าม RLS ของผู้ใช้คนอื่น (ไม่ใช่แค่แถวตัวเอง)

-- list_pending_external_viewers(): คนที่สมัครผ่าน /external/login แล้ว (มีแถวใน external_wht_viewers) แต่
-- ยังไม่เคยได้รับสิทธิ์บริษัทไหนเลย (ยังไม่มีแถวใน external_wht_viewer_companies) — รอ Ben เลือกบริษัทให้
create or replace function public.list_pending_external_viewers()
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
    select u.id, u.email::text, v.created_at
    from public.external_wht_viewers v
    join auth.users u on u.id = v.user_id
    where not exists (
      select 1 from public.external_wht_viewer_companies c where c.user_id = v.user_id
    )
    order by v.created_at asc;
end;
$$;

revoke all on function public.list_pending_external_viewers() from public;
grant execute on function public.list_pending_external_viewers() to authenticated;
revoke execute on function public.list_pending_external_viewers() from anon;

-- list_approved_external_viewers(): คนที่ได้รับสิทธิ์อย่างน้อย 1 บริษัทแล้ว พร้อมรายชื่อบริษัททั้งหมดที่
-- เห็นได้ (คืนเป็นแถวเรียงตาม user — ฝั่ง client รวมกลุ่มเองตาม id) ใช้แสดง + จัดการ (เพิ่ม/ถอน) สิทธิ์ต่อ
create or replace function public.list_approved_external_viewers()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  company_id uuid,
  company_name text,
  granted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from '6d608f39-0240-4088-b086-6d10b36ec478'::uuid then
    raise exception 'ไม่มีสิทธิ์เข้าถึงรายชื่อนี้ — เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  return query
    select u.id, u.email::text, v.created_at, c.company_id, comp.name, c.granted_at
    from public.external_wht_viewers v
    join auth.users u on u.id = v.user_id
    join public.external_wht_viewer_companies c on c.user_id = v.user_id
    join public.companies comp on comp.id = c.company_id
    order by v.created_at asc, comp.name asc;
end;
$$;

revoke all on function public.list_approved_external_viewers() from public;
grant execute on function public.list_approved_external_viewers() to authenticated;
revoke execute on function public.list_approved_external_viewers() from anon;

-- grant_external_wht_viewer_company(): ให้สิทธิ์บริษัทเพิ่ม — ใช้ทั้งตอน "อนุมัติครั้งแรก" (ให้บริษัทแรก) และ
-- "เพิ่มสิทธิ์บริษัททีหลัง" กับคนที่อนุมัติไปแล้ว เป็น RPC เดียวกัน ไม่แยก approve/grant เพราะพฤติกรรมเหมือนกัน
-- ทุกประการ (insert แถวเดียวเข้า external_wht_viewer_companies) — เช็คว่า p_user_id ต้องสมัครผ่านช่องทาง
-- ภายนอกไว้แล้วจริง (มีแถวใน external_wht_viewers) กันเรียกผิดเข้ากับ user id ของสมาชิกภายในโดยไม่ตั้งใจ
create or replace function public.grant_external_wht_viewer_company(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from '6d608f39-0240-4088-b086-6d10b36ec478'::uuid then
    raise exception 'ไม่มีสิทธิ์ให้สิทธิ์ผู้ใช้ภายนอก — เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  if not exists (select 1 from public.external_wht_viewers where user_id = p_user_id) then
    raise exception 'ผู้ใช้นี้ไม่ได้สมัครผ่านช่องทางบุคคลภายนอก';
  end if;

  insert into public.external_wht_viewer_companies (user_id, company_id, granted_by)
  values (p_user_id, p_company_id, auth.uid())
  on conflict (user_id, company_id) do nothing;
end;
$$;

revoke all on function public.grant_external_wht_viewer_company(uuid, uuid) from public;
grant execute on function public.grant_external_wht_viewer_company(uuid, uuid) to authenticated;
revoke execute on function public.grant_external_wht_viewer_company(uuid, uuid) from anon;

-- revoke_external_wht_viewer_company(): ถอนสิทธิ์บริษัทเดียว (ไม่ลบแถว external_wht_viewers ตัวผู้ใช้เอง —
-- ถอนหมดทุกบริษัทแล้วยังสมัครสมาชิกค้างไว้ได้ เผื่อ Ben จะ grant บริษัทใหม่ให้ทีหลังอีกครั้งโดยไม่ต้องสมัครใหม่)
create or replace function public.revoke_external_wht_viewer_company(p_user_id uuid, p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from '6d608f39-0240-4088-b086-6d10b36ec478'::uuid then
    raise exception 'ไม่มีสิทธิ์ถอนสิทธิ์ผู้ใช้ภายนอก — เฉพาะผู้ดูแลระบบเท่านั้น';
  end if;

  delete from public.external_wht_viewer_companies
  where user_id = p_user_id and company_id = p_company_id;
end;
$$;

revoke all on function public.revoke_external_wht_viewer_company(uuid, uuid) from public;
grant execute on function public.revoke_external_wht_viewer_company(uuid, uuid) to authenticated;
revoke execute on function public.revoke_external_wht_viewer_company(uuid, uuid) from anon;

-- ส่วนที่ 7: แก้ list_pending_users() (เดิมจาก migration_011) — ตัดคนที่สมัครผ่านช่องทางภายนอกออกจากรายชื่อ
-- "รออนุมัติสมาชิกภายใน" ด้วย (เหตุผลเต็มดูหัวคอมเมนต์ไฟล์นี้ด้านบนสุด) เพิ่มแค่เงื่อนไข not exists อีก 1
-- เงื่อนไข โครงสร้างอื่นทั้งหมดเหมือนเดิมทุกประการ ไม่เปลี่ยน
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
    and not exists (
      select 1 from public.external_wht_viewers e where e.user_id = u.id
    )
    order by u.created_at asc;
end;
$$;
