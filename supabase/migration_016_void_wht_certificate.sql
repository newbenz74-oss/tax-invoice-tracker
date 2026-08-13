-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 016: RPC ยกเลิกใบหัก ณ ที่จ่าย (void_wht_certificate)
--
-- ผู้ใช้ขอปุ่ม "แก้ไข" และ "ลบ" ในหน้าประวัติใบหัก ณ ที่จ่าย (2026-08-11) — หลังคุยรายละเอียดแล้วตกลงกันว่า:
-- 1. "ลบ" = ยกเลิก (soft delete) เท่านั้น ไม่ลบแถวออกจากฐานข้อมูลจริง (เก็บประวัติไว้ตรวจสอบย้อนหลังได้
--    ตามธรรมชาติของเอกสารทางการที่ต้องมีเลขที่ต่อเนื่อง ไม่ควรหายไปจากระบบเฉยๆ)
-- 2. "แก้ไข" = ยกเลิกใบเดิม (เหตุผลเดียวกับข้อ 1) แล้วออกใบใหม่ผ่าน create_wht_certificate() เดิม (ได้เลขที่
--    ใหม่ต่อเนื่อง) — ฝั่ง frontend เท่านั้นที่ต้องเรียก void_wht_certificate() ก่อนแล้วค่อยเรียก
--    create_wht_certificate() ซ้ำ (ไม่ใช่ RPC เดียวรวมกัน เพราะ create_wht_certificate() เดิมทำงานถูกต้อง
--    สมบูรณ์อยู่แล้ว ไม่จำเป็นต้องแก้)
--
-- ทั้งสองปุ่มจึงใช้ RPC เดียวกันนี้ — void_wht_certificate() ทำ 2 อย่างแบบ atomic ในทรานแซกชันเดียว:
-- (1) เปลี่ยนสถานะใบเป็น 'voided' พร้อมเวลา/เหตุผลที่ยกเลิก (2) ปลดรายการจ่ายเงินที่เคยผูกกับใบนี้ทั้งหมด
-- กลับไปเป็น wht_certificate_id = null (กลับมาเลือกออกใบใหม่ได้อีกครั้ง — ใช้ pattern เดียวกับ FK
-- "on delete set null" ที่ตั้งใจไว้ตั้งแต่ migration_015 แต่ตรงนี้เป็น UPDATE ไม่ใช่ DELETE จึงต้องทำเองตรงๆ)
--
-- SECURITY INVOKER (ค่าเริ่มต้น) เหมือน create_wht_certificate() — RLS ปกติของทั้งสองตาราง
-- (update_own_certificates / company_member_update) ก็เพียงพอแล้วเพราะผู้เรียกต้องเป็นสมาชิกบริษัทอยู่แล้ว
create or replace function public.void_wht_certificate(
  p_cert_id uuid,
  p_reason text
)
returns public.wht_certificates
language plpgsql
set search_path = ''
as $$
declare
  v_result public.wht_certificates;
begin
  select * into v_result from public.wht_certificates where id = p_cert_id;

  if v_result.id is null then
    raise exception 'ไม่พบใบหัก ณ ที่จ่ายนี้';
  end if;

  if not public.is_company_member(v_result.company_id) then
    raise exception 'คุณไม่ใช่สมาชิกของบริษัทนี้';
  end if;

  if v_result.status = 'voided' then
    raise exception 'ใบนี้ถูกยกเลิกไปแล้ว';
  end if;

  update public.wht_certificates
  set status = 'voided', voided_at = now(), void_reason = nullif(trim(p_reason), '')
  where id = p_cert_id
  returning * into v_result;

  update public.pending_tax_invoices
  set wht_certificate_id = null
  where wht_certificate_id = p_cert_id;

  return v_result;
end;
$$;

revoke all on function public.void_wht_certificate(uuid, text) from public;
grant execute on function public.void_wht_certificate(uuid, text) to authenticated;
revoke execute on function public.void_wht_certificate(uuid, text) from anon;
