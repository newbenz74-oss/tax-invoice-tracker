-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 028: ปิดประตู anon key ทั้งระบบ (แก้ช่องโหว่ที่รายงานเข้ามาเรื่อง payment_storage)
-- รันทั้งไฟล์ผ่าน Supabase SQL Editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent)
--
-- ⚠️ ก่อนรันไฟล์นี้ ต้องสำรองข้อมูลในตาราง payment_storage ออกมาเก็บไว้ก่อน (ไฟล์นี้ไม่ลบข้อมูล แต่หลังรัน
--    แล้วจะเข้าถึงผ่านแอปไม่ได้อีก) และควรรัน supabase/check_rls_security_quick.sql ไว้ทั้งก่อนและหลัง
--    เพื่อเทียบผล
--
-- ========================= ปัญหาที่แก้ =========================
-- anon key คือคีย์สาธารณะที่ฝังอยู่ในหน้าเว็บ (NEXT_PUBLIC_SUPABASE_ANON_KEY) ใครเปิด DevTools ก็เห็น
-- และก๊อปไปยิง REST API ตรงๆ ได้ทันทีโดยไม่ต้องล็อกอิน สิ่งเดียวที่กั้นอยู่คือ RLS ของแต่ละตาราง
--
-- โครงสร้างความปลอดภัยของ Supabase มี 2 ด่านซ้อนกัน:
--   ด่านที่ 1  สิทธิ์ระดับตาราง (GRANT/REVOKE) — ค่าตั้งต้นของ Supabase คือ grant ให้ anon ทุกตารางใน
--              schema public โดยอัตโนมัติ จึงผ่านด่านนี้เสมอ ไม่เคยกันใครเลย
--   ด่านที่ 2  RLS policy — ด่านจริงด่านเดียวที่ทำงานอยู่ตลอดมา
--
-- ผลคือ "ตารางไหนที่ RLS ปิดอยู่ หรือ policy เขียนไม่ครอบคลุม = เปิดให้โลกอ่านได้ทันที"
--
-- ตรวจฐานข้อมูลจริงเมื่อ 2026-09-22 แล้วพบว่าเกิดขึ้นจริงกับตาราง payment_storage ซึ่งมี policy ชื่อ
-- "Allow anon all" เขียนว่า `to anon / for all / using (true)` = เปิดโล่งให้ใครก็ได้ที่ถือ anon key อ่าน
-- เขียน ลบได้ทั้งตาราง ข้างในมีเลขที่บัญชีธนาคารอยู่จริง (ดูรายละเอียดเต็มที่ข้อ 4)
--
-- ตารางนี้ไม่มีอยู่ในไฟล์ migration ไหนเลยในโปรเจกต์นี้ (ค้นแล้วเจอแค่ในคอมเมนต์ของ migration_004 กับ
-- migration_017) จึงไม่เคยถูกไล่ตรวจ RLS — เป็นตัวอย่างชัดเจนว่าทำไมการไล่ปะทีละตารางถึงไม่พอ
--
-- ========================= แนวทางที่เลือก =========================
-- ไม่ไล่ปะทีละตาราง เพราะวิธีนั้นแก้ได้แค่ตารางที่เรานึกออก ตารางที่ลืมหรือค้างจากอดีตก็ยังรั่วเหมือนเดิม
-- รอบนี้ปิด "ด่านที่ 1" ทั้ง schema แทน: ถอนสิทธิ์ระดับตารางของ anon ออกทั้งหมด แล้วสั่งไม่ให้ของที่สร้าง
-- ใหม่ในอนาคตได้สิทธิ์ anon กลับมาอีก — หลังจากนี้ anon ยิง request เข้ามาจะโดนปฏิเสธตั้งแต่ด่านแรก
-- ("permission denied for table ...") ไม่ว่า RLS ของตารางนั้นจะเขียนไว้อย่างไร หรือจะเปิด RLS ไว้หรือไม่ก็ตาม
--
-- ระบบนี้ไม่มีฟีเจอร์ไหนที่ต้องอ่าน/เขียนข้อมูลก่อนล็อกอินเลยแม้แต่จุดเดียว (ตรวจแล้วทั้ง lib/ app/ — ทุกการ
-- เรียกตารางและทุก RPC เกิดหลังล็อกอินทั้งหมด ส่วน app/api/wht-certificate/send ถึงจะใช้ anon key ก็แนบ
-- access token ของผู้ใช้ไปด้วยเสมอ role จึงเป็น authenticated และตัวการล็อกอิน/สมัครสมาชิกวิ่งผ่าน Supabase
-- Auth ซึ่งอยู่คนละ schema ไม่ถูกกระทบ) การถอนสิทธิ์ทั้ง schema จึงไม่ทำให้อะไรพัง
--
-- ========================= สิ่งที่ทำ 6 ข้อ =========================
--   1. ถอนสิทธิ์ตาราง/ซีเควนซ์ทั้งหมดใน public จาก anon (+ PUBLIC) แล้วยืนยันสิทธิ์ authenticated เหมือนเดิม
--   2. ถอนสิทธิ์เรียกฟังก์ชันใน public จาก anon (ข้ามฟังก์ชันของ extension)
--   3. ตั้ง default privileges ไม่ให้ของที่สร้างใหม่ในอนาคตได้สิทธิ์ anon กลับมาอีก
--   4. ลบ policy "Allow anon all" แล้วปิด payment_storage ให้สนิท (ไม่ลบข้อมูล)
--   5. เขียน policy 12 ตัวที่ลืมใส่ `to authenticated` ใหม่ให้ระบุ role ชัดเจน
--   6. ถอนสิทธิ์เรียกฟังก์ชัน security definer ของ migration_026 จาก anon (ข้อที่ 026 ลืมทำ)
--
-- ⚠️ หลังรันเสร็จ ให้ดู panel "Warnings" ของ SQL Editor ด้วย ไม่ใช่ดูแค่ว่า "รันผ่าน" — PostgreSQL จะขึ้น
--    WARNING (ไม่ใช่ error) แล้วเดินต่อ ถ้าเจอตารางที่ postgres ไม่มี grant option พอจะถอนสิทธิ์ได้ ซึ่งแปลว่า
--    ตารางนั้น "ยังไม่ถูกแก้" ให้เชื่อผลของ query ตรวจสอบท้ายไฟล์ (ซึ่งตรวจสิทธิ์ระดับตาราง) เป็นหลักเสมอ
--    ส่วนฟังก์ชัน/sequence/default privileges ให้ยืนยันด้วยข้อ 4, 5, 6 ของ check_rls_security.sql
--    (RAISE NOTICE ต่างๆ ในไฟล์นี้ SQL Editor ไม่แสดงให้เห็น — ใช้ check_rls_security.sql ยืนยันผลแทน)

