-- BENZ — เว็บติดตามใบกำกับภาษี
-- สคริปต์ตรวจความปลอดภัยแบบย่อ (อ่านอย่างเดียว ไม่แก้อะไร รันซ้ำได้)
--
-- ต่างจาก check_rls_security.sql ตรงที่รวมทุกอย่างไว้ในคำสั่งเดียว → วางทั้งไฟล์แล้วกด Run ครั้งเดียวจบ
-- ได้ผลเป็นตารางเดียว ไม่ต้องลากคลุมทีละบล็อก (ไฟล์เต็มเก็บไว้ดูรายละเอียดลึกๆ ตอนต้องสืบต่อ)
--
-- อ่านผลยังไง: คอลัมน์ check_name บอกว่าเป็นข้อค้นพบประเภทไหน
--   A = ตารางที่ anon แตะได้        ← ต้องว่างหลังรัน migration_028
--   B = ตารางที่ปิด RLS ไว้           ← อันตรายที่สุดถ้ามีคู่กับ A
--   C = policy ที่ครอบ role anon      ← ต้องว่างหลังรัน migration_028
--   D = ฟังก์ชันที่ anon เรียกได้      ← ต้องว่างหลังรัน migration_028
--   E = สถานะของ payment_storage      ← ตัวที่รายงานเข้ามา
--   F = storage bucket ที่เปิดสาธารณะ ← ควรมีแค่ company-logos
--   G = default privileges ที่ยังให้ anon ← ต้องว่างหลังรัน migration_028
--
-- ถ้าผลออกมา 0 แถวทั้งหมดยกเว้น E กับ F = ปิดสนิทแล้ว

select t.check_name, t.object_name, t.detail
from (

  -- A. ตารางที่ anon มีสิทธิ์แตะได้ในระดับ "สิทธิ์ตาราง" (ด่านแรก ก่อนถึง RLS)
  select 1 as seq,
         'A. anon แตะตารางนี้ได้' as check_name,
         c.relname::text          as object_name,
         'RLS=' || c.relrowsecurity::text || ' | สิทธิ์: ' || g.privs as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    select string_agg(x.p, ', ' order by x.p) as privs
    from unnest(
      case when current_setting('server_version_num')::int >= 170000
        then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
        else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
      end
    ) as x(p)
    where has_table_privilege('anon', c.oid, x.p)
  ) g
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and g.privs is not null

  union all

  -- B. ตารางที่ปิด RLS ไว้ (ถ้า anon แตะได้ด้วย = ข้อมูลเปิดสาธารณะเต็มรูปแบบ)
  select 2,
         'B. ตารางนี้ปิด RLS ไว้',
         c.relname::text,
         'เจ้าของ=' || pg_get_userbyid(c.relowner)::text
           || ' | policy ' || (select count(*) from pg_policies p
                               where p.schemaname = 'public' and p.tablename = c.relname)::text || ' ตัว'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity

  union all

  -- C. policy ที่ไม่ได้ระบุ role จึงครอบ anon ไปด้วย
  select 3,
         'C. policy นี้ครอบ anon ด้วย',
         (p.tablename || ' / ' || p.policyname)::text,
         p.cmd::text || ' | ' || coalesce(p.qual, p.with_check, '(ไม่มีเงื่อนไข)')
  from pg_policies p
  where p.schemaname = 'public' and p.roles::text = '{public}'

  union all

  -- D. ฟังก์ชันที่ anon เรียกได้ (security definer = ข้าม RLS ทั้งหมด อันตรายที่สุด)
  select 4,
         'D. anon เรียกฟังก์ชันนี้ได้',
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         case when p.prosecdef then 'SECURITY DEFINER (ข้าม RLS)' else 'security invoker' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f','p')
    and has_function_privilege('anon', p.oid, 'execute')

  union all

  -- E. payment_storage — ตัวที่รายงานเข้ามา (คืนแถวเสมอ แม้ไม่มีตารางนี้ จะได้รู้ว่า "ไม่มี" จริง)
  select 5,
         'E. payment_storage',
         'public.payment_storage',
         coalesce(
           (select 'ชนิด=' || c.relkind::text
                   || ' | RLS=' || c.relrowsecurity::text
                   || ' | force=' || c.relforcerowsecurity::text
                   || ' | เจ้าของ=' || pg_get_userbyid(c.relowner)::text
                   || ' | anon อ่านได้=' || has_table_privilege('anon', c.oid, 'SELECT')::text
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'payment_storage'),
           'ไม่มีตารางนี้ในฐานข้อมูล → ให้ดูผลข้อ F ว่าเป็น storage bucket หรือเปล่า'
         )

  union all

  -- F. storage bucket (bucket ที่ public=true อ่านได้โดยไม่ต้องล็อกอิน)
  select 6,
         'F. storage bucket',
         b.id::text,
         'public=' || b.public::text
  from storage.buckets b

  union all

  -- G. default privileges ที่ยังเปิดให้ anon (= ของที่สร้างใหม่ในอนาคตจะรั่วซ้ำ)
  select 7,
         'G. default privileges ให้ anon',
         (pg_get_userbyid(d.defaclrole) || ' → ' || coalesce(n.nspname, '(ทุก schema)')
            || ' [' || d.defaclobjtype::text || ']')::text,
         array_to_string(d.defaclacl, ', ')
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  -- เทียบทีละรายการใน acl แล้วยึดหัวรายการ (`anon=` ไม่ใช่ `%anon=%`) เพราะถ้าใช้ % นำหน้าจะไปแมตช์
  -- รายการของ role อื่นที่ลงท้ายด้วยชื่อเดียวกัน ส่วนสิทธิ์ที่ให้ PUBLIC จะเขียน grantee เป็นค่าว่าง
  -- (`=X/postgres`) จึงต้องเช็คด้วย `=%` แยกอีกเงื่อนไข
  where exists (
    select 1 from unnest(d.defaclacl) a
    where a::text like 'anon=%'   -- ให้ anon ตรงๆ
       or a::text like '=%'       -- ให้ PUBLIC (grantee ว่าง → anon ได้ตามไปด้วย)
  )

) t
order by t.seq, t.object_name;
