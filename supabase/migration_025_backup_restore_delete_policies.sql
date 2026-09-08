-- migration_025_backup_restore_delete_policies.sql
-- ===============================================================================================
-- รองรับฟีเจอร์ "สำรอง/กู้คืนข้อมูล" (เพิ่มเข้ามา 2026-09-08) โหมด "ล้างข้อมูลเดิมก่อนกู้คืน"
--
-- ปัญหาที่ต้องแก้: ตาราง wht_certificates และ wht_certificate_counters ถูกสร้างขึ้นพร้อม RLS policy แค่
-- select/insert/update เท่านั้น (ดู migration_014, migration_015) ไม่เคยมี policy สำหรับ delete เลย —
-- เพราะตอนออกแบบตั้งใจว่าใบหัก ณ ที่จ่ายที่ออกไปแล้ว "ยกเลิก (void)" ได้อย่างเดียว ลบทิ้งไม่ได้
-- (ดู migration_016_void_wht_certificate.sql) ซึ่งยังเป็นหลักการที่ถูกต้องอยู่สำหรับการใช้งานปกติ
--
-- แต่โหมด "ล้างข้อมูลเดิมก่อนกู้คืน" ต้องลบแถวเดิมออกให้หมดก่อนเขียนจากไฟล์สำรอง ไม่งั้นจะเหลือใบที่ถูกลบไป
-- แล้วในไฟล์สำรองค้างอยู่ในระบบตลอดไป (upsert ทับได้เฉพาะแถวที่ id ตรงกันเท่านั้น ไม่ลบแถวส่วนเกินให้)
-- และที่แย่กว่านั้นคือ RLS ที่ไม่มี policy delete จะทำให้คำสั่งลบ "สำเร็จแบบไม่ลบอะไรเลย" (0 แถว ไม่ error)
-- ผู้ใช้จะเข้าใจผิดว่ากู้คืนครบแล้วทั้งที่ยังมีข้อมูลเก่าปนอยู่
--
-- ทำไมการเพิ่ม policy นี้ไม่ได้ให้สิทธิ์ใหม่ที่อันตราย: สมาชิกบริษัทลบข้อมูลทั้งหมดนี้ได้อยู่แล้วผ่านปุ่ม
-- "ลบบริษัท" ในหน้าตั้งค่าบริษัท (migration_024 ผูก on delete cascade ไว้ครบทุกตาราง + policy
-- "delete_member_companies") — policy ชุดนี้จึงแค่เปิดทางให้ลบเป็นรายบริษัทได้โดยไม่ต้องลบทั้งบริษัททิ้ง
-- ขอบเขตสิทธิ์เท่าเดิมเป๊ะ คือ "ต้องเป็นสมาชิกของบริษัทนั้น" (public.is_company_member) เหมือนทุก policy อื่น
--
-- ปลอดภัยที่จะรันซ้ำได้ (drop policy if exists ก่อน create ทุกครั้ง ตามธรรมเนียมเดิมของโปรเจกต์นี้)
-- ===============================================================================================

drop policy if exists "delete_own_certificates" on public.wht_certificates;
create policy "delete_own_certificates" on public.wht_certificates
  for delete
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "delete_own_counters" on public.wht_certificate_counters;
create policy "delete_own_counters" on public.wht_certificate_counters
  for delete
  to authenticated
  using (public.is_company_member(company_id));

comment on table public.wht_certificates is
  'ใบหัก ณ ที่จ่ายที่ออกแล้ว (หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ) — payer_*/payee_* เป็น snapshot ณ วันที่ออก ไม่ใช่ live reference / การใช้งานปกติให้ "ยกเลิก (void)" เท่านั้น ส่วน policy delete มีไว้รองรับการกู้คืนข้อมูลจากไฟล์สำรองแบบล้างของเดิมก่อน (migration_025)';
