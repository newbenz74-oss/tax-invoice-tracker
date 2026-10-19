-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 036: คำสั่ง "แก้ไขใบหัก ณ ที่จ่าย" ที่แก้ใบเดิมจริงๆ (ไม่ยกเลิกแล้วสร้างใหม่)
-- รันทั้งไฟล์ผ่าน Supabase SQL Editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (create or replace)
--
-- ========================= ที่มา =========================
-- ผู้ใช้แจ้ง 2026-10-19 สองรอบติดกัน:
--   1. "เมื่อฉันกดแก้ไขใบหัก ณ ที่จ่ายแล้ว เหมือนประวัติการส่งเมลใบหักหายไป ฉันไม่อยากให้มันหายไป เพราะ
--      มันเคยส่งไปแล้ว ฉันแค่ต้องการแก้ไขนิดหน่อย ถ้ามันหายไปแบบนี้ฉันจะจำไม่ได้ว่าเคยส่งแล้ว แล้วกดส่งซ้ำ"
--   2. "ถ้าการแก้ไขไม่ได้แก้ใบเดิม ควรเป็นการแก้ไขสิ ไม่ใช่ยกเลิกใบเดิมแล้วสร้างใหม่ มันจะทำให้กลายเป็น
--      คนละ ID กัน"
--
-- ข้อที่สองคือต้นเหตุจริง: ระบบไม่เคยมีคำสั่ง "แก้ไข" เลย มีแค่ create_wht_certificate กับ
-- void_wht_certificate ปุ่ม "แก้ไข" บนหน้าเว็บจึงเอาสองคำสั่งนั้นมาต่อกัน (ยกเลิกใบเดิม → เปิดฟอร์มออกใบใหม่)
-- ผลคือทุกครั้งที่แก้แม้แต่ตัวอักษรเดียว ใบจะได้ id ใหม่ แล้วทุกอย่างที่ผูกกับ id เดิมก็ขาดไปด้วย —
-- ประวัติการส่งอีเมล (wht_certificate_send_logs.certificate_id) เป็นตัวที่เห็นผลชัดที่สุด
--
-- ผมเคยพยายามแก้ที่ปลายเหตุสองรอบก่อนจะมาทางนี้ (ให้ประวัติค้นด้วยเลขที่ใบ — ผิด เพราะเลขที่ใช้ซ้ำได้ตั้งแต่
-- migration_034 จึงอาจเป็นคนละผู้รับ / แล้วเปลี่ยนเป็นผูกสายว่าใบไหนแทนใบไหน — ซับซ้อนโดยไม่จำเป็น)
-- ทั้งสองทางเป็นการแก้อาการ ไม่ใช่แก้เหตุ
--
-- ========================= สิ่งที่ฟังก์ชันนี้ทำ =========================
-- แก้แถวเดิมในที่เดิม (UPDATE) — id, ประวัติการส่งอีเมล, และทุกอย่างที่อ้าง id นี้อยู่ ยังอยู่ครบเหมือนเดิม
--   1. ตรวจสิทธิ์ + ตรวจว่าใบยังไม่ถูกยกเลิก (ใบที่ยกเลิกแล้วแก้ไม่ได้ ต้องออกใบใหม่)
--   2. คิดยอดใหม่จากรายการจ่ายเงินที่เลือกมา (รวมรายการที่ผูกกับใบนี้อยู่แล้ว ซึ่งต่างจากตอนสร้างใบใหม่)
--   3. ปลดรายการที่ถูกเอาออกจากใบ และผูกรายการที่เพิ่มเข้ามาใหม่
--   4. เปลี่ยนเลขที่ใบได้ถ้าผู้ใช้แก้ (ตรวจไม่ให้ซ้ำกับใบอื่นที่ยังมีผล)
--
-- ========================= เรื่องที่ตั้งใจไม่แตะ =========================
-- email_sent_at / email_sent_to ไม่ถูกล้าง — "เคยส่งไปแล้ว" เป็นข้อเท็จจริงที่การแก้เอกสารภายหลังไม่ได้
-- ลบล้าง ผู้ใช้ต้องเห็นว่าส่งไปเมื่อไรเพื่อตัดสินใจเองว่าจะส่งฉบับแก้ไขซ้ำหรือไม่ (ซึ่งคือสิ่งที่ผู้ใช้ขอ)
--
-- created_by / created_at ไม่ถูกแตะเช่นกัน — คนที่ออกใบครั้งแรกยังเป็นคนเดิม ส่วน "ใครแก้อะไรเมื่อไร"
-- ถูกบันทึกอัตโนมัติอยู่แล้วที่ตาราง audit_logs (migration_026) จึงไม่ต้องเก็บซ้ำในตารางนี้
--
-- ========================= ผลกระทบ =========================
-- ✅ เพิ่มฟังก์ชันใหม่อย่างเดียว ไม่แตะตาราง ไม่แตะข้อมูลเดิม ไม่แก้ฟังก์ชันที่มีอยู่
-- ✅ ใบที่เคยถูก "แก้ไข" ด้วยวิธีเก่าไปแล้วยังอยู่เหมือนเดิมทุกประการ (ประวัติที่ขาดไปแล้วต่อกลับไม่ได้
--    แต่ตั้งแต่นี้ไปจะไม่ขาดอีก)
-- ⚠️ หน้าเว็บต้องอัปเดตให้เรียกฟังก์ชันนี้ก่อน ปุ่ม "แก้ไข" ถึงจะเปลี่ยนพฤติกรรม — รัน migration นี้เฉยๆ
--    ยังไม่มีอะไรเปลี่ยนบนหน้าจอ และไม่ทำให้ของเดิมพัง