/* ============================== 1. ถอนสิทธิ์ระดับตารางของ anon ทั้ง schema ==============================
   revoke จาก PUBLIC ด้วย เพราะสิทธิ์ที่ให้ PUBLIC ไว้จะตกถึง anon โดยอัตโนมัติ (คนละกลไกกับ grant ที่ให้
   role anon ตรงๆ ต้องถอนทั้งสองทาง) จากนั้น grant กลับให้ authenticated/service_role ให้ตรงกับค่าตั้งต้น
   ของ Supabase เป๊ะๆ — บรรทัด grant พวกนี้ไม่ได้เพิ่มสิทธิ์อะไรใหม่ (Supabase grant ตรงถึง role อยู่แล้ว
   ไม่ได้ผ่าน PUBLIC การ revoke ข้างบนจึงแทบไม่ถอนอะไรเลย) ใส่ไว้เพื่อการันตีว่าไม่มีอะไรหลุดไปโดยไม่ตั้งใจ
   ลำดับสำคัญ: revoke ต้องมาก่อน grant เสมอ */
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables    in schema public from public;
revoke all on all sequences in schema public from public;

grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- ไม่ถอน usage on schema public จาก anon โดยตั้งใจ — USAGE เปล่าๆ ไม่ให้สิทธิ์อ่านข้อมูลในตารางไหนเลย
-- จึงไม่จำเป็นต้องถอน และการคงไว้ทำให้คนที่ยิงมาด้วย anon key ได้ error เป็น "permission denied" ที่ชัดเจน
-- แทนที่จะเป็น 404 กำกวมซึ่งไล่ปัญหายากกว่ามากเวลาเกิดเหตุจริง
-- (PostgREST โหลดโครงสร้าง schema ด้วย role authenticator ไม่ใช่ anon การถอนจึงไม่ได้ทำให้ระบบพัง แต่ก็
--  ไม่มีเหตุผลต้องเบี่ยงจากค่ามาตรฐานของ Supabase)

