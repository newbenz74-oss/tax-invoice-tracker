'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PendingTaxInvoice } from '@/types/invoice';
import type { BusinessPartner } from '@/types/contact';
import type { Company } from '@/lib/companyApi';
import type { CreateWhtCertificateInput, WhtCertificate, WhtDeductionType, WhtIncomeTypeCode } from '@/types/whtCertificate';
import {
  DEDUCTION_TYPE_LABELS,
  INCOME_TYPE_LABELS,
  buildPayeeSnapshot,
  buildPayerSnapshot,
  findPayeeCandidates,
  formatWhtCertNumber,
  formTypeForEntityType,
} from '@/lib/whtCertificateLogic';
import { createWhtCertificate, peekNextWhtCertNumber } from '@/lib/whtCertificateApi';
import { getContactDisplayName } from '@/lib/contactLogic';
import { calcNetPayment } from '@/lib/invoiceLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ตัวเลือกด่วนของช่อง "รายละเอียดเพิ่มเติม" (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — แค่ค่าคงที่ preset
// ที่พบบ่อย ไม่ได้บังคับเลือก ช่องนี้ยังเป็น input ข้อความธรรมดาที่พิมพ์เองแก้ไขได้ตามปกติทุกประการ
const INCOME_TYPE_LABEL_QUICK_OPTIONS = ['ค่าบริการ', 'ค่าจ้าง', 'เงินรางวัล', 'ค่าโฆษณา', 'ค่าเช่า'];

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** จำนวนวันของเดือน/ปี (ค.ศ.) ที่ระบุ — ใช้ตรวจว่าวันที่ที่พิมพ์เข้ามาใน parseBuddhistDateInput ด้านล่างมีอยู่
 * จริงไหม (เช่น 31 กุมภาพันธ์ ไม่มีจริง) new Date(year, month, 0) คือ trick มาตรฐานของ JS ที่ได้วันสุดท้ายของ
 * เดือนก่อนหน้า (month ที่ส่งเข้าเป็น 1-12 ปกติ ไม่ใช่ 0-11 แบบ Date API เพราะ "day 0 ของเดือนถัดไป" =
 * "วันสุดท้ายของเดือนนี้") */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** จัดรูปแบบ ISO ค.ศ. (YYYY-MM-DD) ให้เป็นข้อความ วว/ดด/ปปปป (ปี พ.ศ.) สำหรับแสดงในช่อง "วันที่ออกใบ" —
 * คู่กับ parseBuddhistDateInput ด้านล่าง (แปลงกลับทิศทางตรงข้าม) */
function formatBuddhistDateInput(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
}

/** แปลงข้อความ วว/ดด/ปปปป (ปี พ.ศ. ที่ผู้ใช้พิมพ์เอง) กลับเป็น ISO ค.ศ. (YYYY-MM-DD) — คืน null ถ้ารูปแบบผิด
 * หรือเป็นวันที่ที่ไม่มีจริง (เช่น 31/02/2569) ตั้งใจไม่ยอมรับรูปแบบอื่นเลย (เช่น "17-08-2569" หรือพิมพ์ค้าง
 * ไม่ครบ) เพื่อไม่ให้ตีความวันที่ผิดเพี้ยนแบบเงียบๆ — ผู้เรียก (handleIssuedDateInputChange) จะไม่อัปเดต
 * issuedDate เลยถ้าฟังก์ชันนี้คืน null รอจนกว่าจะพิมพ์ครบรูปแบบที่ถูกต้อง */
