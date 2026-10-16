-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 034: เลขที่ใบหัก ณ ที่จ่ายที่ "ยกเลิกไปแล้ว" กลับมาใช้ซ้ำได้
-- รันทั้งไฟล์ผ่าน Supabase SQL Editor ครั้งเดียว ปลอดภัยที่จะรันซ้ำ (idempotent)
--
-- ========================= ที่มา =========================
-- ผู้ใช้แจ้ง 2026-10-16: "ฉันเคยออกใบหัก ณ ที่จ่ายเลขที่ 03-6910015 เมื่อฉันลบออกไป ฉันไม่สามารถกลับมาใช้
-- เลขเดิมนี้ได้อีก ซึ่งมันควรใช้ได้" และย้ำตอนถามกลับว่า "แก้ไขเลขที่ได้โดยแค่ไม่ซ้ำกับที่มีอยู่"
--
-- ========================= ผมเป็นคนทำให้เป็นแบบนี้เอง =========================
-- migration_022 (2026-08-17) ตัดเงื่อนไข "and status = 'issued'" ออกจากการเช็คเลขซ้ำ โดยให้เหตุผลว่า
-- "เลขที่เคยใช้แล้วห้ามใช้ซ้ำแม้จะยกเลิกไปแล้ว เพื่อให้ตรงกับ unique constraint จริงบนตาราง"
--
-- เหตุผลนั้นกลับหัวกลับหาง: ตอนนั้นผมแก้ "ตรรกะ" ให้ตรงกับ "constraint" ทั้งที่ constraint ต่างหากที่ผิด
-- เพราะ unique (company_id, cert_number) ไม่กรอง status ตั้งแต่ migration_015 โดยไม่ได้ตั้งใจออกแบบไว้แบบนั้น
-- ผลคือเลขที่ของใบที่พิมพ์ผิดแล้วลบทิ้งกลายเป็น "หลุมถาวร" ในลำดับเลข ซึ่งผิดหลักเอกสารบัญชีที่ต้องการให้
-- เลขที่ต่อเนื่องไม่มีช่องว่าง (สรรพากรดูลำดับเลขที่ใบในแบบ ภ.ง.ด. ด้วย)
--
-- ========================= วิธีแก้ =========================
-- เปลี่ยน unique เป็น "partial unique index" ที่บังคับเฉพาะใบที่ยังมีผล (status = 'issued')
--   - ใบที่ยกเลิกแล้วยังเก็บ cert_number เดิมไว้ครบ เป็นหลักฐานว่าเคยออกเลขนี้ให้ใครเมื่อไร (ดูย้อนหลังได้ที่
--     หน้าประวัติการใช้งาน audit_logs ด้วย) แค่ไม่ "กินเลข" อีกต่อไป
--   - ใบที่ยังมีผลยังห้ามเลขซ้ำกันเด็ดขาดเหมือนเดิมทุกประการ ซึ่งเป็นข้อที่สำคัญจริง
--   - ยกเลิกแล้วออกใหม่ด้วยเลขเดิมซ้ำได้หลายรอบ (ใบ voided หลายใบถือเลขเดียวกันได้ ไม่ติด index)
--
-- ========================= ผลกระทบ =========================
-- ✅ ข้อมูลเดิมไม่ถูกแตะเลย — ไม่มี update/delete แถวไหนทั้งสิ้น
-- ✅ ใบที่ยัง issued ยังถูกบังคับไม่ให้เลขซ้ำเหมือนเดิม (ข้อกันพลาดที่สำคัญยังอยู่ครบ)
-- ✅ ย้อนกลับได้: drop index ใหม่ แล้ว add constraint เดิมคืน (จะทำได้ก็ต่อเมื่อยังไม่มีใครใช้เลขซ้ำจริง)
-- ⚠️ ตัวนับอัตโนมัติ (wht_certificate_counters) ยังเดินหน้าอย่างเดียวเหมือนเดิม ไม่ถอยกลับมาเติมหลุมให้เอง
--    ผู้ใช้พิมพ์เลขที่ต้องการเองได้ที่ช่อง "เลขที่ใบ" และหน้าเว็บจะพรีฟิลเลขเดิมให้อัตโนมัติตอนกด "แก้ไข"

/* ============================== 1. เปลี่ยน unique เป็นแบบมีเงื่อนไข ==============================
   ลำดับสำคัญ: สร้าง index ใหม่ก่อน แล้วค่อย drop constraint เดิม จะได้ไม่มีช่วงที่ตารางไม่มีการกันเลขซ้ำเลย
   (ถ้ามีใครกดออกใบพอดีระหว่างนั้นจะได้เลขซ้ำเข้ามาโดยไม่มีอะไรห้าม) */
