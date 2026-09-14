-- Migration 026: ประวัติการใช้งาน (Audit Log) — บันทึกว่า "ใครทำอะไร กับข้อมูลไหน เมื่อไหร่"
-- รันทั้งไฟล์นี้ผ่าน Supabase SQL editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent ทุกคำสั่ง)
--
-- ============================================================================================
-- ทำไมต้องมี ทั้งที่ตารางหลักมี created_by/updated_by อยู่แล้ว
-- ============================================================================================
-- คอลัมน์ created_by/updated_by ที่มีอยู่เดิมตอบได้แค่ "ใครสร้าง" กับ "ใครแก้ล่าสุด" ของสถานะ ณ ปัจจุบัน
-- เท่านั้น ตอบไม่ได้ 3 เรื่องที่เป็นหัวใจของการตรวจสอบย้อนหลัง:
--   1. ใครลบ — พอลบแล้วทั้งแถวหายไป ข้อมูลคนลบหายตามไปด้วย
--   2. แก้จากอะไรเป็นอะไร — เก็บแค่ค่าล่าสุด ค่าเดิมหายทันทีที่กดบันทึก
--   3. แก้มาแล้วกี่ครั้ง เมื่อไหร่บ้าง — คนแก้ 10 รอบ เห็นได้แค่รอบสุดท้าย
-- ตารางนี้เป็น "สมุดบันทึกแบบเขียนต่อท้ายอย่างเดียว" (append-only) แยกจากข้อมูลจริง จึงตอบได้ครบทั้ง 3 ข้อ
--
-- ============================================================================================
-- ทำไมใช้ trigger ในฐานข้อมูล ไม่ใช่เขียน log จากโค้ดแอป
-- ============================================================================================
-- trigger ทำงานที่ชั้นฐานข้อมูล จึงดักได้ "ทุกทาง" ที่ข้อมูลถูกแก้ ไม่ว่าจะผ่านหน้าเว็บ ผ่าน Supabase
-- Table Editor ตรงๆ หรือรัน SQL เอง — และเวลาเพิ่มฟีเจอร์ใหม่ทีหลัง ไม่มีทาง "ลืมใส่โค้ดบันทึก" เพราะ
-- ไม่ได้อยู่ในมือของโค้ดแอปตั้งแต่แรก ต่างจากการเขียน log จากฝั่งแอปที่ต้องไล่ใส่ทุกจุดและพลาดได้ง่าย
--
-- ============================================================================================
-- ขอบเขต: 5 ตารางที่มีผลทางบัญชี/สิทธิ์ (ตามที่ผู้ใช้เลือก 2026-09-14)
-- ============================================================================================
--   pending_tax_invoices    ใบกำกับภาษี (บันทึกการจ่ายเงิน)
--   business_partners       สมุดรายชื่อ
--   wht_certificates        ใบหัก ณ ที่จ่าย
--   bank_reconcile_reports  รายงานการกระทบยอด (หัวรายงาน)
--   company_members         สมาชิกบริษัท (ใครเข้าถึงข้อมูลบริษัทได้บ้าง)
-- จงใจไม่ผูก trigger กับตารางลูกของรายงานกระทบยอด (bank_reconcile_bank_rows / _gl_rows /
-- _match_groups) เพราะหนึ่งครั้งที่กด "บันทึกเป็นประวัติ" จะเขียนตารางพวกนี้ทีละหลายร้อยแถว จะได้ log
-- นับพันแถวต่อการกระทำเดียวของผู้ใช้ จนกลบรายการที่มีความหมายจริงๆ ไปหมด — การแก้ที่หัวรายงานพอบอกได้
-- อยู่แล้วว่าใครแตะรายงานฉบับไหนเมื่อไหร่
--
-- ============================================================================================
-- สิ่งที่ตารางนี้ "ไม่" ทำ
-- ============================================================================================
-- ไม่มีการลบอัตโนมัติตามอายุ (ไม่มี retention policy) — ระบบนี้เก็บเอกสารภาษีซึ่งกฎหมายไทยกำหนดให้เก็บ
-- เอกสารทางบัญชีไว้ 5 ปี จึงตั้งใจให้เก็บยาวไว้ก่อน ถ้าภายหลังข้อมูลเยอะจนอยากตัดของเก่าทิ้ง ค่อยเพิ่ม
-- migration ใหม่มาลบเฉพาะช่วงที่ต้องการ (ควรปรึกษาผู้สอบบัญชีก่อนว่าตัดได้ถึงปีไหน)

