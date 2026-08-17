-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 020: อนุญาตให้ระบุ "ลำดับที่" ของใบหัก ณ ที่จ่ายเองได้ตอนออกใบ (แทนที่จะรันอัตโนมัติเสมอ)
--
-- ตามคำขอผู้ใช้ (2026-08-17): "อยากให้โชว์เลขที่ใบหัก ณ ที่จ่ายที่จะออกด้วย โดยระบบจะรันเลขให้อัตโนมัติ...
-- แต่ฉันก็ยังสามารถแก้ไขเลขที่ได้" — เดิม create_wht_certificate() เรียก get_next_wht_cert_number() แบบ
-- atomic เสมอ ไม่มีช่องให้ client ระบุเลขเอง เพิ่มพารามิเตอร์ p_sequence_override (nullable, ท้าย signature
-- เดิมทั้งหมด เพื่อไม่กระทบ call site อื่นที่อาจยังไม่ได้อัปเดต) — ถ้าไม่ส่งมา (null) ทำงานเหมือนเดิมทุกประการ
-- (เรียก get_next_wht_cert_number ตามปกติ) ถ้าส่งมา ใช้เลขนั้นตรงๆ แทน พร้อมขยับตัวนับ
-- (wht_certificate_counters.last_number) ให้ไม่ต่ำกว่าเลขที่ผู้ใช้ระบุเอง กันไม่ให้เลขที่ auto ในรอบถัดไป
-- (เดือน/ฟอร์มเดียวกัน) ชนกับเลขที่เพิ่งถูกใช้ไปเอง — เช่น ตัวนับเดิมอยู่ที่ 2 ผู้ใช้แก้เป็น 10 เอง ตัวนับต้อง
-- ขยับเป็นอย่างน้อย 10 (ไม่ใช่ 3) ไม่งั้นรอบถัดไปจะได้เลข 3 ซึ่งอาจไปชนถ้าผู้ใช้เคยออกเลข 3 ไว้เองมาก่อนแล้ว
-- ในอดีต (unique constraint จะ error ทันทีถ้าเกิดขึ้นจริง — เช็คซ้ำไว้ล่วงหน้าด้วย error message ภาษาไทย
-- อ่านง่ายแทนที่จะปล่อยให้ Postgres unique_violation ดิบๆ หลุดไปถึงผู้ใช้)
--
-- ระบบยังคง "รันเลขให้อัตโนมัติจากเลขที่ยังไม่มีเสมอ เริ่มจากเลขที่น้อยก่อน" เป็นค่าเริ่มต้นเหมือนเดิมทุกประการ
-- (ฝั่ง frontend อ่านเลขแนะนำผ่านการ select ตรงๆ จากตาราง wht_certificate_counters แบบ read-only ไม่เพิ่ม
-- ตัวนับ — ดู lib/whtCertificateApi.ts peekNextWhtCertNumber — เพื่อไม่ให้เสียเลขไปเปล่าๆ ถ้าผู้ใช้แค่เปิดฟอร์ม
-- มาดูแล้วไม่ได้กดยืนยันออกใบจริง)

drop function if exists public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text
);

