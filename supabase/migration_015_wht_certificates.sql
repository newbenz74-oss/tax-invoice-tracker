-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 015: ตารางเก็บใบหัก ณ ที่จ่ายที่ออกแล้ว + RPC ออกใบแบบ atomic
--
-- ออกแบบให้ 1 ใบหัก ณ ที่จ่าย (wht_certificates 1 แถว) ผูกกับได้หลายรายการจ่ายเงิน (pending_tax_invoices)
-- ตามที่ผู้ใช้ยืนยันว่าอยากรวมหลายรายการของผู้ขายเดียวกันไว้ในใบเดียวได้ตั้งแต่ต้น — เลือกใช้ FK ทางเดียว
-- (เพิ่มคอลัมน์ wht_certificate_id ที่ pending_tax_invoices ชี้กลับมาที่นี่) แทนตารางเชื่อม (junction table)
-- เพราะ 1 รายการจ่ายเงินออกใบได้แค่ใบเดียวเท่านั้น (cardinality 1 ใบ : หลายรายการ, ไม่ใช่ many-to-many)
-- ทำให้ query ง่ายทั้งสองทาง ไม่ต้อง join ตารางที่ 3
--
-- เก็บข้อมูลผู้จ่าย/ผู้ถูกหักเป็น "snapshot" ณ วันที่ออกใบ (payer_*/payee_* คัดลอกมาจาก companies/
-- business_partners ตรงๆ ตอนสร้าง) ไม่ใช่ live reference — ถ้าภายหลังแก้ที่อยู่บริษัทหรือแก้สมุดรายชื่อ
-- ใบที่ออกไปแล้วต้องยังแสดงข้อมูลเดิมตามที่ออกจริง ไม่เปลี่ยนตาม (เอกสารทางการต้องคงที่) — total_amount/
-- total_wht_amount ก็เป็น snapshot เดียวกัน (รวมยอดจากรายการที่เลือก ณ ตอนออกใบ) ถ้าภายหลังมีคนไปแก้ไข
-- ยอดในรายการจ่ายเงินต้นทาง ใบที่ออกไปแล้วจะไม่เปลี่ยนตามเช่นกัน (ตรงตามเอกสารที่พิมพ์ให้ผู้ขายไปแล้วจริง)
--
-- income_type_code รองรับแค่ 5 ประเภทจาก 6 ประเภทของฟอร์มจริง (1,2,3,5,6) — ตัดประเภท 4 (ดอกเบี้ย/
-- เงินปันผล ซึ่งมีเงื่อนไขย่อยซับซ้อนมาก 8-9 ข้อย่อยเรื่องเครดิตภาษี) ออกไปก่อน เพราะไม่เกี่ยวกับรายการ
-- จ่ายเงินให้ผู้ขาย/ผู้ให้บริการที่แอปนี้ติดตามอยู่เลย (ใช้กับดอกเบี้ยเงินกู้/เงินปันผลผู้ถือหุ้นเท่านั้น) — ถ้า
-- ในอนาคตต้องใช้จริงค่อยเพิ่มทีหลังได้
create table public.wht_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cert_number text not null,
  form_type text not null check (form_type in ('53', '03')),
  period_year smallint not null,
  period_month smallint not null,
  sequence_number integer not null,
  business_partner_id uuid not null references public.business_partners(id),
  income_type_code text not null check (income_type_code in ('1', '2', '3', '5', '6')),
  income_type_label text,
  deduction_type text not null default 'withholding' check (deduction_type in ('withholding', 'pay_forever', 'pay_once', 'other')),
  deduction_type_note text,
  signer_name text,
  issued_date date not null,
  payment_date date not null,
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  total_wht_amount numeric(14, 2) not null check (total_wht_amount >= 0),
  -- snapshot ฝั่งผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่าย) จาก companies ณ วันที่ออก
  payer_name text not null,
  payer_tax_id text,
  payer_branch_type text not null,
  payer_branch_number text,
  payer_address text,
  payer_subdistrict text,
  payer_district text,
  payer_province text,
  payer_postal_code text,
  -- snapshot ฝั่งผู้ถูกหักภาษี ณ ที่จ่าย จาก business_partners ณ วันที่ออก
  payee_entity_type text not null check (payee_entity_type in ('individual', 'company')),
  payee_name text not null,
  payee_tax_id text,
  payee_branch_type text not null,
  payee_branch_number text,
  payee_address text,
  payee_subdistrict text,
  payee_district text,
  payee_province text,
  payee_postal_code text,
  status text not null default 'issued' check (status in ('issued', 'voided')),
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cert_number)
);

