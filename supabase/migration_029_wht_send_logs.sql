-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 029: ประวัติการส่งอีเมลใบหัก ณ ที่จ่าย + ปิดหนี้ schema ที่ค้างจากรอบ "ปุ่มส่งอีเมล"
-- รันทั้งไฟล์ผ่าน Supabase SQL Editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent)
--
-- ========================= ที่มา =========================
-- รอบนี้ผู้ใช้ขอ 2 อย่างกับฟีเจอร์ส่งอีเมลใบหัก ณ ที่จ่าย (2026-09-23): หน้าต่างยืนยันก่อนส่ง และ
-- ประวัติการส่งที่เห็นทั้งครั้งที่สำเร็จและครั้งที่ล้มเหลว — ข้อหลังทำไม่ได้เลยด้วย schema เดิม
--
-- ตรวจโค้ดแล้วพบหนี้ที่ค้างอยู่ 1 อย่างซึ่งต้องปิดก่อน: คอลัมน์ email_sent_at / email_sent_to ถูกใช้งานจริง
-- ใน app/api/wht-certificate/send/route.ts และ types/whtCertificate.ts มาตั้งแต่ 2026-08-11 แต่ **ไม่มีไฟล์
-- migration ไหนในโปรเจกต์นี้สร้างสองคอลัมน์นี้เลย** (คอมเมนต์ในโค้ดอ้างถึง "migration_017" แต่ไฟล์นั้นเป็น
-- เรื่องโลโก้บริษัท/Storage ล้วนๆ ไม่มี DDL ของคอลัมน์อีเมล — grep ทั้ง supabase/ ไม่เจอ email_sent_ ที่ไหน)
-- แปลว่าคอลัมน์มีอยู่ในฐานข้อมูลจริงเพราะมีคนเพิ่มด้วยมือ ถ้าตั้งฐานข้อมูลใหม่จาก migration ทั้งชุด ฟีเจอร์
-- ส่งอีเมลจะพังทันทีตอน update ข้อ 1 ด้านล่างจึงเขียนย้อนหลังให้ครบ (add column if not exists = ฐานข้อมูล
-- ปัจจุบันที่มีคอลัมน์อยู่แล้วจะไม่ถูกแตะ ข้อมูลเดิมไม่หาย)
--
-- ========================= ทำไมต้องเป็นตารางแยก ไม่ใช่เพิ่มคอลัมน์ =========================
-- email_sent_at/email_sent_to ตอบได้แค่ "ส่งครั้งล่าสุดเมื่อไร ถึงใคร" และถูกเขียนทับทุกครั้ง ส่วนที่ผู้ใช้
-- ขอคือ "ส่งกี่ครั้ง ใครกดส่ง ครั้งไหนล้มเหลวเพราะอะไร" ซึ่งเป็นความสัมพันธ์แบบหนึ่งใบต่อหลายครั้ง
--
-- ที่สำคัญกว่า: ของเดิมบันทึก "เฉพาะตอนสำเร็จ" เท่านั้น การส่งที่ล้มเหลวหายไปเงียบๆ เหลือแค่ console.error
-- ที่ terminal ฝั่ง server ซึ่งผู้ใช้ไม่มีทางเห็น — ตารางนี้จึงต้องรับแถวที่ status = 'failed' ได้ด้วย
--
-- ทางเลือกที่ไม่เลือก: ใช้ audit_logs (migration_026) แทน — trigger ของมันบันทึก UPDATE บน wht_certificates
-- อยู่แล้ว จึงมี "ร่องรอย" การส่งสำเร็จหลงเหลืออยู่โดยบังเอิญ แต่ (ก) ไม่มีทางบันทึกครั้งที่ล้มเหลวได้เลย
-- เพราะไม่มี UPDATE เกิดขึ้น (ข) ต้องไปเดาจาก changed_fields ว่า update ครั้งไหนคือการส่งอีเมล ซึ่งเปราะมาก
-- และ (ค) audit_logs ถูกพักการบันทึกระหว่างกู้คืนข้อมูล (audit_suspensions) ประวัติการส่งไม่ควรหายไปด้วย

/* ============================== 1. ปิดหนี้: คอลัมน์ที่ใช้งานอยู่แต่ไม่เคยมี migration ==============
   ทั้งสองคอลัมน์คือ "ครั้งล่าสุด" เก็บไว้เพื่อให้ตารางในหน้าประวัติใบหัก ณ ที่จ่ายแสดงสถานะได้เร็วโดยไม่ต้อง
   join ตารางประวัติทุกครั้ง (denormalize ตั้งใจ) ตารางในข้อ 2 คือแหล่งความจริงของ "ทุกครั้ง" */
alter table public.wht_certificates
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_sent_to text;

comment on column public.wht_certificates.email_sent_at is
  'เวลาที่ส่งอีเมลใบนี้สำเร็จครั้งล่าสุด (null = ยังไม่เคยส่งสำเร็จเลย) — เขียนทับทุกครั้งที่ส่งสำเร็จ ประวัติทุกครั้งดูที่ wht_certificate_send_logs';
comment on column public.wht_certificates.email_sent_to is
  'ที่อยู่อีเมลปลายทางของการส่งสำเร็จครั้งล่าสุด — เป็น snapshot ณ ตอนส่ง ไม่ใช่ live reference ไปยังสมุดรายชื่อ';