/* ============================== 1. ตารางประวัติ ============================== */
create table if not exists public.audit_logs (
  -- ใช้ bigint identity ไม่ใช่ uuid เพราะตารางนี้เขียนอย่างเดียว อ่านเรียงตามเวลาเป็นหลัก และจะโตเร็วกว่า
  -- ตารางอื่นมาก — ตัวเลขเรียงลำดับกินพื้นที่ index น้อยกว่าและเรียงตามลำดับการเกิดจริงได้แน่นอนแม้ใน
  -- วินาทีเดียวกัน (created_at อย่างเดียวอาจซ้ำกันเป๊ะได้)
  id bigint generated always as identity primary key,

  company_id uuid not null references public.companies (id) on delete cascade,

  -- ชื่อตารางและรหัสแถวที่ถูกกระทำ — record_id เป็น text ไม่ใช่ uuid เพราะ company_members ใช้
  -- primary key แบบผสม (company_id, user_id) จึงไม่มี uuid เดี่ยวๆ ให้อ้าง
  table_name text not null,
  record_id text not null,

  -- ชื่อที่คนอ่านรู้เรื่อง เก็บ ณ ตอนเกิดเหตุ (snapshot) ไม่ใช่ join เอาตอนแสดงผล — เพราะแถวต้นทางอาจถูก
  -- ลบไปแล้ว หรือถูกเปลี่ยนชื่อไปแล้ว ประวัติต้องบอกได้ว่า "ตอนนั้น" มันชื่ออะไร
  record_label text,

  action text not null check (action in ('insert', 'update', 'delete', 'restore_begin', 'restore_end')),

  -- เฉพาะ update: รายชื่อคอลัมน์ที่ค่าเปลี่ยนจริง (ไม่นับ updated_at/updated_by ที่ขยับทุกครั้งอยู่แล้ว)
  changed_fields text[],

  -- insert: new_values = ทั้งแถว / delete: old_values = ทั้งแถว / update: เก็บเฉพาะคอลัมน์ที่เปลี่ยน
  -- ทั้งสองฝั่ง เพื่อไม่ให้ตารางบวมด้วยค่าที่ไม่ได้เปลี่ยน
  old_values jsonb,
  new_values jsonb,

  -- ผู้กระทำ — เก็บอีเมลไว้ด้วย (ไม่ใช่แค่ user id) เพราะถ้าบัญชีนั้นถูกลบทีหลัง actor_id จะกลายเป็น null
  -- ตาม on delete set null แล้วประวัติจะไม่เหลือร่องรอยว่าใครทำ หลักการเดียวกับ created_by_email เดิม
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text,

  created_at timestamptz not null default now()
);

-- index ทั้งสามลงท้ายด้วย id desc ไม่ใช่ created_at desc โดยตั้งใจ — ต้องตรงกับ order by ที่
-- lib/auditLogApi.ts ใช้จริงเป๊ะๆ ไม่งั้น Postgres จะใช้ index ไม่ได้แล้วต้องเรียงข้อมูลทั้งบริษัทใหม่ทุก
-- ครั้งที่เปิดหน้า (ช้าลงมากเมื่อข้อมูลสะสมเป็นแสนแถว) ส่วนเหตุผลที่ฝั่งแอปเรียงด้วย id ไม่ใช่ created_at
-- คือสองแถวที่เกิดพร้อมกันอาจมี created_at เท่ากันเป๊ะ ทำให้ลำดับไม่คงที่จนแถวซ้ำ/หลุดตอนกดหน้าถัดไป
-- (id เป็น identity ที่เพิ่มตามลำดับการเกิดจริงเสมอ จึงเรียงตามเวลาได้เหมือนกันแต่ไม่มีทางเท่ากัน)

-- index หลัก: หน้าประวัติเปิดมาก็ถามว่า "บริษัทนี้ เรียงล่าสุดก่อน" เสมอ
create index if not exists audit_logs_company_id_idx
  on public.audit_logs (company_id, id desc);