comment on table public.wht_certificates is 'ใบหัก ณ ที่จ่ายที่ออกแล้ว (หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ) — payer_*/payee_* เป็น snapshot ณ วันที่ออก ไม่ใช่ live reference';

alter table public.wht_certificates enable row level security;

create policy "select_own_certificates" on public.wht_certificates
  for select
  using (public.is_company_member(company_id));

create policy "insert_own_certificates" on public.wht_certificates
  for insert
  with check (public.is_company_member(company_id));

-- เผื่อฟีเจอร์ "ยกเลิกใบ" ในอนาคต (ยังไม่มี UI เรียกใช้ในรอบนี้) — ยึด pattern เดียวกับ
-- wht_certificate_counters ที่วางสิทธิ์ไว้ล่วงหน้าก่อนมี UI จริง
create policy "update_own_certificates" on public.wht_certificates
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ผูกรายการจ่ายเงินกับใบหัก ณ ที่จ่ายที่ออกไปแล้ว — null = ยังไม่เคยออกใบ (ยังเลือกมาออกใบได้อยู่)
-- on delete set null กันไว้เฉยๆ (ยังไม่มีฟีเจอร์ลบใบจริง แต่ถ้ามีในอนาคต ไม่อยากให้ลบใบแล้วรายการจ่ายเงิน
-- พังไปด้วย แค่กลับไปสถานะ "ยังไม่ได้ออกใบ" เหมือนเดิม)
alter table public.pending_tax_invoices
  add column wht_certificate_id uuid references public.wht_certificates(id) on delete set null;

comment on column public.pending_tax_invoices.wht_certificate_id is 'ใบหัก ณ ที่จ่ายที่รายการนี้ถูกรวมออกไปแล้ว — null = ยังไม่เคยออกใบ';

-- RPC ออกใบหัก ณ ที่จ่ายแบบ atomic ในทรานแซกชันเดียว: ขอเลขที่ถัดไป (เรียก get_next_wht_cert_number
-- ภายในทรานแซกชันเดียวกัน) + insert แถวใบหัก ณ ที่จ่าย + ผูกรายการจ่ายเงินที่เลือกทั้งหมดเข้ากับใบนี้ —
-- ถ้าขั้นตอนไหนล้มเหลว (เช่น มีรายการที่ไม่เข้าเงื่อนไข) ทุกอย่าง rollback หมด ไม่มีทาง "ได้เลขที่ไปแล้ว
-- แต่ไม่มีใบจริง" หรือ "มีใบแต่รายการยังไม่ถูกผูก" ค้างอยู่ (ยกเว้นกรณี client เรียกแล้ว transaction สำเร็จ
-- แต่ล้มเหลวตอนแสดงผล PDF ฝั่ง frontend — เลขที่จะไม่ถูกคืนกลับ ถือว่ายอมรับได้ตามธรรมชาติของเอกสาร
-- ทางการที่ต้องมีเลขต่อเนื่อง ไม่ย้อนมาใช้เลขที่ "หลุด" ไปแล้วซ้ำ)
--
-- p_payer/p_payee เป็น jsonb แทนพารามิเตอร์แยกทีละฟิลด์ (มีมากถึง ~9 ฟิลด์ต่อฝั่ง) เพื่อไม่ให้ signature
-- ของฟังก์ชันยาวเทอะทะเกินไป — key ที่คาดหวังคือ name, tax_id, branch_type, branch_number, address,
-- subdistrict, district, province, postal_code (key ไหนไม่มีจะได้ null ไปเอง ไม่ error)
--
-- SECURITY INVOKER (ค่าเริ่มต้น ไม่ใช้ SECURITY DEFINER) — insert/update ทั้งสองตารางผ่าน RLS ปกติของ
-- ผู้เรียกเองก็เพียงพอแล้ว เพราะผู้เรียกต้องเป็นสมาชิกบริษัทอยู่แล้วถึงจะมาถึงจุดนี้ได้ (ไม่มีปัญหา
-- bootstrapping แบบ create_company ที่ตอน insert ยังไม่เป็นสมาชิกบริษัทเลย)
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
  p_created_by_email text
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

  v_seq := public.get_next_wht_cert_number(p_company_id, p_form_type, p_period_year, p_period_month);
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
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text
) from public;
grant execute on function public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text
) to authenticated;
revoke execute on function public.create_wht_certificate(
  uuid, text, smallint, smallint, uuid, text, text, text, text, text, date, jsonb, jsonb, uuid[], text
) from anon;
