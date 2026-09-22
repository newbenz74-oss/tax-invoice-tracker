-- BENZ — เว็บติดตามใบกำกับภาษี
-- สคริปต์ตรวจสอบความปลอดภัย (อ่านอย่างเดียว — ไม่แก้ไขอะไรทั้งสิ้น รันซ้ำกี่ครั้งก็ได้)
--
-- ใช้หาว่า "ใครก็ตามที่ถือ anon key (คีย์สาธารณะที่ฝังอยู่ในหน้าเว็บ ใครเปิด DevTools ก็เห็น) ยิง request
-- เข้ามาแล้วดึงข้อมูลอะไรออกไปได้บ้าง" — ต้องรันในฐานข้อมูลจริงเท่านั้น เพราะไฟล์ migration ในโปรเจกต์นี้
-- บอกได้แค่สิ่งที่ "เราตั้งใจสร้าง" ไม่ได้บอกสิ่งที่ "ยังค้างอยู่จริง" จากช่วงแรกๆ ของโปรเจกต์ (เช่น
-- payment_storage ที่ไม่มีอยู่ในไฟล์ migration ไหนเลยในโปรเจกต์นี้ แต่อาจยังมีตัวตนอยู่ในฐานข้อมูล)
--
-- ========================= วิธีใช้ (สำคัญ) =========================
-- Supabase SQL Editor แสดงผลลัพธ์ของ "คำสั่งสุดท้าย" เท่านั้น ถ้าวางทั้งไฟล์แล้วกด Run จะเห็นแค่ข้อ 7
-- ข้ออื่นหายไปเงียบๆ — ต้อง "ลากคลุมทีละบล็อก แล้วกด Run" (Editor จะรันเฉพาะส่วนที่เลือกไว้) ทำ 7 รอบ
-- แล้วก๊อปผลทั้ง 7 ชุดกลับมา
--
-- ควรรันไฟล์นี้ "ก่อน" migration_028 เพื่อเก็บภาพก่อนแก้ไว้เทียบ แล้วรันซ้ำอีกรอบหลังแก้เสร็จ

/* ========== 1. ตารางที่ anon แตะได้ในระดับ "สิทธิ์ตาราง" (ด่านแรกสุด ก่อนถึง RLS) ==========
   ถ้าตารางไหนโผล่ในผลลัพธ์นี้ แปลว่า anon ยิง request เข้ามาถึงตัวตารางได้ แล้วเหลือแค่ RLS เป็นด่านเดียว
   ที่กั้นอยู่ — ถ้า rls_enabled เป็น false ข้อมูลตารางนั้นรั่วสู่สาธารณะเต็มๆ
   หลังรัน migration_028 แล้ว บล็อกนี้ควรคืน 0 แถว */