-- สำหรับตัวกรอง "ดูเฉพาะเรื่องใบกำกับภาษี" ฯลฯ
create index if not exists audit_logs_company_table_idx
  on public.audit_logs (company_id, table_name, id desc);

-- จงใจยังไม่สร้าง index สำหรับค้นตามรายการเดียว (company_id, table_name, record_id) — ตอนนี้ยังไม่มีหน้าจอ
-- ไหนถามแบบนั้น index ที่ไม่มีใครใช้มีแต่ต้นทุน (ทุก insert ต้องอัปเดตมันด้วย และตารางนี้เขียนบ่อยที่สุดใน
-- ระบบ) ถ้าวันหนึ่งทำปุ่ม "ดูประวัติของใบกำกับภาษีใบนี้" ค่อยเพิ่ม migration ใหม่มาสร้าง index นี้พร้อมกัน

/* ============================== 2. RLS: อ่านได้อย่างเดียว ==============================
   หัวใจของ audit log คือ "คนที่ถูกตรวจสอบต้องแก้ประวัติตัวเองไม่ได้" — ถ้าแก้ได้ ประวัตินี้ก็ไม่ใช่หลักฐาน
   อะไรเลย จึงมี policy แค่ select อย่างเดียว ไม่มี insert/update/delete ให้ role authenticated เลย
   แม้แต่แอดมิน (เทียบกับตารางอื่นในระบบที่มีครบทั้ง 4 policy)

   แล้วใครเขียนได้: ฟังก์ชัน trigger ด้านล่างเป็น security definer จึงรันด้วยสิทธิ์เจ้าของฟังก์ชัน
   (postgres) ซึ่งข้าม RLS ได้ — เป็นทางเดียวที่แถวจะถูกเขียนลงตารางนี้

   ใครอ่านได้: สมาชิกทุกคนในบริษัทนั้น (ตามที่ผู้ใช้เลือก 2026-09-14 — "โปร่งใสกว่า เหมาะกับทีมที่ไว้ใจกัน
   ช่วยกันหาจุดที่ข้อมูลผิดได้เร็วขึ้น") ถ้าภายหลังอยากจำกัดเหลือเฉพาะแอดมิน เปลี่ยน using(...) ให้เรียก
   ฟังก์ชันเช็คแอดมินแทน is_company_member เท่านั้น ไม่ต้องแก้ที่อื่นเลย */
alter table public.audit_logs enable row level security;

drop policy if exists "company_member_select" on public.audit_logs;
create policy "company_member_select" on public.audit_logs
  for select to authenticated using (public.is_company_member(company_id));

/* ============================== 3. หน้าต่างพักการบันทึก (ใช้ตอนกู้คืนข้อมูล) ==============================
   ฟีเจอร์ "กู้คืนข้อมูลจากไฟล์สำรอง" (ดู lib/backupApi.ts) เขียนข้อมูลกลับเข้าไปทีละ 500 แถวหลายรอบ
   ถ้าปล่อยให้ trigger ทำงานตามปกติ จะได้ log หลายพันแถวจากการกดปุ่มครั้งเดียว จนกลบรายการจริงของวันนั้น
   ไปหมด ผู้ใช้เลือกไว้ว่าต้องการ "บันทึกเป็นเหตุการณ์เดียว" (2026-09-14)

   วิธีทำ: ก่อนเริ่มกู้คืน แอปเรียก audit_begin_restore() เพื่อจองหน้าต่างพักการบันทึกของ "ผู้ใช้คนนั้น
   คนเดียว" ไว้ 15 นาที แล้วพอเสร็จเรียก audit_end_restore() เพื่อปิดหน้าต่างและเขียนสรุปหนึ่งแถว

   ข้อแลกเปลี่ยนที่ต้องรู้ (ตั้งใจยอมรับ ไม่ใช่มองข้าม): ระหว่างหน้าต่างนี้เปิดอยู่ การแก้ข้อมูลอื่นของผู้ใช้
   คนนั้นก็จะไม่ถูกบันทึกไปด้วย จึงออกแบบให้ "การเปิดหน้าต่าง" ถูกบันทึกเป็นประวัติเองด้วย (action
   restore_begin) — ถ้ามีใครใช้ช่องนี้เลี่ยงการถูกบันทึก จะเห็นร่องรอยชัดเจนว่าเปิดหน้าต่างไว้ตอนไหนถึง
   ตอนไหน และหมดอายุเองใน 15 นาทีเสมอแม้แอปจะค้างกลางคัน (เช่น ปิดเบราว์เซอร์ตอนกู้คืนยังไม่จบ)

   ทางเลือกที่ปลอดภัยกว่าคือย้ายการกู้คืนทั้งหมดไปทำใน RPC เดียวแล้วใช้ set local ภายใน transaction
   (ผู้ใช้ตั้งค่าเองไม่ได้เลย) — ไม่เลือกทางนั้นรอบนี้เพราะต้องรื้อ lib/backupApi.ts ทั้งไฟล์และส่งไฟล์
   สำรองทั้งก้อน (อาจหลาย MB) เป็น payload ก้อนเดียว ซึ่งเสี่ยงกว่าสำหรับบริษัทที่มีข้อมูลเยอะ */