function parseBuddhistDateInput(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const d = Number(match[1]);
  const m = Number(match[2]);
  const y = Number(match[3]) - 543;
  if (m < 1 || m > 12) return null;
  if (y < 1000) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** วันที่จ่ายเงินล่าสุดในบรรดารายการที่เลือกออกใบ — ใช้เป็นค่าเริ่มต้นของ "วันที่ออกใบ" (ตามคำขอผู้ใช้
 * 2026-08-13: "วันที่ที่ออกหนังสือรับรองหัก ณ ที่จ่าย ตั้งเอาเป็นวันเดียวกันกับวันที่จ่ายเงินไปเลย") ใช้ max(...)
 * ไม่ใช่แค่ invoices[0] เพราะถ้าเลือกหลายรายการวันจ่ายต่างกัน ต้องตรงกับตรรกะเดียวกับ v_payment_date (max
 * (transaction_date)) ที่ RPC create_wht_certificate() คำนวณเก็บลง payment_date ฝั่งฐานข้อมูล (ดู
 * supabase/migration_015_wht_certificates.sql) — transaction_date เป็น ISO string (YYYY-MM-DD) เทียบ string
 * ตรงๆ ได้ผลเหมือนเทียบวันที่จริงอยู่แล้ว ผู้ใช้ยังแก้ไขเองได้ทุกครั้งถ้าต้องการวันอื่น (ไม่ใช่ค่าบังคับตายตัว) */
function latestTransactionDate(invoices: PendingTaxInvoice[]): string {
  if (invoices.length === 0) return todayISO();
  return invoices.reduce((latest, inv) => (inv.transaction_date > latest ? inv.transaction_date : latest), invoices[0].transaction_date);
}

/** ค่าเริ่มต้นของฟอร์ม ใช้ตอนแก้ไขใบเดิม (mode="reissue") — พรีฟิลด้วยข้อมูลจากใบที่ถูกยกเลิกไปแล้ว เพื่อให้
 * ผู้ใช้แก้เฉพาะจุดที่ผิดแล้วออกใบใหม่ ไม่ต้องกรอกซ้ำทั้งหมด */
export interface WhtCertificateFormPrefill {
  incomeTypeCode: WhtIncomeTypeCode;
  incomeTypeLabel: string;
  deductionType: WhtDeductionType;
  deductionTypeNote: string;
  signerName: string;
  issuedDate: string;
}

interface IssueWhtCertificateModalProps {
  invoices: PendingTaxInvoice[]; // ต้องเป็นผู้ขายเดียวกันทั้งหมด (เช็คซ้ำที่ผู้เรียกก่อนเปิด modal นี้แล้ว)
  contacts: BusinessPartner[];
  company: Company;
  companyId: string;
  createdByEmail: string | null;
  onClose: () => void;
  onIssued: (cert: WhtCertificate) => void;
  onGoToContacts?: () => void; // ไปหน้าสมุดรายชื่อ — ใช้ตอนหาผู้ขายไม่เจอ (ไม่บังคับส่งมา)
  // เพิ่มเข้ามาพร้อมปุ่ม "แก้ไข" ในหน้าประวัติ (2026-08-11) — mode="reissue" หมายถึงใบเดิมถูกยกเลิก
  // (void_wht_certificate) ไปแล้วก่อนเปิด modal นี้ กำลังจะออกใบใหม่แทนที่ ไม่ใช่การแก้ไขใบเดิมตรงๆ
  // (เอกสารทางการต้องมีเลขที่ต่อเนื่อง ไม่ย้อนกลับไปแก้ใบที่ออกไปแล้ว — ดู migration_016 สำหรับเหตุผลเต็ม)
  mode?: 'issue' | 'reissue';
  voidedCertNumber?: string; // เลขที่ใบเดิมที่ถูกยกเลิกไป — แสดงเป็นข้อความแจ้งเตือนตอน mode="reissue"
  prefill?: WhtCertificateFormPrefill;
}

/** Modal ออกใบหัก ณ ที่จ่ายจากรายการจ่ายเงินที่เลือกไว้ (1 รายการขึ้นไป ผู้ขายเดียวกันทั้งหมด) — เพิ่มเข้ามา
 * พร้อมพื้นฐานฟีเจอร์นี้ (2026-08-11)
 *
 * ปรับปรุง (2026-08-12 — ผู้ใช้ขอ) เดิมบังคับจับคู่ผู้ขายกับสมุดรายชื่อแบบชื่อตรงกันเป๊ะๆ เท่านั้น (ดู
 * lib/whtCertificateLogic.ts findPayeeCandidates) ถ้าหาไม่เจอเลยจะบล็อกไม่ให้ออกใบไปเลย — แต่ในทางปฏิบัติ
 * ชื่อผู้ขายบนรายการจ่ายเงิน (vendor_name) กับชื่อ "ผู้ถูกหักภาษี ณ ที่จ่าย" จริง อาจเป็นคนละคน/บริษัทกันได้
 * (เช่น จ่ายเงินให้ตัวแทน แต่ต้องออกใบให้เจ้าของจริง) จึงเปลี่ยนเป็น: ยังคง auto-select ให้ถ้าเจอชื่อตรงกันเป๊ะ
 * (สะดวก ไม่ต้องเลือกเองทุกครั้งในกรณีปกติ) แต่ผู้ใช้เลือกรายชื่อผู้ขาย (partner_type='vendor', active) คนไหน
 * ก็ได้จากสมุดรายชื่อทั้งหมดเสมอ ไม่บังคับให้ตรงชื่อกับ vendor_name อีกต่อไป — บล็อกไม่ให้ออกใบเฉพาะกรณีเดียว
 * คือสมุดรายชื่อยังไม่มีรายชื่อผู้ขายเลยแม้แต่รายเดียว (ไม่มีตัวเลือกให้เลือกจริงๆ)
 *
 * เลขที่ใบ (cert_number) แสดง preview ในฟอร์มนี้ด้วย (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — เลขที่แนะนำมาจาก
 * การอ่านตัวนับปัจจุบันแบบ read-only (peekNextWhtCertNumber, ไม่เพิ่มตัวนับถาวร) ผู้ใช้แก้ไขเลข "ลำดับที่" เองได้
 * เสมอ ก่อนกดยืนยัน — เลขจริงที่ถูกบันทึกคือค่าที่ผู้ใช้เห็น/แก้ไขล่าสุด ณ ตอนกดยืนยัน (ส่งเป็น sequenceOverride
 * ให้ RPC create_wht_certificate() ใช้ตรงๆ แทนการรันอัตโนมัติ — ดู supabase/migration_020_wht_cert_sequence_
 * override.sql) periodYear/periodMonth ที่ใช้กำหนด "ชุดตัวนับ" มาจาก issuedDate เสมอ (เดือน/ปีที่ออกใบจริง
 * ไม่ใช่เดือนที่ทำรายการจ่ายเงิน) ส่วน formType มาจากประเภทนิติบุคคล/บุคคลธรรมดาของผู้ถูกหักที่เลือก
 *
 * mode="reissue" (เพิ่มเข้ามาพร้อมปุ่ม "แก้ไข" ในหน้าประวัติ, 2026-08-11) ใช้ modal เดียวกันนี้ทุกประการ
 * เพียงพรีฟิลค่าฟอร์มด้วย prefill (จากใบเดิมที่ผู้เรียกยกเลิกไปแล้วผ่าน voidWhtCertificate() ก่อนเปิด modal
 * นี้) ยังคงเรียก createWhtCertificate() ตัวเดิมตอนกดยืนยัน (ได้เลขที่ใหม่ต่อเนื่อง ไม่มีการ "แก้ไข" ใบเดิม
 * ตรงๆ ในฐานข้อมูล — ดู supabase/migration_016_void_wht_certificate.sql สำหรับเหตุผลเต็ม)
 */
export default function IssueWhtCertificateModal({
  invoices,
  contacts,
  company,
  companyId,
  createdByEmail,
  onClose,
  onIssued,
  onGoToContacts,
  mode = 'issue',
  voidedCertNumber,
  prefill,
}: IssueWhtCertificateModalProps) {
  const vendorName = invoices[0]?.vendor_name.trim() ?? '';
  const vendorNameMismatch = invoices.some((inv) => inv.vendor_name.trim() !== vendorName);

  // ตัวเลือกทั้งหมดที่เลือกออกใบให้ได้ — ผู้ขายที่ active ทุกคนในสมุดรายชื่อ ไม่จำกัดแค่ชื่อที่ตรงกับ
  // vendor_name อีกต่อไป (2026-08-12) เรียงตามชื่อที่แสดงผลให้หาง่าย
  const vendorContacts = useMemo(
    () =>
      contacts
        .filter((c) => c.partner_type === 'vendor' && c.status === 'active')
        .sort((a, b) => getContactDisplayName(a).localeCompare(getContactDisplayName(b), 'th')),
    [contacts]
  );
  // ยังคงหาชื่อที่ตรงกับ vendor_name เป๊ะๆ ไว้ใช้ auto-select ค่าเริ่มต้นให้สะดวก (กรณีปกติส่วนใหญ่ที่ชื่อตรงกัน)
  const exactMatches = useMemo(() => findPayeeCandidates(vendorName, contacts), [vendorName, contacts]);
  const [selectedContactId, setSelectedContactId] = useState<string>(() => exactMatches[0]?.id ?? '');
  const selectedContact = vendorContacts.find((c) => c.id === selectedContactId) ?? null;

  // ค่าเริ่มต้น "6. อื่นๆ" (2026-08-17 ตามคำขอผู้ใช้ — ส่วนใหญ่เลือกตัวนี้อยู่แล้ว ไม่อยากต้องกดเลือกเองทุกครั้ง)
  // ยังแก้ไขเป็นตัวเลือกอื่นได้ตามปกติผ่าน <select> ด้านล่าง — โหมด reissue ยังคง prefill จากใบเดิมก่อนเสมอ
  // (ไม่ทับด้วยค่าเริ่มต้นนี้ถ้ามี prefill.incomeTypeCode อยู่แล้ว)
  const [incomeTypeCode, setIncomeTypeCode] = useState<WhtIncomeTypeCode | ''>(prefill?.incomeTypeCode ?? '6');
  const [incomeTypeLabel, setIncomeTypeLabel] = useState(prefill?.incomeTypeLabel ?? '');
  const [deductionType, setDeductionType] = useState<WhtDeductionType>(prefill?.deductionType ?? 'withholding');
  const [deductionTypeNote, setDeductionTypeNote] = useState(prefill?.deductionTypeNote ?? '');
  const [signerName, setSignerName] = useState(prefill?.signerName ?? company.default_signer_name ?? '');
  const [issuedDate, setIssuedDate] = useState(prefill?.issuedDate ?? latestTransactionDate(invoices));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ช่อง "วันที่ออกใบ" เป็นช่องเดียวเหมือนเดิม (2026-08-17) — ลองใช้ 3 dropdown วัน/เดือน/ปีแยกกันไปก่อนหน้านี้
  // แล้วผู้ใช้ขอกลับมาเป็นช่องเดียว ("ขอแบบเดิม") แต่ยังต้องแก้ปัญหาเดิมอยู่ คือ input type="date" ของ
  // เบราว์เซอร์รับได้แค่ปี ค.ศ. เท่านั้น พิมพ์ "2569" ตรงๆ จะกลายเป็นปี ค.ศ. 2569 จริง (ไม่ใช่แปลงจาก พ.ศ. ให้)
  // — จึงเปลี่ยนจาก type="date" เป็น input ข้อความธรรมดา รูปแบบ วว/ดด/ปปปป (ปี พ.ศ.) แทน ให้พิมพ์ 2569 ได้ตรงๆ
  // เก็บ buffer ข้อความที่พิมพ์แยกไว้ต่างหาก (issuedDateInput) เพราะระหว่างพิมพ์ค่าอาจยังไม่ใช่วันที่ที่ถูกต้อง
  // สมบูรณ์ (เช่นพิมพ์ "17/08/" ค้างไว้) — issuedDate (ISO ค.ศ.) จะอัปเดตก็ต่อเมื่อข้อความที่พิมพ์ครบรูปแบบและ
  // เป็นวันที่จริงเท่านั้น ฟิลด์อื่นที่ใช้ issuedDate ต่อ (handleSubmit/periodYear, RPC, PDF) ไม่ต้องแก้อะไรเลย
  // เพราะ issuedDate ยังเป็น ISO ค.ศ. รูปแบบเดียวกันเป๊ะๆ เหมือนเดิม
  const [issuedDateInput, setIssuedDateInput] = useState(() => formatBuddhistDateInput(issuedDate));
  const issuedDateHasError = issuedDateInput.trim() !== '' && parseBuddhistDateInput(issuedDateInput) === null;

  function handleIssuedDateInputChange(text: string) {
    setIssuedDateInput(text);
    const parsed = parseBuddhistDateInput(text);
    if (parsed) setIssuedDate(parsed);
  }

  // ตอนออกจากช่อง (blur) — ถ้าพิมพ์ไม่ครบ/ผิดรูปแบบ ให้แสดงค่า issuedDate ล่าสุดที่ถูกต้องกลับคืนแทน (ไม่ปล่อย
  // ให้ช่องค้างข้อความขยะ) ถ้าพิมพ์ถูกต้อง ให้จัดรูปแบบใหม่ให้เรียบร้อย (เติมเลข 0 นำหน้าให้ครบ เช่น "7/8/2569"
  // -> "07/08/2569")
  function handleIssuedDateBlur() {
    const parsed = parseBuddhistDateInput(issuedDateInput);
    setIssuedDateInput(formatBuddhistDateInput(parsed ?? issuedDate));
  }

  // เลขที่ใบหัก ณ ที่จ่าย (preview + แก้ไขเองได้ เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้ "อยากให้โชว์เลขที่...
  // โดยระบบจะรันเลขให้อัตโนมัติ...แต่ฉันก็ยังสามารถแก้ไขเลขที่ได้") — formType ขึ้นกับประเภทนิติบุคคล/บุคคล
  // ธรรมดาของผู้ถูกหักที่เลือกไว้ (selectedContact) ส่วน periodYear (พ.ศ.)/periodMonth ขึ้นกับ issuedDate เสมอ
  // (ชุดตัวนับเดียวกับที่ RPC ใช้จริงตอนกดยืนยัน — ดู handleSubmit ด้านล่าง)
  const previewFormType = selectedContact ? formTypeForEntityType(selectedContact.entity_type) : null;
  const [previewIsoYear, previewIsoMonth] = issuedDate ? issuedDate.split('-').map(Number) : [undefined, undefined];
  const previewPeriodYear = previewIsoYear !== undefined ? previewIsoYear + 543 : null;
  const previewPeriodMonth = previewIsoMonth ?? null;

  // ช่องเดียวพิมพ์แก้ไขเลขที่ได้ตรงๆ (2026-08-17 ตามคำขอผู้ใช้ — เดิมแยกเป็นกล่อง preview อ่านอย่างเดียว +
  // ช่อง "ลำดับที่" ต่างหาก ผู้ใช้ขอรวมเป็นช่องเดียว พิมพ์ทับเลขเต็มได้เลย ไม่ต้องมีช่อง "ลำดับที่" แยก) —
  // certNumberInput คือข้อความเต็มที่แสดง/แก้ไข (เช่น "53-6907001") ตอนส่งจริงจะตัดเอาแค่กลุ่มตัวเลขท้ายสุด
  // (parseSequenceFromCertNumberInput) มาเป็น sequenceOverride ส่วน prefix (formType-ปีเดือน) หน้าเลขนั้น
  // ผู้ใช้พิมพ์ทับได้อิสระเหมือนกัน แต่ไม่มีผลกับ formType/periodYear/periodMonth ที่ส่งจริง (ค่าพวกนั้นมาจาก
  // ผู้รับที่เลือก + วันที่ออกใบเสมอ ไม่ใช่จากข้อความในช่องนี้) — ตอน blur จะจัดรูปแบบให้ใหม่ให้ตรงกับ prefix
  // ที่ถูกต้องจริงเสมอ (ดู handleCertNumberBlur ด้านล่าง) กันความสับสนว่า prefix พิมพ์เองได้จริง
  const [certNumberInput, setCertNumberInput] = useState('');
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceLoadError, setSequenceLoadError] = useState<string | null>(null);

  // โหลดเลขที่แนะนำใหม่ทุกครั้งที่ formType/เดือน/ปีเปลี่ยน (เปลี่ยนผู้ขาย หรือแก้วันที่ออกใบ) — อ่านแบบ
  // read-only ผ่าน peekNextWhtCertNumber (ไม่เพิ่มตัวนับถาวร ดู lib/whtCertificateApi.ts) เรียกซ้ำได้ไม่จำกัด
  // เขียนทับค่าที่ผู้ใช้เคยแก้ไว้เองเสมอเมื่อ bucket เปลี่ยน เพราะเลขเดิมที่แก้ไว้อ้างอิงกับ bucket เก่าเท่านั้น
  // ไม่มีความหมายอีกต่อไปถ้าเปลี่ยนผู้ขาย/เดือน/ปี — ถ้าผู้ใช้แก้เลขเองในหน้าจอปัจจุบัน (bucket เดิม) โดยไม่ได้
  // เปลี่ยนผู้ขาย/วันที่ ค่านั้นจะไม่ถูกเขียนทับ (effect ไม่ยิงซ้ำเพราะ dependency ไม่เปลี่ยน)
  useEffect(() => {
    let cancelled = false;

    // ห่อ setState ทุกจุดด้วย Promise.resolve().then(...) เสมอ (กฎ react-hooks/set-state-in-effect ของ
    // โปรเจกต์นี้ ห้าม setState ตรงๆ ใน effect body แบบไม่มี async คั่นกลาง — ดู pattern เดียวกันใน
    // components/CompanySettingsPage.tsx) แม้ peekNextWhtCertNumber() เป็น async อยู่แล้ว แต่ยังต้องห่อ
    // setSequenceLoading(true)/setSequenceLoadError(null) ที่เรียกก่อนเริ่ม fetch ด้วยเช่นกัน
    if (!previewFormType || previewPeriodYear === null || previewPeriodMonth === null) {
      Promise.resolve().then(() => {
        if (!cancelled) setCertNumberInput('');
      });
      return () => {
        cancelled = true;
      };
    }

    Promise.resolve().then(() => {
      if (cancelled) return;
      setSequenceLoading(true);
      setSequenceLoadError(null);
    });

    peekNextWhtCertNumber(companyId, previewFormType, previewPeriodYear, previewPeriodMonth)
      .then((next) => {
        if (!cancelled) {
          setCertNumberInput(formatWhtCertNumber(previewFormType, previewPeriodYear, previewPeriodMonth, next));
        }
      })
      .catch(() => {
        if (!cancelled) setSequenceLoadError('โหลดเลขที่แนะนำไม่สำเร็จ กรอกเลขที่เองได้');
      })
      .finally(() => {
        if (!cancelled) setSequenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, previewFormType, previewPeriodYear, previewPeriodMonth]);

  // บั๊กเดิม (พบ 2026-08-17 จากรายงานผู้ใช้ "ออกใบหัก ณ ที่จ่ายไม่สำเร็จ"): ใช้ regex /(\d+)\s*$/ ตัดกลุ่ม
  // ตัวเลขท้ายสุดของข้อความทั้งก้อน — แต่รูปแบบเลขที่จริงคือ {formType}-{YY}{MM}{NNN} ซึ่ง YY, MM, NNN แปะติด
  // กันไม่มีตัวคั่นเลย (เช่น "53-6907001") ทำให้ regex ตัดเอาทั้ง "6907001" (รวม YY+MM เข้าไปด้วย) มาเป็นเลข
  // ลำดับที่ผิดๆ ทุกครั้งที่ onBlur ยิง (แม้ผู้ใช้แค่คลิกออกจากช่องโดยไม่ได้แก้อะไรเลย) แล้ว format กลับเป็น
  // ข้อความใหม่ที่ยาวขึ้นเรื่อยๆ (เลขลำดับพองขึ้นทุกรอบ blur) จนเกินช่วงของ integer ฝั่ง Postgres (2^31-1) ทำให้
  // RPC ตอบ 400 (numeric_value_out_of_range/check_violation) เป็นสาเหตุที่แท้จริงของปัญหา — แก้โดยตัด prefix
  // "{formType}-{YY}{MM}" ที่ถูกต้องจริง (คำนวณจากผู้รับ+วันที่ออกใบเสมอ ไม่ใช่จากข้อความ) ออกก่อนเสมอ แล้วอ่าน
  // เฉพาะตัวเลขที่เหลือหลัง prefix นั้นเป็นเลขลำดับ ถ้า prefix ไม่ตรง (ผู้ใช้พิมพ์ทับเพี้ยนไป) ถือว่า parse ไม่ได้
  function parseSequenceFromCertNumberInput(text: string): number | null {
    if (!previewFormType || previewPeriodYear === null || previewPeriodMonth === null) return null;
    const yy = String(previewPeriodYear % 100).padStart(2, '0');
    const mm = String(previewPeriodMonth).padStart(2, '0');
    const prefix = `${previewFormType}-${yy}${mm}`;
    const trimmed = text.trim();
    if (!trimmed.startsWith(prefix)) return null;
    const rest = trimmed.slice(prefix.length);
    if (!/^\d+$/.test(rest)) return null;
    const n = Number(rest);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }

  const certNumberHasError = certNumberInput.trim() !== '' && parseSequenceFromCertNumberInput(certNumberInput) === null;

  // ตอน blur จัดรูปแบบข้อความให้ตรงกับ formType/เดือน/ปีที่ถูกต้องจริงเสมอ (เผื่อผู้ใช้พิมพ์ทับ prefix เพี้ยน
  // ไป เช่นลบเลขปีออก) โดยยังคงเลขลำดับที่พิมพ์ไว้ล่าสุด — ถ้า parse เลขลำดับไม่ได้เลย ปล่อยข้อความไว้ตามเดิม
  // ให้ certNumberHasError ด้านบนเตือนแทน (ไม่มี "ค่าที่ถูกต้องล่าสุด" ให้ย้อนกลับแบบช่องวันที่ เพราะเลขแนะนำ
  // เปลี่ยนได้ตลอดตาม bucket) — เพราะ parseSequenceFromCertNumberInput ตอนนี้ตัด prefix ก่อนอ่านเลขเสมอ การ
  // format กลับด้วย seq เดิมจึงเป็น no-op ปลอดภัย ไม่พองขึ้นซ้ำแล้วเหมือนบั๊กเดิม
  function handleCertNumberBlur() {
    const seq = parseSequenceFromCertNumberInput(certNumberInput);
    if (seq !== null && previewFormType && previewPeriodYear !== null && previewPeriodMonth !== null) {
      setCertNumberInput(formatWhtCertNumber(previewFormType, previewPeriodYear, previewPeriodMonth, seq));
    }
  }

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalWhtAmount = invoices.reduce((sum, inv) => sum + inv.wht_amount, 0);
  const totalNetPayment = calcNetPayment(totalAmount, totalWhtAmount);

  const canSubmit =
    !vendorNameMismatch &&
    Boolean(selectedContact) &&
    Boolean(incomeTypeCode) &&
    Boolean(issuedDate) &&
    !certNumberHasError &&
    parseSequenceFromCertNumberInput(certNumberInput) !== null &&
    !sequenceLoading &&
    !submitting;

  async function handleSubmit() {
    const sequenceOverride = parseSequenceFromCertNumberInput(certNumberInput);
    if (!selectedContact || !incomeTypeCode || sequenceOverride === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const [y, m] = issuedDate.split('-').map(Number);
      const periodYear = y + 543;
      const periodMonth = m;
      const formType = formTypeForEntityType(selectedContact.entity_type);

      const input: CreateWhtCertificateInput = {
        companyId,
        formType,
        periodYear,
        periodMonth,
        businessPartnerId: selectedContact.id,
        incomeTypeCode,
        incomeTypeLabel,
        deductionType,
        deductionTypeNote,
        signerName,
        issuedDate,
        invoiceIds: invoices.map((inv) => inv.id),
        sequenceOverride,
      };

      const payer = buildPayerSnapshot(company);
      const payee = buildPayeeSnapshot(selectedContact);
      const cert = await createWhtCertificate(input, payer, payee, createdByEmail);
      onIssued(cert);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ออกใบหัก ณ ที่จ่ายไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ออกใบหัก ณ ที่จ่าย"
      data-testid="issue-wht-cert-modal"
    >
      {/* การ์ด/โมดัลทั้งระบบเป็นกระจกเข้มเสมอ (card-surface ชนะ bg-white เสมอตาม CSS Cascade Layers — ดู
          คอมเมนต์เต็มใน app/globals.css) องค์ประกอบที่วางตรงบนพื้นการ์ดตรงนี้ (ไม่มีกล่อง bg-white ของ
          ตัวเอง) จึงต้องใช้สีอ่อน text-text/text-text-sub ให้อ่านออกบนพื้นเข้ม (2026-08-12)

          โครงสร้างเปลี่ยนเป็น flex column แบ่ง 3 ส่วน (2026-08-17 ตามคำขอผู้ใช้ "หน้าต่างกรอกข้อมูล...
          โชว์ข้อมูลไม่ครบส่วนบนหาย") — เดิม overflow-y-auto อยู่ที่กล่องนอกสุดกล่องเดียว ทำให้หัวเรื่อง/ปุ่มปิด
          เลื่อนหายไปพร้อมเนื้อหาฟอร์มได้เวลาฟอร์มยาวเกินจอ (เช่นเปิดฟอร์มมาก็ไม่เห็นหัวข้อทันที) ตอนนี้แยกหัว
          เรื่อง (shrink-0) และแถบปุ่มด้านล่าง (shrink-0) ออกจากส่วนเนื้อหาฟอร์ม (flex-1 overflow-y-auto)
          อย่างชัดเจน — หัวเรื่อง/ปุ่มปิด และปุ่มยืนยัน/ยกเลิก จะอยู่กับที่เสมอ ไม่ว่าฟอร์มจะยาวแค่ไหน มีแค่ส่วน
          เนื้อหาฟอร์มตรงกลางเท่านั้นที่เลื่อนได้ */}
      <div
        className="card-surface card-surface-modal flex max-h-[calc(100vh-32px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 p-6 pb-4">
          <div>
            <h3 className="text-base font-bold text-text">
              {mode === 'reissue' ? 'แก้ไขใบหัก ณ ที่จ่าย (ออกใบใหม่แทน)' : 'ออกใบหัก ณ ที่จ่าย'}
            </h3>
            <p className="mt-0.5 text-sm text-text-sub">
              {vendorName} · {invoices.length} รายการ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="issue-wht-cert-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 py-4">
        {mode === 'reissue' && (
          <p className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            ใบเดิม{voidedCertNumber ? ` เลขที่ ${voidedCertNumber}` : ''} ถูกยกเลิกแล้ว แก้ไขข้อมูลด้านล่างแล้วกด &quot;ยืนยันออกใบ&quot;
            เพื่อออกใบใหม่แทน (จะได้เลขที่ใหม่ต่อเนื่อง ไม่ใช่เลขเดิม)
          </p>
        )}

        {vendorNameMismatch ? (
          <p className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            รายการที่เลือกมีชื่อผู้ขายไม่ตรงกัน กรุณาเลือกเฉพาะรายการของผู้ขายเดียวกันเท่านั้น
          </p>
        ) : vendorContacts.length === 0 ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
            <p>ยังไม่มีรายชื่อผู้ขายในสมุดรายชื่อเลย กรุณาเพิ่มรายชื่อที่จะออกใบหัก ณ ที่จ่ายให้ก่อน</p>
            {onGoToContacts && (
              <button
                type="button"
                onClick={onGoToContacts}
                className="btn-press mt-2 rounded-[10px] border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                ไปหน้าสมุดรายชื่อ
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* เลือกได้จากรายชื่อผู้ขายทั้งหมด ไม่บังคับให้ชื่อตรงกับ vendor_name อีกต่อไป (2026-08-12 ตามที่
                ผู้ใช้ขอ — จ่ายเงินให้คนหนึ่งแต่ต้องออกใบหักให้อีกคนได้) auto-select ให้ถ้าเจอชื่อตรงกันเป๊ะ
                (selectedContactId เริ่มต้นจาก exactMatches ด้านบน) แต่เปลี่ยนเป็นรายชื่ออื่นได้เสมอ */}
            <Field label="เลือกรายชื่อผู้รับใบหัก ณ ที่จ่าย" required>
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className={inputClass(false)}
                data-testid="select-payee-contact"
              >
                <option value="">-- เลือกรายชื่อ --</option>
                {vendorContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contact_code} — {getContactDisplayName(c)} ({c.tax_id ?? 'ไม่มีเลขผู้เสียภาษี'})
                  </option>
                ))}
              </select>
              {exactMatches.length === 0 && (
                <p className="mt-1.5 text-xs text-text-sub">
                  ไม่พบชื่อที่ตรงกับ &quot;{vendorName}&quot; ในสมุดรายชื่อ — เลือกรายชื่อที่ต้องการออกใบให้จากด้านบน
                  {onGoToContacts && (
                    <>
                      {' '}หรือ{' '}
                      <button type="button" onClick={onGoToContacts} className="text-primary underline hover:no-underline">
                        เพิ่มรายชื่อใหม่
                      </button>
                    </>
                  )}
                </p>
              )}
            </Field>

            {/* เลขที่ใบหัก ณ ที่จ่าย (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — ช่องเดียวพิมพ์แก้ไขได้ตรงๆ (ไม่มี
                ช่อง "ลำดับที่" แยกอีกต่อไปตามคำขอถัดมา) ค่าเริ่มต้นมาจากตัวนับปัจจุบัน (peekNextWhtCertNumber,
                read-only ไม่เพิ่มตัวนับถาวร) — ดูคอมเมนต์เต็มที่ประกาศ certNumberInput ด้านบน */}
            <Field label="เลขที่ใบหัก ณ ที่จ่าย" required>
              <input
                type="text"
                value={certNumberInput}
                onChange={(e) => setCertNumberInput(e.target.value)}
                onBlur={handleCertNumberBlur}
                placeholder={sequenceLoading ? 'กำลังคำนวณ...' : ''}
                className={inputClass(certNumberHasError)}
                data-testid="input-cert-number"
              />
              {certNumberHasError ? (
                <p className="mt-1.5 text-xs text-danger">กรุณากรอกเลขที่ใบให้มีตัวเลขลำดับต่อท้าย (เช่น 53-6907001)</p>
              ) : sequenceLoadError ? (
                <p className="mt-1.5 text-xs text-danger">{sequenceLoadError}</p>
              ) : (
                <p className="mt-1.5 text-xs text-text-sub">ระบบรันเลขให้อัตโนมัติจากเลขที่ยังไม่มีเสมอ แก้ไขได้โดยพิมพ์ทับเลขที่ต้องการ</p>
              )}
            </Field>

            <div className="rounded-[10px] border border-border/70 bg-page-bg/40 px-3.5 py-3 text-sm">
              <div className="flex justify-between text-text-sub">
                <span>ยอดรวม</span>
                <span className="font-numeric">{THB.format(totalAmount)} บาท</span>
              </div>
              <div className="mt-1 flex justify-between text-text-sub">
                <span>หัก ณ ที่จ่ายรวม</span>
                <span className="font-numeric">{THB.format(totalWhtAmount)} บาท</span>
              </div>
              <div className="mt-1 flex justify-between font-medium text-text">
                <span>จ่ายสุทธิ</span>
                <span className="font-numeric">{THB.format(totalNetPayment)} บาท</span>
              </div>
            </div>

            <Field label="ประเภทเงินได้" required>
              <select
                value={incomeTypeCode}
                onChange={(e) => setIncomeTypeCode(e.target.value as WhtIncomeTypeCode)}
                className={inputClass(false)}
                data-testid="select-income-type"
              >
                <option value="">เลือกประเภทเงินได้</option>
                {(Object.keys(INCOME_TYPE_LABELS) as WhtIncomeTypeCode[]).map((code) => (
                  <option key={code} value={code}>
                    {INCOME_TYPE_LABELS[code]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="รายละเอียดเพิ่มเติม (ถ้ามี)">
              <input
                placeholder="เช่น ค่าบริการ, ค่าขนส่ง"
                value={incomeTypeLabel}
                onChange={(e) => setIncomeTypeLabel(e.target.value)}
                className={inputClass(false)}
                data-testid="input-income-type-label"
              />
              {/* ปุ่มตัวเลือกด่วน (2026-08-17 ตามคำขอผู้ใช้ "เผื่อไว้เป็นกรณีที่ฉันขี้เกียจนั่งพิมพ์") — กดแล้ว
                  เติมค่าลงช่องด้านบนทันที ไม่ได้บังคับเลือก ยังพิมพ์เองแก้ไขทับได้ตามปกติเสมอ */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {INCOME_TYPE_LABEL_QUICK_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setIncomeTypeLabel(opt)}
                    className="btn-press rounded-full border border-border px-2.5 py-1 text-xs text-text-sub hover:bg-page-bg"
                    data-testid={`income-type-label-quick-${opt}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="ลักษณะการหักภาษี">
              <select
                value={deductionType}
                onChange={(e) => setDeductionType(e.target.value as WhtDeductionType)}
                className={inputClass(false)}
                data-testid="select-deduction-type"
              >
                {(Object.keys(DEDUCTION_TYPE_LABELS) as WhtDeductionType[]).map((dt) => (
                  <option key={dt} value={dt}>
                    {DEDUCTION_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
            </Field>

            {deductionType === 'other' && (
              <Field label="ระบุลักษณะการหักภาษี">
                <input
                  value={deductionTypeNote}
                  onChange={(e) => setDeductionTypeNote(e.target.value)}
                  className={inputClass(false)}
                  data-testid="input-deduction-type-note"
                />
              </Field>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="วันที่ออกใบ (วว/ดด/ปปปป พ.ศ.)" required>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="เช่น 17/08/2569"
                  value={issuedDateInput}
                  onChange={(e) => handleIssuedDateInputChange(e.target.value)}
                  onBlur={handleIssuedDateBlur}
                  className={inputClass(issuedDateHasError)}
                  data-testid="input-issued-date"
                />
                {issuedDateHasError && (
                  <p className="mt-1 text-xs text-danger">รูปแบบไม่ถูกต้อง กรุณากรอกเป็น วว/ดด/ปปปป (เช่น 17/08/2569)</p>
                )}
              </Field>
              <Field label="ผู้ลงนาม">
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className={inputClass(false)}
                  data-testid="input-signer-name"
                />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 p-6 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg"
          >
            ยกเลิก
          </button>
          {vendorContacts.length > 0 && !vendorNameMismatch && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="confirm-issue-wht-cert"
            >
              {submitting ? 'กำลังออกใบ...' : mode === 'reissue' ? 'ยืนยันออกใบใหม่' : 'ยืนยันออกใบ'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function inputClass(hasError: boolean): string {
  const base =
    'h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm text-gray-800 placeholder:text-gray-400 transition-colors duration-[250ms] focus:outline-none';
  if (hasError) {
    return `${base} border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgba(239,68,68,0.14)]`;
  }
  return `${base} border-border focus-ring-primary`;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-text">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}