select
  c.relname             as table_name,
  c.relkind             as kind,
  c.relrowsecurity      as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  g.anon_privileges
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral (
  -- MAINTAIN เป็นสิทธิ์ตารางตัวใหม่ของ PostgreSQL 17 — ต้องเช็ค server version ก่อน ไม่งั้นบน 16 จะได้
  -- ERROR: unrecognized privilege type: "MAINTAIN"
  select string_agg(t.p, ', ' order by t.p) as anon_privileges
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
  and g.anon_privileges is not null
order by c.relrowsecurity, c.relname;

/* ========== 2. ตารางทั้งหมดใน public พร้อมสถานะ RLS และเจ้าของ ==========
   - rls_enabled = false + มีสิทธิ์ anon (ข้อ 1) = ช่องโหว่เต็มรูปแบบ
   - policy_count = 0 ทั้งที่เปิด RLS = ไม่มีใครอ่านได้เลยนอกจาก owner/service_role (ตั้งใจแบบนี้ได้)
   - owner ที่ไม่ใช่ postgres สำคัญมาก: คำสั่ง revoke ใน migration_028 อาจ "ล้มเหลวเงียบๆ" กับตารางที่
     postgres ไม่ได้เป็นเจ้าของและไม่มี grant option (PostgreSQL จะขึ้นแค่ WARNING ไม่ error) */
select
  c.relname                     as table_name,
  pg_get_userbyid(c.relowner)   as owner,
  c.relrowsecurity              as rls_enabled,
  c.relforcerowsecurity         as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relrowsecurity, c.relname;

/* ========== 3. policy ทุกตัวใน public พร้อม role ที่มันครอบคลุม ==========
   ดูคอลัมน์ roles เป็นหลัก: ถ้าเป็น {public} แปลว่า policy นั้นครอบ anon ไปด้วย (ไม่ได้เขียน to authenticated)
   — ยังไม่ใช่ช่องโหว่ทันทีถ้า qual อ้าง auth.uid() (ซึ่งเป็น null สำหรับ anon จึงไม่คืนแถวไหนเลย) แต่จะเป็น
   ช่องโหว่ทันทีถ้า qual เป็น true หรือเป็นเงื่อนไขที่ไม่เกี่ยวกับตัวผู้ใช้ */
select
  tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by (roles::text = '{public}') desc, tablename, policyname;

/* ========== 4. ฟังก์ชันใน public ที่ anon เรียกได้ ==========
   ไม่กรองเฉพาะ security definer โดยตั้งใจ — อยากเห็นทั้งหมดว่ามีอะไรเปิดให้คนไม่ล็อกอินเรียกได้บ้าง
   คอลัมน์ is_security_definer = true คือกลุ่มที่อันตรายที่สุด (รันด้วยสิทธิ์เจ้าของ ข้าม RLS ทั้งหมด)
   ถ้าตัวไหน security definer + anon เรียกได้ + ไม่เช็ค auth.uid() เองข้างใน = ประตูหลังเต็มรูปแบบ

   หมายเหตุ: log_audit_event() จะโผล่มาในผลลัพธ์นี้ "ก่อนรัน migration_028" เท่านั้น (เป็น security definer
   และ anon เรียกได้ แม้จะคืนค่าชนิด trigger ซึ่ง PostgREST ไม่ยอม expose ผ่าน REST API จึงเรียกจากภายนอก
   ไม่ได้จริง) — หลังรัน 028 แล้วมันต้องหายไป ถือเป็นสัญญาณว่าข้อ 2 ของ 028 ทำงานสำเร็จ */
select
  p.proname                                 as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef                               as is_security_definer,
  pg_get_userbyid(p.proowner)               as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')   -- ฟังก์ชันกับ procedure (ให้ตรงกับขอบเขตที่ migration_028 ข้อ 2 ไล่ถอนสิทธิ์)
  and has_function_privilege('anon', p.oid, 'execute')
order by p.prosecdef desc, p.proname;

/* ========== 5. สิทธิ์ระดับคอลัมน์ที่หลงเหลือให้ anon ==========
   สิทธิ์ระดับคอลัมน์เป็นจุดที่คนมองข้ามบ่อยที่สุด เพราะ query ข้อ 1 ที่ดูสิทธิ์ระดับตารางจับไม่เจอ
   ปกติควรคืน 0 แถว */
select c.relname as table_name, a.attname as column_name, a.attacl
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and a.attacl is not null
  and array_to_string(a.attacl, ',') like '%anon=%'
order by c.relname, a.attname;

/* ========== 6. default privileges — กันของใหม่ในอนาคต ==========
   ถ้ายังมีรายการที่ defaclacl มี "anon=" อยู่ แปลว่าตาราง/ฟังก์ชันที่สร้างใหม่ครั้งหน้าจะได้สิทธิ์ anon
   กลับมาอัตโนมัติ (คือช่องโหว่เดิมเปิดใหม่เองโดยไม่มีใครรู้ตัว) */
select
  pg_get_userbyid(d.defaclrole) as grantor_role,
  n.nspname                     as schema_name,
  d.defaclobjtype               as object_type,  -- r=table S=sequence (ตัวใหญ่) f=function T=type n=schema
  d.defaclacl                   as acl
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
order by grantor_role, schema_name, object_type;

/* ========== 7. storage bucket ที่เปิดสาธารณะ ==========
   bucket ที่ public = true อ่านได้โดยไม่ต้องล็อกอินเลย — ตั้งใจให้เป็นแบบนั้นสำหรับ company-logos เท่านั้น
   ถ้าเจอ bucket ชื่อแนวๆ payment อยู่ในนี้และ public = true นั่นคือช่องโหว่คนละตัวกับเรื่องตาราง ต้องแก้ที่
   bucket ไม่ใช่ที่ RLS (migration_017 เคยบันทึกไว้ว่าตอนนั้น storage.buckets ว่างเปล่า) */
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
order by id;