create table if not exists public.audit_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ไม่มี policy ใดๆ ทั้งสิ้น — ตารางนี้แตะได้ผ่าน RPC security definer ด้านล่างเท่านั้น
alter table public.audit_suspensions enable row level security;

/* ============================== 4. ฟังก์ชันช่วย: อีเมลของผู้กระทำ ==============================
   อ่านจาก JWT ที่แนบมากับ request ก่อน (ไม่ต้อง query ตารางเลย เร็วที่สุด) ถ้าไม่มีค่อยไปหาใน auth.users
   — กรณีที่ไม่มีทั้งคู่คือถูกเรียกจาก SQL editor / service role ซึ่งไม่มีผู้ใช้ที่ล็อกอินอยู่จริง คืน null
   แล้วให้ฝั่งแสดงผลเขียนว่า "ระบบ/ผู้ดูแล" แทน */
create or replace function public.current_actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid())
  );
$$;

/* ============================== 5. ฟังก์ชัน trigger กลาง ==============================
   ตัวเดียวใช้กับทุกตาราง แยกแยะตารางด้วย TG_TABLE_NAME ที่ PostgreSQL ส่งมาให้ — เพิ่มตารางใหม่ทีหลัง
   ทำแค่ผูก trigger เพิ่ม ไม่ต้องแก้ฟังก์ชันนี้ (ยกเว้นอยากได้ชื่อที่คนอ่านรู้เรื่องของตารางนั้นด้วย ก็เพิ่ม
   ใน case ของ v_label) */
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        jsonb;
  v_old        jsonb;
  v_new        jsonb;
  v_company_id uuid;
  v_record_id  text;
  v_label      text;
  v_changed    text[];
  v_old_diff   jsonb;
  v_new_diff   jsonb;
  v_actor      uuid := auth.uid();
  -- คอลัมน์ที่ขยับทุกครั้งที่แตะแถวอยู่แล้ว ไม่ถือเป็น "การเปลี่ยนแปลงที่มีความหมาย" — ถ้าไม่กรองออก
  -- ทุก update จะมี changed_fields อย่างน้อย 1 ตัวเสมอ แล้วกลไกข้าม log ตอนไม่มีอะไรเปลี่ยนจะไม่ทำงานเลย
  v_ignored constant text[] := array['updated_at', 'updated_by', 'updated_by_email'];
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);

  -- อยู่ในหน้าต่างกู้คืนข้อมูลของผู้ใช้คนนี้อยู่ → ไม่บันทึกทีละแถว (ดูเหตุผลเต็มที่หัวข้อ 3)
  if v_actor is not null and exists (
    select 1 from public.audit_suspensions s
    where s.user_id = v_actor and s.expires_at > now()
  ) then
    return coalesce(new, old);
  end if;

  v_company_id := nullif(v_row ->> 'company_id', '')::uuid;

  -- แถวเก่าบางแถวอาจยังไม่มี company_id (ข้อมูลก่อนรอบรองรับหลายบริษัท migration_007) — ข้ามการบันทึกไป
  -- ห้ามปล่อยให้ insert ล้มเพราะ company_id เป็น null เด็ดขาด เพราะ trigger ที่ error จะทำให้การบันทึก
  -- ข้อมูลจริงของผู้ใช้ล้มตามไปด้วยทั้งรายการ — ประวัติหายหนึ่งแถวยอมรับได้ ผู้ใช้บันทึกงานไม่ได้ยอมไม่ได้
  if v_company_id is null then
    return coalesce(new, old);
  end if;

  -- รหัสแถว: company_members ใช้ primary key ผสม จึงอ้างด้วย user_id ซึ่งเป็นตัวแยกแถวภายในบริษัทเดียวกัน
  v_record_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', '-');

  v_label := case tg_table_name
    when 'pending_tax_invoices' then v_row ->> 'vendor_name'
    when 'business_partners' then coalesce(
      nullif(v_row ->> 'company_name', ''),
      nullif(trim(coalesce(v_row ->> 'first_name', '') || ' ' || coalesce(v_row ->> 'last_name', '')), ''),
      v_row ->> 'contact_code'
    )
    when 'wht_certificates' then concat_ws(' — ', v_row ->> 'cert_number', v_row ->> 'payee_name')
    when 'bank_reconcile_reports' then v_row ->> 'report_name'
    -- แปลง user id เป็นอีเมลตั้งแต่ตอนบันทึก ไม่ใช่ตอนแสดงผล — การเพิ่ม/ถอนสมาชิกเป็นเหตุการณ์ที่เกี่ยวกับ
    -- ความปลอดภัยมากที่สุดที่ตารางนี้เก็บ ถ้าโชว์เป็น uuid เปล่าๆ คนอ่านจะไม่รู้เลยว่าหมายถึงใคร และถ้ารอไป
    -- join ตอนแสดงผล พอบัญชีนั้นถูกลบทีหลังก็จะหาชื่อไม่เจออีกแล้ว (หลักการเดียวกับที่เก็บ actor_email ไว้)
    when 'company_members' then coalesce(
      (select u.email from auth.users u where u.id = (v_row ->> 'user_id')::uuid),
      v_row ->> 'user_id'
    )
    else null
  end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}')
      into v_changed
      from (
        select key as k
        from jsonb_each(v_new)
        where key <> all (v_ignored)
          and (v_old -> key) is distinct from (v_new -> key)
      ) diff;

    -- ไม่มีอะไรเปลี่ยนจริง (เช่น กดบันทึกซ้ำโดยไม่แก้อะไร หรือ upsert ที่เขียนค่าเดิมทับ) → ไม่ต้องมีประวัติ
    -- ข้อนี้สำคัญมากกับฟีเจอร์กู้คืนแบบ merge ที่ upsert ทับของเดิมเป็นปกติ
    if cardinality(v_changed) = 0 then
      return new;
    end if;

    select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb) into v_old_diff from unnest(v_changed) k;
    select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb) into v_new_diff from unnest(v_changed) k;
  end if;

  insert into public.audit_logs (
    company_id, table_name, record_id, record_label, action,
    changed_fields, old_values, new_values, actor_id, actor_email
  ) values (
    v_company_id,
    tg_table_name,
    v_record_id,
    v_label,
    lower(tg_op),
    v_changed,
    case tg_op when 'UPDATE' then v_old_diff when 'DELETE' then v_old else null end,
    case tg_op when 'UPDATE' then v_new_diff when 'INSERT' then v_new else null end,
    v_actor,
    public.current_actor_email()
  );

  return coalesce(new, old);