/* ============================== 2. ถอนสิทธิ์เรียกฟังก์ชันของ anon ==============================
   ปิดแค่ตารางยังไม่พอ — ฟังก์ชัน security definer รันด้วยสิทธิ์เจ้าของและข้าม RLS ทั้งหมด ถ้า anon เรียกได้
   ก็เท่ากับเปิดประตูหลังทิ้งไว้ ตอนนี้ยังไม่มีตัวไหน exploit ได้จริง (ทุกตัวเช็ค auth.uid() เองหรือเป็น
   security invoker) แต่ไม่มีเหตุผลต้องแบกความเสี่ยงนี้ไว้

   ไม่ใช้ `revoke all on all routines ... from public` ตรงๆ เพราะถ้ามี extension ติดตั้งอยู่ใน schema public
   (เช่น pgcrypto ในบางโปรเจกต์) จะไปถอนสิทธิ์ฟังก์ชันของ extension ด้วย ซึ่งพังได้ในแบบที่ไล่หายาก
   จึงวนทีละฟังก์ชันแล้วข้ามตัวที่เป็นของ extension (pg_depend.deptype = 'e') */
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')   -- ฟังก์ชันกับ procedure เท่านั้น ไม่ยุ่งกับ aggregate/window
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  loop
    -- ใช้คำว่า ROUTINE ไม่ใช่ FUNCTION เพราะ ROUTINE ครอบทั้งฟังก์ชันและ procedure ได้ในคำสั่งเดียว
    execute format('revoke all on routine %s from anon, public', fn.sig);
    execute format('grant execute on routine %s to authenticated, service_role', fn.sig);
  end loop;
end;
$$;

/* ============================== 3. กันของที่สร้างใหม่ในอนาคต ==============================
   Supabase ตั้ง default privileges ไว้ให้ทุกตาราง/ฟังก์ชันที่สร้างใหม่ใน public ถูก grant ให้ anon อัตโนมัติ
   ถ้าไม่ปิดตรงนี้ migration รอบหน้าที่สร้างตารางใหม่จะเปิดช่องเดิมกลับมาทันทีโดยไม่มีใครรู้ตัว — กับดักข้อนี้
   migration_010 เคยบันทึกไว้แล้ว และ migration_026 ก็ยังตกหลุมซ้ำ (ดูข้อ 6)

   default privileges ผูกกับ "role ที่เป็นคนสร้าง" จึงต้องสั่งให้ครบทุก role ที่สร้างของใน schema นี้ได้
   ห่อ DO + exception ทีละคำสั่ง (ไม่รวมก้อน) เพราะถ้าก้อนไหนล้ม อีกก้อนจะถูก rollback ไปด้วยถ้าอยู่ด้วยกัน
   — role ที่ไม่มีอยู่จริง/สั่งแทนไม่ได้ไม่ใช่ความผิดพลาด แค่ข้ามไป */