create or replace function public.create_wht_certificate(
  p_company_id uuid,
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
  p_created_by_email text,
  p_sequence_override integer default null
)
returns public.wht_certificates
language plpgsql
set search_path = ''
as $$
declare
  v_seq integer;
  v_cert_number text;
  v_total_amount numeric(14, 2);
  v_total_wht numeric(14, 2);
  v_payment_date date;
  v_matched_count integer;
  v_result public.wht_certificates;
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'คุณไม่ใช่สมาชิกของบริษัทนี้';
  end if;

  if p_invoice_ids is null or array_length(p_invoice_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อย 1 รายการ';
  end if;

  if not exists (
    select 1 from public.business_partners
    where id = p_business_partner_id and company_id = p_company_id
  ) then
    raise exception 'ไม่พบผู้ขายรายนี้ในสมุดรายชื่อของบริษัทนี้';
  end if;

  -- ตรวจสอบว่าทุกรายการที่เลือกมาเป็นของบริษัทนี้จริง ยังไม่เคยถูกออกใบมาก่อน (wht_certificate_id is null)
  -- และมียอดหัก ณ ที่จ่าย > 0 เท่านั้น — กันการเรียก RPC ตรงๆ ข้าม UI มาสร้างใบจากรายการที่ไม่เข้าเงื่อนไข
  select count(*), coalesce(sum(amount_excl_vat + vat_amount), 0), coalesce(sum(wht_amount), 0), max(transaction_date)
    into v_matched_count, v_total_amount, v_total_wht, v_payment_date
  from public.pending_tax_invoices
  where id = any(p_invoice_ids)
    and company_id = p_company_id
    and wht_certificate_id is null
    and wht_amount > 0;

  if v_matched_count <> array_length(p_invoice_ids, 1) then
    raise exception 'มีบางรายการที่ออกใบหัก ณ ที่จ่ายไม่ได้ (อาจถูกออกใบไปแล้ว หรือไม่มียอดหัก ณ ที่จ่าย) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
  end if;

  if p_sequence_override is not null then
    if p_sequence_override < 1 then
      raise exception 'ลำดับที่ใบหัก ณ ที่จ่ายต้องเป็นเลขจำนวนเต็มบวก';
    end if;

    if exists (
      select 1 from public.wht_certificates
      where company_id = p_company_id
        and form_type = p_form_type
        and period_year = p_period_year
        and period_month = p_period_month
        and sequence_number = p_sequence_override
        and status = 'issued'
    ) then
      raise exception 'เลขที่ใบหัก ณ ที่จ่ายนี้ถูกใช้ไปแล้ว กรุณาเลือกลำดับที่อื่น';
    end if;

    v_seq := p_sequence_override;

    -- ขยับตัวนับให้ไม่ต่ำกว่าเลขที่ผู้ใช้ระบุเอง (greatest กันตัวนับเดิมสูงกว่าอยู่แล้วไม่ให้ถอยหลัง)
    insert into public.wht_certificate_counters (company_id, form_type, period_year, period_month, last_number)
    values (p_company_id, p_form_type, p_period_year, p_period_month, p_sequence_override)
    on conflict (company_id, form_type, period_year, period_month)
    do update set
      last_number = greatest(public.wht_certificate_counters.last_number, excluded.last_number),
      updated_at = now();
  else
    v_seq := public.get_next_wht_cert_number(p_company_id, p_form_type, p_period_year, p_period_month);
  end if;

  v_cert_number := p_form_type || '-' || lpad((p_period_year % 100)::text, 2, '0') || lpad(p_period_month::text, 2, '0') || lpad(v_seq::text, 3, '0');

  insert into public.wht_certificates (
    company_id, cert_number, form_type, period_year, period_month, sequence_number,
    business_partner_id, income_type_code, income_type_label,
    deduction_type, deduction_type_note, signer_name, issued_date,
    payment_date, total_amount, total_wht_amount,
    payer_name, payer_tax_id, payer_branch_type, payer_branch_number,
    payer_address, payer_subdistrict, payer_district, payer_province, payer_postal_code,
    payee_entity_type, payee_name, payee_tax_id, payee_branch_type, payee_branch_number,
    payee_address, payee_subdistrict, payee_district, payee_province, payee_postal_code,
    created_by, created_by_email
  ) values (
    p_company_id, v_cert_number, p_form_type, p_period_year, p_period_month, v_seq,
    p_business_partner_id, p_income_type_code, p_income_type_label,
    p_deduction_type, p_deduction_type_note, p_signer_name, p_issued_date,
    v_payment_date, v_total_amount, v_total_wht,
    p_payer ->> 'name', p_payer ->> 'tax_id', p_payer ->> 'branch_type', p_payer ->> 'branch_number',
    p_payer ->> 'address', p_payer ->> 'subdistrict', p_payer ->> 'district', p_payer ->> 'province', p_payer ->> 'postal_code',
    p_payee ->> 'entity_type', p_payee ->> 'name', p_payee ->> 'tax_id', p_payee ->> 'branch_type', p_payee ->> 'branch_number',
    p_payee ->> 'address', p_payee ->> 'subdistrict', p_payee ->> 'district', p_payee ->> 'province', p_payee ->> 'postal_code',
    auth.uid(), p_created_by_email
  )
  returning * into v_result;

  update public.pending_tax_invoices
  set wht_certificate_id = v_result.id
  where id = any(p_invoice_ids);

  return v_result;
end;
$$;

revoke all on function public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text, integer
) from public;
grant execute on function public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text, integer
) to authenticated;
revoke execute on function public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text, integer
) from anon;
