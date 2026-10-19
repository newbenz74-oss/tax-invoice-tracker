-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 035: แยก "คำนำหน้า" ออกมาเป็นช่องของตัวเองในสมุดรายชื่อ
-- รันทั้งไฟล์ผ่าน Supabase SQL Editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent — รอบที่สองจะไม่เจอคำนำหน้า
-- ค้างอยู่ในช่องชื่อแล้ว จึงไม่มีอะไรให้ย้าย)
--
-- ========================= ที่มา =========================
-- ผู้ใช้แจ้ง 2026-10-19: "สมุดรายชื่อไม่มีคำนำหน้า อย่างเช่น บริษัท, นาย, นาง, นางสาว"
--
-- เดิมมีแค่ช่อง company_name (นิติบุคคล) กับ first_name/last_name (บุคคลธรรมดา) คำนำหน้าจึงต้องพิมพ์ปนเข้าไป
-- ในช่องชื่อ ผลคือข้อมูลจริงในระบบปนกันสองแบบ: บางรายมี ('นางสาวกนกพร คชชนก', 'บริษัท บางมด เอ็นเตอร์ไพร์ส
-- จำกัด') บางรายไม่มี ('กรกนก จงจิรกิตติ์กุล', 'กรณ์รัฐภาส ธนวัตไชยศรี')
--
-- ========================= ทำไมต้องแยกช่อง ไม่ใช่เดาเอาตอนใช้ =========================
-- ไฟล์ RD Prep ของกรมสรรพากรมีช่อง "คำนำหน้า" กว้าง 15 ตัวอักษรแยกจากช่องชื่อ (ดู lib/rdPrepExport.ts) เดิม
-- ระบบต้องเดาด้วยการตัดข้อความหน้าชื่อ ซึ่งเดาได้ก็ต่อเมื่อผู้ใช้พิมพ์มาจริงเท่านั้น รายที่ไม่ได้พิมพ์จะได้ช่อง
-- ว่างและขึ้นคำเตือนตอนส่งออก — การเก็บเป็นช่องของตัวเองทำให้กรอกครบได้ตั้งแต่ต้นทางและไม่ต้องเดาอีกเลย
--
-- ========================= ขอบเขตการย้ายข้อมูล =========================
-- ตัดเฉพาะคำนำหน้าที่อยู่ในรายการด้านล่าง และต้องอยู่ "หน้าสุด" ของข้อความเท่านั้น
--   - เจอ   → ย้ายไป title แล้วตัดออกจากช่องชื่อ (ตัดช่องว่างที่ตามมาด้วย)
--   - ไม่เจอ → ไม่แตะเลย title เป็น null ผู้ใช้ไปเลือกเองทีหลังได้
-- ไม่เดา ไม่ใส่ค่าเริ่มต้นให้ — เดาคำนำหน้าผิดเพศบนเอกสารภาษีเสียหายกว่าปล่อยว่าง
--
-- เลือกคำนำหน้าที่ "ยาวที่สุดที่ตรง" เสมอ ('นางสาว' ต้องชนะ 'นาง' ไม่ใช่กลับกัน ไม่งั้น 'นางสาวสมใจ' จะกลายเป็น
-- คำนำหน้า 'นาง' + ชื่อ 'สาวสมใจ')

/* ============================== 1. เพิ่มคอลัมน์ ============================== */
alter table public.business_partners
  add column if not exists title text;

comment on column public.business_partners.title is
  'คำนำหน้า (นาย/นาง/นางสาว/บริษัท/หจก. ฯลฯ) — แยกจากช่องชื่อเพราะไฟล์ RD Prep ของกรมสรรพากรมีช่องนี้ต่างหาก กว้าง 15 ตัวอักษร / null = ยังไม่ได้ระบุ ดู migration_035';

/* ============================== 2. ย้ายคำนำหน้าของบุคคลธรรมดา ==============================
   ใช้ lateral join หาคำนำหน้าที่ "ยาวที่สุดที่ตรง" แทนการไล่ CASE ทีละตัว — อ่านง่ายกว่าและไม่มีทางเรียง
   ลำดับผิดพลาดเอง (order by length(p) desc จัดการให้แล้ว)

   ⚠️ lateral ต้องอยู่ใน CTE (select ธรรมดา) ไม่ใช่ใน FROM ของ UPDATE โดยตรง — PostgreSQL ไม่ยอมให้
   subquery ใน FROM ของ UPDATE อ้างถึงตารางที่กำลังอัปเดตอยู่ (ERROR 42P10 invalid reference to
   FROM-clause entry) จึงต้องคำนวณคู่ (id, คำนำหน้า) ให้เสร็จก่อน แล้วค่อย join กลับเข้ามาตอน UPDATE */
with person_prefixes(p) as (
  values ('ว่าที่ร้อยตรี'), ('เด็กหญิง'), ('เด็กชาย'), ('นางสาว'), ('ด.ช.'), ('ด.ญ.'), ('น.ส.'), ('นาง'), ('นาย')
),
person_matched as (
  select bp.id, m.p
  from public.business_partners bp
  join lateral (
    select p from person_prefixes
    where bp.first_name like p || '%'
    order by length(p) desc
    limit 1
  ) m on true
  where bp.entity_type = 'individual'
    and bp.title is null
    and bp.first_name is not null
)
update public.business_partners bp
set title = person_matched.p,
    first_name = nullif(btrim(substr(bp.first_name, length(person_matched.p) + 1)), '')
from person_matched
where person_matched.id = bp.id;

/* ============================== 3. ย้ายคำนำหน้าของนิติบุคคล ============================== */
with juristic_prefixes(p) as (
  values ('ห้างหุ้นส่วนสามัญนิติบุคคล'), ('ห้างหุ้นส่วนจำกัด'), ('ห้างหุ้นส่วนสามัญ'), ('บริษัท'),
         ('ธนาคาร'), ('มหาวิทยาลัย'), ('โรงเรียน'), ('สำนักงาน'), ('สหกรณ์'), ('สถาบัน'),
         ('มูลนิธิ'), ('สมาคม'), ('องค์การ'), ('กองทุน'), ('หจก.'), ('บมจ.'), ('ร้าน'), ('วัด')
),
juristic_matched as (
  select bp.id, m.p
  from public.business_partners bp
  join lateral (
    select p from juristic_prefixes
    where bp.company_name like p || '%'
    order by length(p) desc
    limit 1
  ) m on true
  where bp.entity_type = 'company'
    and bp.title is null
    and bp.company_name is not null
)
update public.business_partners bp
set title = juristic_matched.p,
    company_name = nullif(btrim(substr(bp.company_name, length(juristic_matched.p) + 1)), '')
from juristic_matched
where juristic_matched.id = bp.id;

/* ============================== 4. กันเคสที่ตัดแล้วชื่อหายหมด ==============================
   ถ้าช่องชื่อมีแต่คำนำหน้าล้วนๆ (เช่น company_name = 'บริษัท' เฉยๆ) ขั้นตอนข้างบนจะทำให้ชื่อกลายเป็น null
   ซึ่งแย่กว่าเดิม — คืนค่ากลับไปเป็นเหมือนเดิมแล้วปล่อย title ว่างไว้ ให้ผู้ใช้ไปแก้เอง */
update public.business_partners
set company_name = title, title = null
where entity_type = 'company' and company_name is null and title is not null;

update public.business_partners
set first_name = title, title = null
where entity_type = 'individual' and first_name is null and title is not null;

/* ============================== 5. ตรวจผลหลังรัน ==============================
   ดูว่าย้ายได้กี่ราย เหลือกี่รายที่ยังไม่มีคำนำหน้า (ต้องไปกรอกเองที่หน้าสมุดรายชื่อ) */
select entity_type                                             as ประเภท,
       count(*)                                                as ทั้งหมด,
       count(*) filter (where title is not null)                as มีคำนำหน้าแล้ว,
       count(*) filter (where title is null)                    as ยังไม่มีคำนำหน้า
from public.business_partners
group by entity_type
order by entity_type;