do $$
declare
  r   text;
  cmd text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    foreach cmd in array array[
      'alter default privileges for role %I in schema public revoke all on tables    from anon',
      'alter default privileges for role %I in schema public revoke all on sequences from anon',
      'alter default privileges for role %I in schema public revoke all on routines  from anon'
    ] loop
      begin
        execute format(cmd, r);
      exception when others then
        raise notice 'ข้าม: % (role %) — %', cmd, r, sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;

-- ครอบ role ปัจจุบันด้วย เผื่อ migration ถูกรันด้วย role ที่ไม่อยู่ในรายชื่อข้างบน (ปกติ SQL Editor รันด้วย
-- postgres จึงซ้ำกับ loop ข้างบน — ไม่เสียหาย)
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on routines  from anon;

-- PostgreSQL มีค่าตั้งต้นระดับ global ว่า "ฟังก์ชันใหม่ทุกตัวได้ EXECUTE ให้ PUBLIC" ซึ่ง PUBLIC ครอบ anon
-- อยู่แล้ว — และเอกสาร PostgreSQL ระบุชัดว่า default privileges แบบระบุ schema "เพิ่มสิทธิ์ได้อย่างเดียว
-- ถอนสิทธิ์ที่มาจากค่า global ไม่ได้" บรรทัดข้างบนที่มี `in schema public` จึงถอนตัวนี้ไม่ได้ ต้องสั่งแบบ
-- ไม่ระบุ schema เท่านั้น มิฉะนั้นฟังก์ชันที่สร้างใหม่รอบหน้าจะเปิดให้ anon เรียกได้เหมือนเดิมทุกครั้ง
--
-- ⚠️ ผลข้างเคียงที่ต้องจำไว้ให้ดี (ทดสอบบนเครื่องจริงแล้ว): คำสั่งนี้ "ไม่ระบุ schema" จึงครอบทุก schema
--    และครอบฟังก์ชันที่มากับ `create extension` ด้วย — ทดลองกับ extension ที่มี 37 ฟังก์ชัน ผลคือทั้ง 37 ตัว
--    ได้ acl เป็น {postgres=X/postgres} เท่านั้น authenticated กับ service_role เรียกไม่ได้เลย
--    ดังนั้น "ทุกครั้งที่ติดตั้ง extension ใหม่" (กด Enable extension ใน Dashboard หรือ create extension เอง)
--    ต้องสั่งคืนสิทธิ์เองเสมอ มิฉะนั้นแอปจะพังด้วย permission denied for function ... ที่ไล่หาสาเหตุยากมาก
--      grant execute on all functions in schema extensions to authenticated, service_role;
--    (คำสั่งนี้ผูกกับ role postgres เท่านั้น ของที่ supabase_admin สร้างไม่ถูกครอบ)
do $$
begin
  alter default privileges for role postgres revoke execute on routines from public;
exception when others then
  raise notice 'ข้าม global default privileges: %', sqlerrm;
end;
$$;