create unique index if not exists wht_certificates_company_cert_number_issued_key
  on public.wht_certificates (company_id, cert_number)
  where status = 'issued';

comment on index public.wht_certificates_company_cert_number_issued_key is
  'กันเลขที่ใบหัก ณ ที่จ่ายซ้ำ เฉพาะใบที่ยังมีผล (issued) — ใบที่ยกเลิกแล้วคืนเลขให้ใช้ซ้ำได้ ดู migration_034';

alter table public.wht_certificates
  drop constraint if exists wht_certificates_company_id_cert_number_key;

/* ============================== 2. ให้ RPC เช็คเลขซ้ำเฉพาะใบที่ยังมีผล ==============================
   แก้แค่ 1 บรรทัด (เพิ่ม and status = 'issued' กลับเข้าไป) ที่เหลือคัดลอกจาก migration_033 ทั้งดุ้น
   รวมส่วนที่ migration_033 เพิ่งเพิ่ม (total_amount_excl_vat) ไว้ครบ */
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
  v_total_excl_vat numeric(14, 2);
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

  select count(*),
         coalesce(sum(amount_excl_vat), 0),
         coalesce(sum(amount_excl_vat + vat_amount), 0),
         coalesce(sum(wht_amount), 0),
         max(transaction_date)
    into v_matched_count, v_total_excl_vat, v_total_amount, v_total_wht, v_payment_date
  from public.pending_tax_invoices
  where id = any(p_invoice_ids)
    and company_id = p_company_id
    and wht_certificate_id is null
    and wht_amount > 0;

  if v_matched_count <> array_length(p_invoice_ids, 1) then
    raise exception 'มีบางรายการที่ออกใบหัก ณ ที่จ่ายไม่ได้ (อาจถูกออกใบไปแล้ว หรือไม่มียอดหัก ณ ที่จ่าย) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
  end if;

  if p_sequence_override is not null then
    if p_sequence_override < 1 or p_sequence_override > 999 then
      raise exception 'ลำดับที่ใบหัก ณ ที่จ่ายต้องเป็นเลขจำนวนเต็มระหว่าง 1 ถึง 999 เท่านั้น';
    end if;

    -- migration_034: เช็คซ้ำเฉพาะใบที่ยังมีผล — เลขของใบที่ยกเลิกไปแล้วเอากลับมาใช้ได้ตามที่ผู้ใช้ต้องการ
    -- (ย้อนการตัดสินใจใน migration_022 ซึ่งห้ามใช้ซ้ำทุกกรณี ดูเหตุผลเต็มที่หัวไฟล์นี้)
    -- เงื่อนไขนี้ตรงกับ index ใหม่ wht_certificates_company_cert_number_issued_key พอดี ถ้าหลุดเงื่อนไขนี้
    -- ไปได้จริง Postgres จะเป็นด่านสุดท้ายโยน 23505 ออกมาเอง ไม่มีทางได้เลขซ้ำในใบที่ยังมีผล
    if exists (
      select 1 from public.wht_certificates
      where company_id = p_company_id
        and form_type = p_form_type
        and period_year = p_period_year
        and period_month = p_period_month
        and sequence_number = p_sequence_override
        and status = 'issued'
    ) then
      raise exception 'เลขที่ใบหัก ณ ที่จ่ายนี้ถูกใช้อยู่กับใบที่ยังไม่ถูกยกเลิก กรุณาเลือกลำดับที่อื่น';
    end if;

    v_seq := p_sequence_override;

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
    payment_date, total_amount, total_amount_excl_vat, total_wht_amount,
    payer_name, payer_tax_id, payer_branch_type, payer_branch_number,
    payer_address, payer_subdistrict, payer_district, payer_province, payer_postal_code,
    payee_entity_type, payee_name, payee_tax_id, payee_branch_type, payee_branch_number,
    payee_address, payee_subdistrict, payee_district, payee_province, payee_postal_code,
    created_by, created_by_email
  ) values (
    p_company_id, v_cert_number, p_form_type, p_period_year, p_period_month, v_seq,
    p_business_partner_id, p_income_type_code, p_income_type_label,
    p_deduction_type, p_deduction_type_note, p_signer_name, p_issued_date,
    v_payment_date, v_total_amount, v_total_excl_vat, v_total_wht,
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

/* ============================== 3. ตรวจผลหลังรัน ==============================
   ต้องเห็น index ใหม่ 1 ตัวที่มี WHERE status = 'issued' และไม่เหลือ constraint เดิมแล้ว */
select indexname as ชื่อ_index, indexdef as นิยาม
from pg_indexes
where schemaname = 'public' and tablename = 'wht_certificates' and indexdef ilike '%cert_number%';