create or replace function public.update_wht_certificate(
  p_cert_id uuid,
  p_form_type text,
  p_period_year smallint,
  p_period_month smallint,
  p_business_partner_id uuid,
  p_income_type_code text,
  p_income_type_label text,
  p_deduction_type text,
  p_deduction_type_note text,
  p_signer_name text,
  p_issued_date date,
  p_payer jsonb,
  p_payee jsonb,
  p_invoice_ids uuid[],
  p_sequence_override integer default null
)
returns public.wht_certificates
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.wht_certificates;
  v_seq integer;
  v_cert_number text;
  v_total_amount numeric(14, 2);
  v_total_excl_vat numeric(14, 2);
  v_total_wht numeric(14, 2);
  v_payment_date date;
  v_matched_count integer;
  v_result public.wht_certificates;
begin
  select * into v_existing from public.wht_certificates where id = p_cert_id;

  if v_existing.id is null then
    raise exception 'ไม่พบใบหัก ณ ที่จ่ายนี้';
  end if;

  if not public.is_company_member(v_existing.company_id) then
    raise exception 'คุณไม่ใช่สมาชิกของบริษัทนี้';
  end if;

  -- ใบที่ยกเลิกไปแล้วแก้ไม่ได้ — เอกสารที่ยกเลิกแล้วต้องคงสภาพ ณ วันที่ยกเลิกไว้เป็นหลักฐาน
  if v_existing.status <> 'issued' then
    raise exception 'ใบนี้ถูกยกเลิกไปแล้ว แก้ไขไม่ได้ กรุณาออกใบใหม่แทน';
  end if;

  if p_invoice_ids is null or array_length(p_invoice_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อย 1 รายการ';
  end if;

  if not exists (
    select 1 from public.business_partners
    where id = p_business_partner_id and company_id = v_existing.company_id
  ) then
    raise exception 'ไม่พบผู้ขายรายนี้ในสมุดรายชื่อของบริษัทนี้';
  end if;

  -- ต่างจากตอนสร้างใบใหม่ตรงเงื่อนไข wht_certificate_id: ตอนแก้ไขต้องรับทั้งรายการที่ยังว่าง (เพิ่งถูกเพิ่ม
  -- เข้ามาในใบ) และรายการที่ผูกกับใบนี้อยู่แล้ว (ไม่ได้ถูกแตะ) — ถ้าใช้เงื่อนไข "ว่างเท่านั้น" แบบตอนสร้าง
  -- การกดแก้ไขโดยไม่เปลี่ยนรายการเลยจะล้มเหลวทันทีเพราะทุกแถวผูกกับใบนี้อยู่แล้ว
  select count(*),
         coalesce(sum(amount_excl_vat), 0),
         coalesce(sum(amount_excl_vat + vat_amount), 0),
         coalesce(sum(wht_amount), 0),
         max(transaction_date)
    into v_matched_count, v_total_excl_vat, v_total_amount, v_total_wht, v_payment_date
  from public.pending_tax_invoices
  where id = any(p_invoice_ids)
    and company_id = v_existing.company_id
    and (wht_certificate_id is null or wht_certificate_id = p_cert_id)
    and wht_amount > 0;

  if v_matched_count <> array_length(p_invoice_ids, 1) then
    raise exception 'มีบางรายการที่ใช้กับใบนี้ไม่ได้ (อาจถูกออกใบอื่นไปแล้ว หรือไม่มียอดหัก ณ ที่จ่าย) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
  end if;

  if p_sequence_override is not null then
    if p_sequence_override < 1 or p_sequence_override > 999 then
      raise exception 'ลำดับที่ใบหัก ณ ที่จ่ายต้องเป็นเลขจำนวนเต็มระหว่าง 1 ถึง 999 เท่านั้น';
    end if;

    -- เช็คซ้ำเฉพาะใบ "อื่น" ที่ยังมีผล (id <> p_cert_id) — ไม่งั้นการกดบันทึกโดยไม่เปลี่ยนเลขที่จะชนกับ
    -- ตัวเองเสมอ เงื่อนไข status = 'issued' ให้ตรงกับ index จริงบนตาราง (ดู migration_034)
    if exists (
      select 1 from public.wht_certificates
      where company_id = v_existing.company_id
        and form_type = p_form_type
        and period_year = p_period_year
        and period_month = p_period_month
        and sequence_number = p_sequence_override
        and status = 'issued'
        and id <> p_cert_id
    ) then
      raise exception 'เลขที่ใบหัก ณ ที่จ่ายนี้ถูกใช้อยู่กับใบที่ยังไม่ถูกยกเลิก กรุณาเลือกลำดับที่อื่น';
    end if;

    v_seq := p_sequence_override;

    insert into public.wht_certificate_counters (company_id, form_type, period_year, period_month, last_number)
    values (v_existing.company_id, p_form_type, p_period_year, p_period_month, p_sequence_override)
    on conflict (company_id, form_type, period_year, period_month)
    do update set
      last_number = greatest(public.wht_certificate_counters.last_number, excluded.last_number),
      updated_at = now();
  else
    -- ไม่ได้ระบุเลขมา = เก็บเลขเดิมของใบไว้ (ไม่ใช่ขอเลขใหม่) — การแก้ไขไม่ควรเปลี่ยนเลขที่เอกสารเอง
    v_seq := v_existing.sequence_number;
  end if;

  v_cert_number := p_form_type || '-' || lpad((p_period_year % 100)::text, 2, '0') || lpad(p_period_month::text, 2, '0') || lpad(v_seq::text, 3, '0');

  -- ปลดรายการที่ถูกเอาออกจากใบนี้ก่อน (กลับไปเป็น "ยังไม่ได้ออกใบ") แล้วค่อยผูกชุดใหม่ทั้งหมด
  update public.pending_tax_invoices
  set wht_certificate_id = null
  where wht_certificate_id = p_cert_id
    and not (id = any(p_invoice_ids));

  update public.pending_tax_invoices
  set wht_certificate_id = p_cert_id
  where id = any(p_invoice_ids);

  update public.wht_certificates
  set cert_number = v_cert_number,
      form_type = p_form_type,
      period_year = p_period_year,
      period_month = p_period_month,
      sequence_number = v_seq,
      business_partner_id = p_business_partner_id,
      income_type_code = p_income_type_code,
      income_type_label = p_income_type_label,
      deduction_type = p_deduction_type,
      deduction_type_note = p_deduction_type_note,
      signer_name = p_signer_name,
      issued_date = p_issued_date,
      payment_date = v_payment_date,
      total_amount = v_total_amount,
      total_amount_excl_vat = v_total_excl_vat,
      total_wht_amount = v_total_wht,
      payer_name = p_payer ->> 'name',
      payer_tax_id = p_payer ->> 'tax_id',
      payer_branch_type = p_payer ->> 'branch_type',
      payer_branch_number = p_payer ->> 'branch_number',
      payer_address = p_payer ->> 'address',
      payer_subdistrict = p_payer ->> 'subdistrict',
      payer_district = p_payer ->> 'district',
      payer_province = p_payer ->> 'province',
      payer_postal_code = p_payer ->> 'postal_code',
      payee_entity_type = p_payee ->> 'entity_type',
      payee_name = p_payee ->> 'name',
      payee_tax_id = p_payee ->> 'tax_id',
      payee_branch_type = p_payee ->> 'branch_type',
      payee_branch_number = p_payee ->> 'branch_number',
      payee_address = p_payee ->> 'address',
      payee_subdistrict = p_payee ->> 'subdistrict',
      payee_district = p_payee ->> 'district',
      payee_province = p_payee ->> 'province',
      payee_postal_code = p_payee ->> 'postal_code',
      updated_at = now()
  where id = p_cert_id
  returning * into v_result;

  return v_result;
end;
$$;

/* ============================== สิทธิ์ ==============================
   ชุดเดียวกับ create_wht_certificate / void_wht_certificate ทุกประการ */
revoke all on function public.update_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], integer
) from public;
grant execute on function public.update_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], integer
) to authenticated;
revoke execute on function public.update_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], integer
) from anon;

/* ============================== ตรวจผลหลังรัน ==============================
   ต้องเห็น 1 แถว และ can_execute มี authenticated แต่ไม่มี anon */
select p.proname                                                   as ฟังก์ชัน,
       (select array_agg(r.rolname::text order by r.rolname::text)
          from aclexplode(p.proacl) ae join pg_roles r on r.oid = ae.grantee) as สิทธิ์เรียกใช้
from pg_proc p
where p.proname = 'update_wht_certificate' and p.pronamespace = 'public'::regnamespace;