/* ============================== 4. payment_storage — ช่องโหว่ตัวจริง ==============================
   ผลตรวจฐานข้อมูลจริงเมื่อ 2026-09-22 (ก่อนรัน migration นี้):

     ชนิด=r (ตารางจริง) | RLS=true | force=false | เจ้าของ=postgres | anon อ่านได้=true
     policy: "Allow anon all"  role={anon}  ALL  using (true)
     คอลัมน์: key (text), value (jsonb), updated_at (timestamptz)
     ข้อมูล 2 แถว: backup_2026_xx ({"_app": "CRIT DAMAGE Payment System"}) และ bankMasterData
                   (รายการบัญชีธนาคาร — เลขที่บัญชีจริง) ทั้งคู่ updated_at = 2026-09-10

   `using (true)` + `to anon` + `for all` = ใครถือ anon key (ซึ่งฝังอยู่ในหน้าเว็บ ใครก็ก๊อปได้) อ่าน/เขียน/
   ลบตารางนี้ได้ทั้งหมดโดยไม่ต้องล็อกอิน — นี่คือช่องโหว่ที่รายงานเข้ามา และเลขที่บัญชีธนาคารในนั้นต้องถือว่า
   "รั่วไปแล้ว" ไม่ใช่แค่ "เสี่ยงจะรั่ว"

   ข้อสังเกตที่ต้องบันทึกไว้: ตารางนี้ไม่ใช่ของระบบใบกำกับภาษี (แอปไม่เรียกใช้เลย — grep ทั้ง lib/ app/
   components/ แล้วไม่เจอ) เป็นของระบบชื่อ "CRIT DAMAGE Payment System" ที่มาใช้โปรเจกต์ Supabase เดียวกัน
   ซึ่งขัดกับที่ README เขียนไว้ว่าโปรเจกต์นี้แยกเฉพาะระบบใบกำกับภาษี

   ทำไมไม่ drop ทิ้ง: เจ้าของโปรเจกต์ยืนยันว่าไม่ใช่ระบบของตัวเองและไม่ได้ใช้ แต่ข้อมูลข้างในเป็นเลขบัญชี
   ธนาคารซึ่งอาจเป็นของคนอื่นในองค์กร ลบแล้วกู้ไม่ได้ — รอบนี้จึงเลือกทางที่ย้อนกลับได้: ปิดให้แตะไม่ได้
   แต่เก็บข้อมูลไว้ ถ้าผ่านไปสักระยะไม่มีใครทักว่าระบบพัง ค่อย drop ทีหลัง (คำสั่งอยู่ท้ายไฟล์นี้ คอมเมนต์ไว้)

   ปิด 4 ชั้น: ลบ policy ที่เปิดโล่งทุกตัว + เปิด RLS + force RLS (เจ้าของตารางก็ไม่ข้าม) + ถอนสิทธิ์ตาราง
   จาก anon/PUBLIC/authenticated เหลือแค่ service_role (คีย์ฝั่งเซิร์ฟเวอร์ที่ไม่เคยออกจากเซิร์ฟเวอร์)

   เช็ค relkind ก่อนเสมอ เพราะ to_regclass คืนค่าให้ view/sequence ด้วย ซึ่งสั่ง enable row level security
   ไม่ได้ จะทำให้ migration ทั้งไฟล์ rollback */
do $$
declare
  v_kind "char";
  v_pol  record;
begin
  select c.relkind into v_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payment_storage';

  if v_kind in ('r', 'p') then
    -- ห่อ exception ไว้เพราะ ALTER TABLE / DROP POLICY ต้องเป็น "เจ้าของตาราง" เท่านั้น ไม่มีทางลัดด้วย
    -- grant option ถ้าเจ้าของไม่ใช่ role ที่รัน migration จะได้ ERROR: must be owner of table แล้ว
    -- rollback ทั้งไฟล์ ทิ้งงานข้อ 1-3 ที่สำเร็จไปแล้ว
    begin
      -- ลบ policy ทุกตัวบนตารางนี้ รวม "Allow anon all" ที่เปิดโล่ง — ไล่จาก catalog แทนการระบุชื่อตรงๆ
      -- เผื่อมี policy อื่นที่ยังไม่รู้จัก และเพื่อให้รันซ้ำได้แม้ชื่อ policy เปลี่ยนไป
      for v_pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = 'payment_storage'
      loop
        execute format('drop policy %I on public.payment_storage', v_pol.policyname);
        raise notice 'payment_storage: ลบ policy "%" แล้ว', v_pol.policyname;
      end loop;

      execute 'alter table public.payment_storage enable row level security';
      execute 'alter table public.payment_storage force row level security';
      execute 'revoke all on public.payment_storage from anon, public, authenticated';
      raise notice 'payment_storage: ปิดสนิทเรียบร้อย (ข้อมูลยังอยู่ครบ ไม่ได้ลบ)';
    exception when others then
      raise notice 'payment_storage: ปิดไม่สำเร็จ (%) — ต้องให้เจ้าของตารางรันเอง', sqlerrm;
    end;
  elsif v_kind is not null then
    raise notice 'payment_storage: มีอยู่แต่เป็น relkind % (ไม่ใช่ตาราง) — ข้าม ต้องตรวจด้วยมือ', v_kind;
  else
    raise notice 'payment_storage: ไม่มีในฐานข้อมูลแล้ว (ถูกลบไปแล้ว)';
  end if;
