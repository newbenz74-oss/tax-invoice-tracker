-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 021: จำกัดช่วงเลขลำดับที่ (p_sequence_override) ไว้ที่ 1-999 ใน create_wht_certificate()
--
-- พบบั๊กจริง (2026-08-17): ฝั่ง frontend เดิม (ก่อนแก้ในรอบนี้) parse เลขลำดับผิดจากช่องพิมพ์เลขที่แบบเต็ม
-- (parseSequenceFromCertNumberInput ใน IssueWhtCertificateModal.tsx) ทำให้ส่ง p_sequence_override เป็นเลข
-- 7 หลัก (เช่น 6907001) เข้ามาโดยไม่ตั้งใจ ตัวนับ (wht_certificate_counters.last_number) จึงค้างเป็นเลขนี้
-- ถาวรผ่าน greatest() ใน migration_020 ทำให้เลขแนะนำในบัคเก็ตนั้นเพี้ยนไปตลอด (ต้องเข้าไปแก้ข้อมูลตรงๆ ใน DB)
-- แก้ต้นตอฝั่ง frontend ไปแล้ว (จำกัด 1-3 หลักตอน parse) แต่ยังไม่มีอะไรกันฝั่ง backend เลย ถ้ามีใครเรียก RPC
-- ตรงๆ (ข้าม UI) หรือฝั่ง frontend มีบั๊กแบบนี้อีกในอนาคต ตัวนับก็จะพังซ้ำได้อีก จึงเพิ่มการเช็คช่วงตรงนี้เป็น
-- ชั้นป้องกันสุดท้าย (defense in depth) — 999 คือค่าสูงสุดที่ format NNN 3 หลักของเลขที่ใบรองรับได้จริง (เช่น
-- "53-6907999") เกินจากนี้ไม่สมเหตุสมผลอยู่แล้วสำหรับ 1 บริษัท 1 ฟอร์ม ต่อ 1 เดือน

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
    -- เพิ่มขอบบน 999 ในรอบนี้ (migration_021) — เดิม migration_020 เช็คแค่ขอบล่าง (>= 1) เท่านั้น
    if p_sequence_override < 1 or p_sequence_override > 999 then
      raise exception 'ลำดับที่ใบหัก ณ ที่จ่ายต้องเป็นเลขจำนวนเต็มระหว่าง 1 ถึง 999 เท่านั้น';
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