exception
  -- กันเหนียว: ไม่ว่าจะเกิดอะไรผิดพลาดในการเขียนประวัติ ห้ามทำให้การบันทึกข้อมูลจริงของผู้ใช้ล้มเหลว
  -- (trigger ที่ raise exception จะ rollback ทั้ง statement รวมถึง insert/update ของผู้ใช้ด้วย)
  -- ยอมให้ประวัติขาดหายดีกว่าผู้ใช้กดบันทึกงานไม่ได้ — raise warning ไว้ให้ยังตามดูใน Postgres logs ได้
  when others then
    raise warning 'log_audit_event ล้มเหลวที่ตาราง % (%): %', tg_table_name, tg_op, sqlerrm;
    return coalesce(new, old);
end;
$$;

/* ============================== 6. ผูก trigger กับ 5 ตาราง ==============================
   after (ไม่ใช่ before) เพราะต้องการบันทึกเฉพาะการเปลี่ยนแปลงที่ผ่าน constraint/RLS แล้วจริงๆ เท่านั้น
   for each row เพราะต้องรู้ค่าเก่า/ใหม่รายแถว */
drop trigger if exists audit_pending_tax_invoices on public.pending_tax_invoices;
create trigger audit_pending_tax_invoices
  after insert or update or delete on public.pending_tax_invoices
  for each row execute function public.log_audit_event();

