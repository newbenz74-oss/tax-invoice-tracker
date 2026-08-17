-- BENZ — เว็บติดตามใบกำกับภาษี
-- Migration 019: เพิ่มคอลัมน์ description ให้ตาราง bank_reconcile_bank_rows/bank_reconcile_gl_rows
--
-- บั๊ก (พบโดยผู้ใช้ 2026-08-17): อัปโหลดไฟล์ GL ที่มีคอลัมน์ "คำอธิบาย" แล้วกด "ตรวจสอบข้อมูล" เห็นคำอธิบาย
-- ถูกต้องปกติ (parseGLRows อ่านค่ามาใส่ description ของ GLTransaction อยู่แล้ว — ดู lib/bankReconcileParse.ts)
-- แต่พอกด "บันทึกเป็นประวัติ" แล้วกลับมาเปิดแก้ไขใหม่ (getReportDetail) คำอธิบายหายไปหมด กลายเป็น "-" ทุกแถว —
-- สาเหตุ: ตาราง bank_reconcile_gl_rows (migration_006) ไม่เคยมีคอลัมน์ description เลยตั้งแต่ต้น ฟังก์ชัน
-- save_bank_reconcile_report() จึงไม่มีที่เก็บค่านี้ ถูกทิ้งไปเงียบๆ ทุกครั้งที่บันทึก (ไม่ error ให้เห็น เพราะ
-- jsonb payload มี key นี้ส่งมาจริงจากฝั่ง client แต่ insert statement เดิมไม่ได้ใช้ key นี้เลย)
--
-- เพิ่มพร้อมกันนี้: รองรับคำอธิบายฝั่ง Bank Statement ด้วย (เพิ่มเข้ามาตามคำขอผู้ใช้ 2026-08-17 — เดิมมีแค่ฝั่ง
-- GL) เพิ่มคอลัมน์ description ให้ bank_reconcile_bank_rows ด้วยเช่นกัน (ดู BankTransaction.description ใหม่
-- ใน types/bankReconcile.ts และ parseBankRows ใน lib/bankReconcileParse.ts ที่แก้คู่กัน)
alter table public.bank_reconcile_bank_rows add column description text;
alter table public.bank_reconcile_gl_rows add column description text;

-- แก้ save_bank_reconcile_report() ให้เก็บ/คืนค่า description ทั้งสองฝั่ง — โครงสร้างอื่นทั้งหมดเหมือนเดิม
-- ทุกประการ ไม่เปลี่ยน (ยังคง delete-then-insert ทั้งชุดเหมือนเดิมตอนบันทึกทับรายการเดิม)
create or replace function public.save_bank_reconcile_report(
  p_company_id uuid,
  p_report jsonb,
  p_match_groups jsonb,
  p_bank_rows jsonb,
  p_gl_rows jsonb
)
returns public.bank_reconcile_reports
language plpgsql
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_result public.bank_reconcile_reports;
begin
  v_report_id := nullif(p_report ->> 'id', '')::uuid;

  if v_report_id is null then
    insert into public.bank_reconcile_reports (
      company_id, report_name, period_month, period_year, status, bank_file_name, gl_file_name, tolerance_days,
      bank_row_count, gl_row_count, matched_group_count, bank_unmatched_count, gl_unmatched_count,
      created_by, created_by_email, updated_by, updated_by_email
    )
    values (
      p_company_id,
      p_report ->> 'report_name',
      (p_report ->> 'period_month')::smallint,
      (p_report ->> 'period_year')::smallint,
      coalesce(p_report ->> 'status', 'draft'),
      nullif(p_report ->> 'bank_file_name', ''),
      nullif(p_report ->> 'gl_file_name', ''),
      coalesce((p_report ->> 'tolerance_days')::smallint, 1),
      jsonb_array_length(coalesce(p_bank_rows, '[]'::jsonb)),
      jsonb_array_length(coalesce(p_gl_rows, '[]'::jsonb)),
      jsonb_array_length(coalesce(p_match_groups, '[]'::jsonb)),
      (select count(*)::int from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) x where nullif(x ->> 'match_group_id', '') is null),
      (select count(*)::int from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) x where nullif(x ->> 'match_group_id', '') is null),
      nullif(p_report ->> 'created_by', '')::uuid,
      p_report ->> 'created_by_email',
      nullif(p_report ->> 'updated_by', '')::uuid,
      p_report ->> 'updated_by_email'
    )
    returning id into v_report_id;
  else
    update public.bank_reconcile_reports set
      report_name = p_report ->> 'report_name',
      period_month = (p_report ->> 'period_month')::smallint,
      period_year = (p_report ->> 'period_year')::smallint,
      status = coalesce(p_report ->> 'status', 'draft'),
      bank_file_name = nullif(p_report ->> 'bank_file_name', ''),
      gl_file_name = nullif(p_report ->> 'gl_file_name', ''),
      tolerance_days = coalesce((p_report ->> 'tolerance_days')::smallint, 1),
      bank_row_count = jsonb_array_length(coalesce(p_bank_rows, '[]'::jsonb)),
      gl_row_count = jsonb_array_length(coalesce(p_gl_rows, '[]'::jsonb)),
      matched_group_count = jsonb_array_length(coalesce(p_match_groups, '[]'::jsonb)),
      bank_unmatched_count = (select count(*)::int from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) x where nullif(x ->> 'match_group_id', '') is null),
      gl_unmatched_count = (select count(*)::int from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) x where nullif(x ->> 'match_group_id', '') is null),
      updated_by = nullif(p_report ->> 'updated_by', '')::uuid,
      updated_by_email = p_report ->> 'updated_by_email'
    where id = v_report_id;

    if not found then
      raise exception 'ไม่พบรายการกระทบยอด id=% หรือไม่มีสิทธิ์เข้าถึง', v_report_id;
    end if;

    delete from public.bank_reconcile_bank_rows where report_id = v_report_id;
    delete from public.bank_reconcile_gl_rows where report_id = v_report_id;
    delete from public.bank_reconcile_match_groups where report_id = v_report_id;
  end if;

  insert into public.bank_reconcile_match_groups (id, report_id, match_type, type)
  select (x ->> 'id')::uuid, v_report_id, x ->> 'match_type', x ->> 'type'
  from jsonb_array_elements(coalesce(p_match_groups, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_bank_rows (report_id, match_group_id, row_order, transaction_date, type, amount, description)
  select v_report_id, nullif(x ->> 'match_group_id', '')::uuid, (x ->> 'row_order')::int, (x ->> 'transaction_date')::date, x ->> 'type', (x ->> 'amount')::numeric, nullif(x ->> 'description', '')
  from jsonb_array_elements(coalesce(p_bank_rows, '[]'::jsonb)) as x;

  insert into public.bank_reconcile_gl_rows (report_id, match_group_id, row_order, document_no, transaction_date, type, amount, description)
  select v_report_id, nullif(x ->> 'match_group_id', '')::uuid, (x ->> 'row_order')::int, coalesce(x ->> 'document_no', ''), (x ->> 'transaction_date')::date, x ->> 'type', (x ->> 'amount')::numeric, nullif(x ->> 'description', '')
  from jsonb_array_elements(coalesce(p_gl_rows, '[]'::jsonb)) as x;

  select * into v_result from public.bank_reconcile_reports where id = v_report_id;
  return v_result;
end;
$$;