end;
$$;

/* ============================== 5. policy 12 ตัวที่ลืมระบุ role ==============================
   policy ที่ไม่เขียน `to <role>` จะมีค่าเริ่มต้นเป็น PUBLIC ซึ่งครอบ anon ไปด้วยเสมอ — ทั้ง 12 ตัวนี้บังเอิญ
   ยังกันข้อมูลได้อยู่ เพราะเงื่อนไขข้างในอ้าง auth.uid() ซึ่งเป็น null สำหรับ anon จึงไม่คืนแถวไหนเลย
   แต่ "บังเอิญปลอดภัย" ไม่ใช่ "ปลอดภัยโดยการออกแบบ" — ถ้าวันหนึ่งมีคนแก้เงื่อนไขในนี้โดยไม่ทันสังเกตว่า
   policy ตัวนี้ครอบ anon อยู่ด้วย ก็จะกลายเป็นช่องโหว่ทันที เขียนใหม่ให้ระบุ role ชัดเจนทั้งหมด

   เนื้อหาเงื่อนไข (using/with check) คงเดิมทุกตัวไม่แตะเลย — เปลี่ยนแค่ขอบเขต role เท่านั้น จึงไม่กระทบ
   พฤติกรรมของผู้ใช้ที่ล็อกอินอยู่แม้แต่นิดเดียว (เทียบตัวอักษรกับต้นฉบับใน 013/014/015/018/024 แล้ว) */

-- companies (select จาก 018, update จาก 013, delete จาก 024)
drop policy if exists "select_member_companies" on public.companies;
create policy "select_member_companies" on public.companies
  for select
  to authenticated
  using (public.is_company_member(id) or public.is_external_wht_viewer(id));

drop policy if exists "update_member_companies" on public.companies;
create policy "update_member_companies" on public.companies
  for update
  to authenticated
  using (public.is_company_member(id))
  with check (public.is_company_member(id));

drop policy if exists "delete_member_companies" on public.companies;
create policy "delete_member_companies" on public.companies
  for delete
  to authenticated
  using (public.is_company_member(id));

-- wht_certificate_counters (จาก 014 — ส่วน delete_own_counters ของ 025 มี to authenticated อยู่แล้ว ไม่แตะ)
drop policy if exists "select_own_counters" on public.wht_certificate_counters;
create policy "select_own_counters" on public.wht_certificate_counters
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "insert_own_counters" on public.wht_certificate_counters;
create policy "insert_own_counters" on public.wht_certificate_counters
  for insert
  to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists "update_own_counters" on public.wht_certificate_counters;
create policy "update_own_counters" on public.wht_certificate_counters
  for update
  to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- wht_certificates (select จาก 018, insert/update จาก 015 — delete_own_certificates ของ 025 ไม่แตะ)
drop policy if exists "select_own_certificates" on public.wht_certificates;
create policy "select_own_certificates" on public.wht_certificates
  for select
  to authenticated
  using (public.is_company_member(company_id) or public.is_external_wht_viewer(company_id));

drop policy if exists "insert_own_certificates" on public.wht_certificates;
create policy "insert_own_certificates" on public.wht_certificates
  for insert
  to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists "update_own_certificates" on public.wht_certificates;