/* ============================== 2. ตารางประวัติการส่ง ==============================
   company_id เก็บซ้ำแม้จะหาจาก certificate_id ได้ เพราะ RLS ของทุกตารางในระบบนี้กรองด้วย
   is_company_member(company_id) ตรงๆ (ดู migration_007) ถ้าไม่มีคอลัมน์นี้ policy ต้อง subquery ไปที่
   wht_certificates ทุกแถว ซึ่งช้ากว่าและพังทันทีถ้าใบถูกลบ — และ trigger audit ของ migration_026 ก็อ่าน
   company_id จากแถวตรงๆ เช่นกัน (ถ้าไม่มีจะข้ามการบันทึกไปเงียบๆ)

   certificate_id ใช้ on delete cascade — ใบถูกลบ (เช่นตอนกู้คืนข้อมูลแบบ replace, migration_025) ประวัติ
   การส่งของใบนั้นก็ควรหายตามไป ไม่เหลือแถวกำพร้าที่ชี้ไปยังใบที่ไม่มีอยู่แล้ว */
create table if not exists public.wht_certificate_send_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  certificate_id uuid not null references public.wht_certificates (id) on delete cascade,

  -- 'success' = SMTP รับเรื่องไปแล้ว (ไม่ได้แปลว่าถึงกล่องขาเข้าผู้รับจริง — ระบบไม่มี bounce/delivery
  -- tracking) 'failed' = ยิงแล้วไม่ผ่าน ไม่ว่าจะด้วยสาเหตุใด
  status         text not null check (status in ('success', 'failed')),

  -- ที่อยู่ปลายทาง ณ ตอนนั้น — เก็บไว้แม้ในแถวที่ล้มเหลว จะได้รู้ว่าพยายามส่งไปที่ไหน null ได้เฉพาะกรณี
  -- ที่ล้มเหลวตั้งแต่ก่อนรู้ปลายทาง (เช่น ผู้ขายยังไม่มีอีเมลในสมุดรายชื่อ)
  sent_to        text,

  -- รหัส error ที่ API ใช้ภายใน (no_recipient_email, send_failed, file_too_large ฯลฯ) ให้ฝั่ง UI แปลเป็น
  -- ภาษาไทยเองผ่าน SEND_ERROR_MESSAGES ที่มีอยู่แล้วใน lib/whtCertificateApi.ts ไม่ต้องเก็บข้อความไทยลง DB
  error_code     text,

  -- ข้อความดิบจาก nodemailer/SMTP (เช่น "Invalid login", "Daily user sending limit exceeded") เก็บไว้ให้
  -- ผู้ดูแลระบบไล่ปัญหาได้จากหน้าเว็บ ไม่ต้องไปงม log ที่ Vercel — ตัดความยาวที่ฝั่งแอปก่อนเขียนลงมา
  error_message  text,

  -- ผู้กดส่ง เก็บทั้ง id และอีเมล ณ ตอนนั้น (แนวเดียวกับ created_by/created_by_email ของตารางอื่นในระบบ)
  -- on delete set null เพราะประวัติต้องอยู่ต่อแม้ผู้ใช้คนนั้นถูกลบบัญชีไปแล้ว
  actor_id       uuid references auth.users (id) on delete set null,
  actor_email    text,

  created_at     timestamptz not null default now()
);

comment on table public.wht_certificate_send_logs is
  'ประวัติการส่งอีเมลใบหัก ณ ที่จ่ายทุกครั้ง ทั้งที่สำเร็จและล้มเหลว — เขียนโดย app/api/wht-certificate/send/route.ts เท่านั้น';

-- ดัชนีตามรูปแบบการอ่านจริง: หน้า UI เปิดประวัติของใบทีละใบ เรียงใหม่ไปเก่า
create index if not exists wht_cert_send_logs_cert_idx
  on public.wht_certificate_send_logs (certificate_id, created_at desc);
create index if not exists wht_cert_send_logs_company_idx
  on public.wht_certificate_send_logs (company_id, created_at desc);

/* ============================== 3. RLS ==============================
   อ่าน: สมาชิกบริษัทนั้นทุกคน (แนวเดียวกับ audit_logs ใน migration_026 — ผู้ใช้เลือกไว้แล้วว่าโปร่งใสกว่า)
   เขียน: ต้องเป็นสมาชิกบริษัท และ actor_id ต้องเป็นตัวเอง — กันการปลอมว่าคนอื่นเป็นคนกดส่ง
   แก้/ลบ: ไม่มี policy เลยโดยตั้งใจ ประวัติที่แก้ย้อนหลังได้ก็ไม่ใช่ประวัติ (แถวจะหายก็ต่อเมื่อใบต้นทาง
   ถูกลบผ่าน cascade เท่านั้น)

   ทุก policy ระบุ `to authenticated` ชัดเจนตามกติกาที่ตั้งไว้ใน migration_028 — policy ที่ไม่ระบุ role
   จะครอบ anon ไปด้วยเสมอ */
alter table public.wht_certificate_send_logs enable row level security;

drop policy if exists "select_own_send_logs" on public.wht_certificate_send_logs;
create policy "select_own_send_logs" on public.wht_certificate_send_logs
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "insert_own_send_logs" on public.wht_certificate_send_logs;
create policy "insert_own_send_logs" on public.wht_certificate_send_logs
  for insert
  to authenticated
  with check (public.is_company_member(company_id) and actor_id = auth.uid());

/* ============================== 4. สิทธิ์ระดับตาราง ==============================
   migration_028 ปิดสิทธิ์ของ anon ทั้ง schema ไปแล้ว และตั้ง default privileges ไม่ให้ของใหม่ได้สิทธิ์ anon
   กลับมา — แต่เขียนย้ำตรงนี้ให้ชัดเจน เผื่อฐานข้อมูลที่ยังไม่ได้รัน 028 (จะได้ไม่เปิดช่องใหม่โดยไม่ตั้งใจ) */
revoke all on public.wht_certificate_send_logs from anon, public;
grant select, insert on public.wht_certificate_send_logs to authenticated;
grant all on public.wht_certificate_send_logs to service_role;