drop trigger if exists audit_business_partners on public.business_partners;
create trigger audit_business_partners
  after insert or update or delete on public.business_partners
  for each row execute function public.log_audit_event();

drop trigger if exists audit_wht_certificates on public.wht_certificates;
create trigger audit_wht_certificates
  after insert or update or delete on public.wht_certificates
  for each row execute function public.log_audit_event();

drop trigger if exists audit_bank_reconcile_reports on public.bank_reconcile_reports;
create trigger audit_bank_reconcile_reports
  after insert or update or delete on public.bank_reconcile_reports
  for each row execute function public.log_audit_event();

drop trigger if exists audit_company_members on public.company_members;
create trigger audit_company_members
  after insert or update or delete on public.company_members
  for each row execute function public.log_audit_event();

/* ============================== 7. RPC: เปิด/ปิดหน้าต่างกู้คืนข้อมูล ============================== */
create or replace function public.audit_begin_restore(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- เช็คสิทธิ์เองเพราะเป็น security definer (ข้าม RLS) — ถ้าไม่เช็ค ใครก็เรียกจองหน้าต่างของบริษัทอื่นได้
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงบริษัทนี้';
  end if;

  insert into public.audit_suspensions (user_id, company_id, expires_at)
  values (auth.uid(), p_company_id, now() + interval '15 minutes')
  on conflict (user_id) do update
    set company_id = excluded.company_id,
        started_at = now(),
        expires_at = excluded.expires_at;

  insert into public.audit_logs (
    company_id, table_name, record_id, record_label, action, actor_id, actor_email
  ) values (
    p_company_id, '-', '-', 'เริ่มกู้คืนข้อมูลจากไฟล์สำรอง', 'restore_begin',
    auth.uid(), public.current_actor_email()
  );
end;
$$;

-- p_summary: ข้อความสรุปที่ฝั่งแอปประกอบไว้แล้ว (เช่น "กู้คืนแบบเขียนทับ 1,248 รายการ จาก 8 ตาราง")
-- p_details: รายละเอียดแบบ jsonb (จำนวนแถวแยกตามตาราง, โหมด merge/replace, ชื่อไฟล์) เก็บไว้ให้กดดูได้
create or replace function public.audit_end_restore(
  p_company_id uuid,
  p_summary text,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงบริษัทนี้';
  end if;

  delete from public.audit_suspensions where user_id = auth.uid();

  insert into public.audit_logs (
    company_id, table_name, record_id, record_label, action, new_values, actor_id, actor_email
  ) values (
    p_company_id, '-', '-', p_summary, 'restore_end', p_details,
    auth.uid(), public.current_actor_email()
  );
end;
$$;

-- ปิดหน้าต่างโดยไม่เขียนสรุป — ใช้ตอนกู้คืนล้มเหลวกลางคัน แอปจะได้ไม่ทิ้งหน้าต่างค้างไว้ 15 นาทีเต็ม
create or replace function public.audit_cancel_restore()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- เช็ค auth.uid() ให้สอดคล้องกับอีกสองฟังก์ชัน แม้ตัวคำสั่งจะปลอดภัยอยู่แล้ว (ลบได้เฉพาะแถวของตัวเอง
  -- และถ้า auth.uid() เป็น null ก็ไม่มีแถวไหนตรงเงื่อนไข) — เขียนให้ชัดดีกว่าปล่อยให้คนอ่านต้องมานั่งพิสูจน์เอง
  if auth.uid() is null then
    return;
  end if;

  delete from public.audit_suspensions where user_id = auth.uid();
end;
$$;

grant execute on function public.audit_begin_restore(uuid) to authenticated;
grant execute on function public.audit_end_restore(uuid, text, jsonb) to authenticated;
grant execute on function public.audit_cancel_restore() to authenticated;