create policy "update_own_certificates" on public.wht_certificates
  for update
  to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- external_wht_viewers / external_wht_viewer_companies (จาก 018)
drop policy if exists "select_own_external_viewer" on public.external_wht_viewers;
create policy "select_own_external_viewer" on public.external_wht_viewers
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "insert_own_external_viewer" on public.external_wht_viewers;
create policy "insert_own_external_viewer" on public.external_wht_viewers
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "select_own_external_grants" on public.external_wht_viewer_companies;
create policy "select_own_external_grants" on public.external_wht_viewer_companies
  for select
  to authenticated
  using (user_id = auth.uid());

/* ============================== 6. ฟังก์ชัน security definer ที่ 026 ลืมถอนจาก anon ==============================
   ข้อ 2 ครอบให้แล้วทั้ง schema แต่เขียนย้ำตรงนี้อีกรอบเพราะสี่ตัวนี้คือจุดที่พลาดจริง และอยากให้คนอ่าน
   migration รอบหน้าเห็นชัดๆ ว่าต้องทำอะไรเวลาสร้างฟังก์ชัน security definer ใหม่

   migration_026 เขียน `grant execute ... to authenticated` ไว้อย่างเดียว แต่ Supabase ตั้ง default privilege
   ให้ทุกฟังก์ชันใหม่ใน public ถูก grant execute ให้ anon ตั้งแต่ตอนสร้างอยู่แล้ว การ grant เพิ่มจึงไม่ได้ถอน
   สิทธิ์ anon ออกเลย (migration_010 บันทึกกับดักข้อนี้ไว้แล้ว แต่ 026 พลาดไป)

   audit_begin_restore / audit_end_restore / audit_cancel_restore เช็ค auth.uid() เองข้างในอยู่แล้ว ส่วน
   current_actor_email() คืน null ให้คนที่ไม่ได้ล็อกอินอยู่แล้ว (อ่าน JWT claim ก่อน แล้ว fallback ไป
   auth.users ด้วย auth.uid()) ทั้งสี่ตัวจึงไม่เคยรั่วข้อมูลจริง — แต่ security definer แปลว่า "รันด้วยสิทธิ์
   เจ้าของ ข้าม RLS ทั้งหมด" การเปิดให้คนที่ไม่ล็อกอินเรียกได้คือความเสี่ยงที่ไม่มีเหตุผลต้องแบกไว้

   ไม่ grant current_actor_email() คืนให้ authenticated โดยตั้งใจ — แอปไม่เคยเรียกผ่าน RPC เลย มันถูกเรียก
   จากใน log_audit_event() / audit_*_restore() ซึ่งเป็น security definer ของ postgres ที่เป็นเจ้าของฟังก์ชัน
   นี้อยู่แล้ว (เจ้าของมีสิทธิ์เรียกโดยปริยายเสมอ)

   ใช้ to_regprocedure ตรวจก่อนเพราะถ้าฟังก์ชันไม่มี (เช่น migration_026 ยังไม่ได้ apply) คำสั่ง revoke
   ตรงๆ จะ error แล้วทำให้ทั้งไฟล์ rollback ทิ้งงานข้อ 1-5 ที่ทำสำเร็จไปแล้ว */
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.audit_begin_restore(uuid)',
    'public.audit_end_restore(uuid, text, jsonb)',
    'public.audit_cancel_restore()',
    'public.current_actor_email()'
  ] loop
    if to_regprocedure(f) is null then
      raise notice 'ข้ามฟังก์ชัน % (ไม่มีในฐานข้อมูล)', f;
      continue;
    end if;

    if f = 'public.current_actor_email()' then
      -- ถอนจาก authenticated ด้วย (ข้อ 2 grant คืนไปตอนวนทั้ง schema) เพราะแอปไม่เคยเรียกตัวนี้ผ่าน RPC
      execute format('revoke all on routine %s from anon, public, authenticated', f);
    else
      execute format('revoke all on routine %s from anon, public', f);
      execute format('grant execute on routine %s to authenticated', f);
    end if;
  end loop;
end;
$$;

/* ============================== 6.5 ฟังก์ชัน trigger ไม่ต้องให้ใครเรียกได้เลย ==============================
   ข้อ 2 grant execute คืนให้ authenticated ทั้ง schema ซึ่งพลอยครอบฟังก์ชัน trigger (log_audit_event,
   set_updated_at) ไปด้วย — ฟังก์ชันพวกนี้ไม่ควรถูกเรียกจากภายนอกเลย และ Supabase security advisor ก็ขึ้น
   เตือนตรงๆ ว่า "authenticated เรียก SECURITY DEFINER ตัวนี้ได้ผ่าน /rest/v1/rpc/log_audit_event"

   ถอนได้อย่างปลอดภัยเพราะ PostgreSQL ตรวจสิทธิ์ EXECUTE ของฟังก์ชัน trigger แค่ตอน CREATE TRIGGER ไม่ได้
   ตรวจซ้ำตอน trigger ทำงานจริง (ทดสอบยืนยันบนเซิร์ฟเวอร์จริงแล้ว — ถอนทิ้งหมดแล้ว trigger ยังยิงปกติ) */
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on routine %s from anon, public, authenticated', fn.sig);
  end loop;
end;
$$;

/* ============================== 7. ตรวจผลทันทีหลังรัน ==============================
   ต้องได้ผลลัพธ์ "0 แถว" (Success. No rows returned) — ถ้ามีแถวโผล่มา แปลว่ายังมีตารางที่ anon แตะได้
   เหลืออยู่ (น่าจะเป็นตารางที่ postgres ไม่มี grant option พอจะถอนสิทธิ์ได้ ดูคำเตือนเรื่อง WARNING ที่หัวไฟล์)
   ให้ส่งผลกลับมาดู

   ขอบเขตของการตรวจตรงนี้: "สิทธิ์ระดับตาราง" เท่านั้น ส่วนฟังก์ชัน (ข้อ 2 กับข้อ 6), sequence (ข้อ 1) และ
   default privileges (ข้อ 3) ตรวจไม่ได้ด้วย query นี้ — ต้องไปดูข้อ 4, 5 และ 6 ของ check_rls_security.sql */
select
  c.relname as table_name,
  g.anon_privileges_remaining
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral (
  -- MAINTAIN เป็นสิทธิ์ตารางตัวใหม่ที่เพิ่มมาใน PostgreSQL 17 — เช็ค server version ก่อนเสมอ ถ้าใส่ตรงๆ
  -- แล้วฐานข้อมูลเป็น 16 จะได้ ERROR: unrecognized privilege type: "MAINTAIN"
  select string_agg(t.p, ', ' order by t.p) as anon_privileges_remaining
  from unnest(
    case when current_setting('server_version_num')::int >= 170000
      then array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
      else array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    end
  ) as t(p)
  where has_table_privilege('anon', c.oid, t.p)
) g
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
  and g.anon_privileges_remaining is not null
order by c.relname;

/* ============================== 8. ขั้นต่อไป: ลบ payment_storage ทิ้ง (ยังไม่ทำตอนนี้) ==============================
   เมื่อสำรองข้อมูล 2 แถวออกมาเก็บไว้แล้ว และผ่านไปสักระยะ (แนะนำ 2-4 สัปดาห์) ไม่มีใครแจ้งว่าระบบไหนพัง
   ให้รันคำสั่งข้างล่างนี้เพื่อลบตารางทิ้งถาวร — ลบแล้วกู้ไม่ได้ ต้องมั่นใจว่าสำรองไว้แล้วจริงๆ

     drop table public.payment_storage;

   จนกว่าจะถึงตอนนั้น ตารางยังอยู่แต่ไม่มีใครแตะได้นอกจาก service_role (คีย์ฝั่งเซิร์ฟเวอร์) */
