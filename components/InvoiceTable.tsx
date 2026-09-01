'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import type { MarkReceivedInput, PendingTaxInvoice } from '@/types/invoice';
import {
  calcNetPayment,
  getTaxInvoiceStatusBadgeClass,
  getTaxInvoiceStatusLabel,
  isWhtCertEligible,
} from '@/lib/invoiceLogic';
import { buddhistYearOptions, currentBuddhistYear, currentMonth, thaiMonthName } from '@/lib/thaiDate';
import BuddhistDateInput from '@/components/BuddhistDateInput';
import InvoiceDetailModal from '@/components/InvoiceDetailModal';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface InvoiceTableProps {
  invoices: PendingTaxInvoice[];
  today: string;
  onEdit: (invoice: PendingTaxInvoice) => void;
  onMarkReceived: (invoice: PendingTaxInvoice, input: MarkReceivedInput) => Promise<void>;
  onCancelInvoice: (invoice: PendingTaxInvoice) => Promise<void>;
  onDelete: (invoice: PendingTaxInvoice) => Promise<void>;
  // เพิ่มพร้อมฟีเจอร์ "ออกใบหัก ณ ที่จ่าย" (2026-08-11) — เดิมเลือกได้หลายรายการผ่าน checkbox + แถบปุ่มลอย
  // นอกตาราง เปลี่ยนเป็นออกทีละรายการจากเมนู "จัดการเอกสาร" ของแต่ละแถวแทน (2026-08-14 ตามคำขอผู้ใช้ — ดู
  // ตัวเลือก "จัดการใบหัก ณ ที่จ่าย" ในเมนูด้านล่าง) เรียกเมื่อกดเลือกแถวใดแถวหนึ่งที่ isWhtCertEligible() เป็น
  // true เท่านั้น (ตัวเลือกในเมนูก็แสดงเฉพาะแถวที่เข้าเงื่อนไขนี้เช่นกัน) ไม่บังคับส่งมา (optional) เพื่อไม่กระทบ
  // จุดอื่นที่อาจเรียกใช้ InvoiceTable โดยไม่ต้องรองรับฟีเจอร์นี้
  onIssueWht?: (invoice: PendingTaxInvoice) => void;
  // เพิ่มเข้ามาตามคำขอผู้ใช้ (2026-08-12) — แสดงเลขที่ใบหัก ณ ที่จ่าย + ชื่อที่ออกใบให้ เป็นตัวเล็กๆ ใต้ชื่อ
  // ผู้ขายของแถวที่ออกใบไปแล้ว (invoice.wht_certificate_id ไม่เป็น null) เก็บเป็น Map คีย์ด้วย cert id เพราะ
  // parent (ExpenseRecordContent) ดึงใบหัก ณ ที่จ่ายทั้งหมดของบริษัทมาแล้ว แค่ต้อง lookup ตรงๆ ไม่ query ซ้ำ
  // ที่นี่ — ไม่บังคับส่งมา (ถ้าไม่ส่งจะไม่แสดงตัวเล็กนี้เลย ไม่ error)
  whtCertificatesById?: Map<string, { cert_number: string; payee_name: string }>;
}

// เอาคอลัมน์ "คาดว่าจะได้รับ" ออกจากตารางแล้ว (2026-08-10 ตามคำขอผู้ใช้) — getAgingBucket ด้านล่างยังใช้
// invoice.expected_date คำนวณป้าย Aging (รอรับกี่วัน) อยู่เหมือนเดิมทุกประการ ไม่ได้ลบข้อมูลนี้ทิ้ง แค่ไม่
// โชว์เป็นคอลัมน์แยกอีกต่อไป
//
// เอาคอลัมน์ "ยอดรวม" ออกจากตารางแล้วเช่นกัน (2026-08-10 ตามคำขอผู้ใช้ หลังเพิ่มฟีเจอร์หัก ณ ที่จ่าย) — ผู้ใช้
// เห็นว่า "ยอดรวม" กับ "ยอดจ่ายสุทธิ" ที่เพิ่มเข้ามาใหม่ดูซ้ำซ้อนกัน (ส่วนใหญ่ไม่มี WHT ตัวเลขจึงเท่ากันพอดี)
// จึงเหลือแสดงแค่ "ยอดจ่ายสุทธิ" คอลัมน์เดียว (= ยอดรวม - หัก ณ ที่จ่าย, เท่ากับยอดรวมเป๊ะๆ เมื่อไม่มี WHT)
// total_amount ยังคงอยู่ในข้อมูล/ฐานข้อมูลเหมือนเดิมทุกประการ (ยังใช้คำนวณยอดจ่ายสุทธิ, ใช้ในรายงานภาษีซื้อ,
// สรุปยอด ฯลฯ) แค่ไม่มีคอลัมน์ "ยอดรวม" แยกอีกต่อไป
//
// เอาการคลิกหัวตารางเพื่อเรียงลำดับออกทั้งหมดแล้ว (2026-08-14 ตามคำขอผู้ใช้ — เดิมหัวตาราง "ผู้ขาย"/
// "วันที่ทำรายการ" กดแล้วสลับ asc/desc ได้ ผู้ใช้แจ้งว่ากดโดนแล้วเข้าใจผิดคิดว่าเป็นตัวกรอง ไม่ต้องการให้กดแล้ว
// เปลี่ยนลำดับได้อีก) เดิมมี COLUMNS array วนสร้างหัวตารางที่คลิกได้ตรงนี้ ตอนนี้ลบทิ้งแล้ว หัวตารางทุกคอลัมน์
// เป็น <th> ธรรมดาแบบเดียวกับคอลัมน์อื่นๆ ทั้งหมด (ดู thead ด้านล่าง) — ลำดับข้อมูลยังคงเดิมเสมอ กำหนดจาก
// app/dashboard/page.tsx (sortField/sortDirection ค่าคงที่ ไม่มี UI ให้ผู้ใช้เปลี่ยนอีกต่อไป)
//
// จัดลำดับคอลัมน์ใหม่ตามคำขอผู้ใช้ (2026-08-14): วันที่ทำรายการ, เลขที่อ้างอิง, ผู้ขาย, ยอดก่อน VAT, VAT,
// หัก ณ ที่จ่าย, ยอดจ่ายสุทธิ, สถานะ/Aging, การจัดการ (เดิมคือ ผู้ขาย, วันที่ทำรายการ, ..., เลขที่อ้างอิง, ...)

export default function InvoiceTable({
  invoices,
  today,
  onEdit,
  onMarkReceived,
  onCancelInvoice,
  onDelete,
  onIssueWht,
  whtCertificatesById,
}: InvoiceTableProps) {
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  // เพิ่ม 3 ฟิลด์ใหม่สำหรับรายงานภาษีซื้อ (ดู lib/vatReportLogic.ts) — vatClaimMonth/Year ใช้ ''
  // แทนค่ายังไม่ได้เลือกใน <select> (ควบคุมด้วย React แบบ controlled component)
  const [taxInvoiceDate, setTaxInvoiceDate] = useState('');
  const [vatClaimMonth, setVatClaimMonth] = useState<number | ''>('');
  const [vatClaimYear, setVatClaimYear] = useState<number | ''>('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // รวมปุ่ม "ได้รับแล้ว/ยกเลิกรายการ/แก้ไข/ลบ" เป็นปุ่มเดียว "จัดการเอกสาร" ที่กดแล้วมีเมนูลอยสไลด์ลงมาแสดง
  // ตัวเลือกแทน (2026-08-12 ตามคำขอผู้ใช้ — เดิมโชว์ปุ่มทั้งหมดพร้อมกันทำให้คอลัมน์ดูรกเมื่อมีทั้ง 4 ปุ่ม
  // พร้อมกัน) เก็บเป็น id เดียว (ไม่ใช่ Set) เพราะเปิดได้ทีละแถวพอ — เป็นเมนูลอย (position: absolute) ไม่ใช่
  // accordion ดันความสูงแถวตาราง (ลองแบบ accordion ก่อนแล้วไม่ลื่นไหลเพราะอยู่ในบริบท tr/td) ดู JSX ด้านล่าง
  const [expandedActionsId, setExpandedActionsId] = useState<string | null>(null);
  // ทิศทางที่เมนู "จัดการเอกสาร" ที่เปิดอยู่ตอนนี้ควรกางออก (ขึ้น/ลง) — เพิ่มเข้ามา 2026-08-26 แก้บั๊กที่ผู้ใช้
  // แจ้งว่ากด "จัดการเอกสาร" ของตารางที่มีแค่ 1-2 แถวแล้วเมนูโผล่พ้นขอบบนจอ มองไม่เห็นตัวเลือกครบ — เดิมคำนวณ
  // จาก index เทียบกับ invoices.length (ดู commit เก่า: "2 แถวสุดท้ายเปิดขึ้นด้านบนแทนด้านล่าง") ซึ่งใช้ได้ดี
  // เฉพาะตารางแถวเยอะที่แถวท้ายๆ อยู่ใกล้ขอบล่างจอจริง แต่พังทันทีถ้าตารางมีแค่ 1-2 แถว เพราะ "2 แถวสุดท้าย"
  // ก็คือ "ทุกแถวในตาราง" พอดี ทั้งที่แถวเหล่านั้นอยู่ใกล้ขอบบนจอ (ใต้ thead ทันที) ไม่ใช่ขอบล่าง — เปลี่ยนมาวัด
  // พื้นที่ว่างจริงด้านล่างปุ่มตอนกดเปิดเมนู (ครั้งเดียวตอน onClick ซึ่ง layout นิ่งแล้วแน่นอน ไม่ใช่การวัดระหว่าง
  // render/transition ที่เคยเจอปัญหาค่าเพี้ยนกับ sliding indicator ใน ContactsPage.tsx) ถ้าเหลือพื้นที่ด้านล่าง
  // ไม่พอสำหรับเมนู (ประมาณความสูงสูงสุดที่เป็นไปได้ไว้ก่อน เผื่อกรณีมีตัวเลือกครบทุกอันพร้อมกัน) ถึงจะเปิดขึ้น
  const [menuOpensUpward, setMenuOpensUpward] = useState(false);
  // ความสูงโดยประมาณของเมนูเวลามีตัวเลือกครบทุกอัน (ดูรายละเอียด/ได้รับแล้ว/จัดการใบหัก ณ ที่จ่าย/ยกเลิกรายการ/
  // แก้ไข/ลบ 6 ปุ่ม ปุ่มละ ~34px รวม padding กล่อง ~12px) เผื่อไว้มากกว่าความสูงจริงเสมอ ปลอดภัยไว้ก่อน
  const ACTIONS_MENU_MAX_HEIGHT = 260;
  // ตำแหน่งจริงของปุ่ม "จัดการเอกสาร" ที่กำลังเปิดเมนูอยู่ (มุมบน/ล่าง/ขวา เทียบ viewport) — เพิ่มเข้ามา
  // 2026-08-26 (รอบ 2) แก้บั๊กที่ผู้ใช้แจ้งว่าตอนตารางมีแค่ 1-2 แถว เมนูที่เปิดขึ้นมาถูก "กรอบ" ของตารางบังไป
  // (แสดงข้อความไม่ครบ) — ต้นตอคือ div.card-surface ที่ห่อตารางใช้ overflow-x-auto (จำเป็นสำหรับเลื่อนตาราง
  // แนวนอนตอนจอแคบ) แต่ตาม CSS spec ถ้า overflow แกนใดแกนหนึ่งไม่ใช่ visible อีกแกนที่เหลือ (overflow-y ในที่นี้
  // ซึ่งไม่ได้ตั้งค่าไว้ตรงๆ) จะถูกบังคับกลายเป็น auto ไปด้วยเสมอ (ไม่ใช่ visible ตามที่ตั้งใจ) ทำให้กล่องนี้
  // กลายเป็น scroll container ที่ตัด (clip) ลูกที่เป็น position:absolute ซึ่งกางออกเกินขอบกล่องไปทันที — ปุ่ม
  // เมนูเดิมใช้ position:absolute ลอยทับซ้อนอยู่ในกล่องนี้จึงโดนตัดพอดี ทางแก้: เปลี่ยนเมนูให้ portal ออกไปแปะที่
  // document.body ตรงๆ (createPortal เหมือน ReceiveInvoiceModal/InvoiceDetailModal ด้านล่าง) แล้วใช้
  // position:fixed คำนวณพิกัดจาก getBoundingClientRect() ของปุ่มตรงๆ แทน — วิธีนี้ไม่ขึ้นกับ overflow ของ
  // ancestor ใดๆ เลยไม่ว่าจะเป็นกี่ชั้นก็ตาม (บั๊กคลาสเดียวกับที่เจอตอนแก้ modal ทั้งสองด้านล่าง แค่ต้นตอเป็น
  // overflow แทน backdrop-filter/transform)
  const [menuAnchorRect, setMenuAnchorRect] = useState<{ top: number; bottom: number; right: number } | null>(null);

  function handleToggleActionsMenu(e: React.MouseEvent<HTMLButtonElement>, invoiceId: string) {
    if (expandedActionsId === invoiceId) {
      setExpandedActionsId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setMenuOpensUpward(spaceBelow < ACTIONS_MENU_MAX_HEIGHT);
    setMenuAnchorRect({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setExpandedActionsId(invoiceId);
  }
  // id ของแถวที่กำลังเปิด modal "ดูรายละเอียด" อยู่ (ถ้ามี) — เพิ่มเข้ามา 2026-08-26 ตามคำขอผู้ใช้ (ดู
  // InvoiceDetailModal.tsx) หาแบบเดียวกับ receivingInvoice ด้านล่าง (เทียบ id แทนเก็บ object เต็มไว้ใน state)
  // เพื่อให้ modal เห็นข้อมูลล่าสุดเสมอถ้า invoices ที่มาจาก SWR cache อัปเดตสดระหว่างเปิด modal อยู่
  const [viewingId, setViewingId] = useState<string | null>(null);

  // ปิดเมนู "จัดการเอกสาร" อัตโนมัติเมื่อคลิกนอกเมนู — เป็นพฤติกรรมมาตรฐานของ dropdown menu ที่ลอยทับแถวอื่น
  // (ต่างจาก .month-detail-panel/.nav-accordion-panel เดิมที่เป็น accordion ดันเนื้อหาลง ไม่ใช่เมนูลอย จึงไม่
  // เคยต้องมี handler แบบนี้มาก่อน) ใช้ data-row-actions-menu เป็นตัวเช็คขอบเขต แทนการผูก ref ทีละแถว เพราะ
  // ตารางนี้ render หลายแถวพร้อมกันด้วย state expandedActionsId ตัวเดียว (เก็บแค่ id แถวที่เปิดอยู่)
  useEffect(() => {
    if (!expandedActionsId) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-row-actions-menu]')) {
        setExpandedActionsId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedActionsId]);

  async function handleConfirmReceived(invoice: PendingTaxInvoice) {
    if (!taxInvoiceNumber.trim() || !taxInvoiceDate || !vatClaimMonth || !vatClaimYear) return;
    setBusyId(invoice.id);
    try {
      await onMarkReceived(invoice, {
        taxInvoiceNumber: taxInvoiceNumber.trim(),
        receivedDate,
        taxInvoiceDate,
        vatClaimMonth,
        vatClaimYear,
      });
      setReceivingId(null);
      setTaxInvoiceNumber('');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteClick(invoice: PendingTaxInvoice) {
    if (confirmingDeleteId !== invoice.id) {
      setConfirmingDeleteId(invoice.id);
      return;
    }
    setBusyId(invoice.id);
    try {
      await onDelete(invoice);
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  // แถวที่กำลังเปิด modal "ได้รับแล้ว" อยู่ (ถ้ามี) — หาแบบนี้แทนเก็บ invoice object เต็มไว้ใน state
  // เพราะ invoices มาจาก SWR cache ที่อาจอัปเดตสดระหว่างเปิด modal อยู่ (เช่น mutate() จากที่อื่น) ทำให้
  // modal เห็นข้อมูลล่าสุดเสมอแทนที่จะค้างข้อมูลเก่า ณ ตอนกดเปิด
  const receivingInvoice = receivingId ? (invoices.find((inv) => inv.id === receivingId) ?? null) : null;
  const viewingInvoice = viewingId ? (invoices.find((inv) => inv.id === viewingId) ?? null) : null;
  // แถวที่กำลังเปิดเมนู "จัดการเอกสาร" อยู่ (ถ้ามี) — หาแบบเดียวกับ receivingInvoice/viewingInvoice ด้านบน
  // ใช้กับเมนูที่ portal ออกไปแปะ document.body (ดู ActionsMenuPortal ท้ายไฟล์) แทนที่จะ render ซ้อนอยู่ในแถว
  const expandedInvoice = expandedActionsId ? (invoices.find((inv) => inv.id === expandedActionsId) ?? null) : null;

  if (invoices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub">
        ไม่พบรายการ
      </div>
    );
  }

  // ครอบด้วย Fragment แทนที่จะคืนแค่ div เดียว (2026-08-26 — แก้บั๊ก modal "ดูรายละเอียด"/"ได้รับแล้ว" ลอยขึ้น
  // ไปติดขอบบนจอแทนที่จะอยู่กึ่งกลางจอจริง) ต้นตอมี 2 ชั้นซ้อนกัน: (1) เดิม modal ทั้งสอง (position:fixed
  // inset-0) render เป็นลูกอยู่ข้างใน div.card-surface ของตารางนี้เอง ซึ่งมี backdrop-filter: blur(...) —
  // ย้ายออกมาเป็น sibling นอก div.card-surface แก้จุดนี้ไปแล้วรอบก่อน แต่ (2) หน้า "บันทึกการจ่ายเงิน"
  // (app/dashboard/page.tsx) เองก็ห่อ <InvoiceTable> ด้วย <div className="entrance-animate entrance-delay-3">
  // อีกชั้น — .entrance-animate ใช้ "animation: entranceFadeSlide 220ms ease both" (ดู app/globals.css) ซึ่ง
  // fill-mode "both" ทำให้ transform: translateY(0) ของ keyframe ปลายทางค้างอยู่ถาวรหลัง animation จบ (ไม่ใช่
  // "none") — ตาม CSS spec transform ที่ไม่ใช่ "none" ใดๆ ก็สร้าง containing block ใหม่ให้ลูกที่เป็น
  // position:fixed เสมอ (บั๊กคลาสเดียวกับที่เคยแก้ให้ Sidebar ใน .dashboard-content-entrance) ไม่แก้
  // .entrance-animate ตรงๆ เพราะใช้ร่วมกับ entrance-delay-N ทั่วทั้งระบบ (ContactsPage ฯลฯ) — ถ้าเอา "both"
  // ออกจะเสีย "backwards" ที่จำเป็นสำหรับซ่อน element ระหว่างช่วง animation-delay ทำให้เกิดวูบก่อนเลื่อนขึ้นแทน
  // แก้ที่ต้นตอไม่ได้โดยไม่กระทบวงกว้าง จึงเลี่ยงปัญหาแทนด้วย React Portal (createPortal ไป document.body ตรงๆ)
  // สำหรับ modal ทั้งสองนี้ — วิธีนี้ไม่ขึ้นกับ ancestor CSS ใดๆ เลยไม่ว่าจะเป็น transform/backdrop-filter/
  // filter/contain ในอนาคตจะมีเพิ่มอีกกี่ชั้นก็ไม่กระทบ
  return (
    <>
      <div className="card-surface overflow-x-auto rounded-2xl">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-table-header">
          <tr>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">วันที่ทำรายการ</th>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เลขที่อ้างอิง</th>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ผู้ขาย</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดก่อน VAT</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">VAT</th>
            {/* เพิ่มพร้อมฟีเจอร์ "หัก ณ ที่จ่าย" (2026-08-10) — wht_amount เป็น 0 = ไม่มีการหัก, ยอดจ่ายสุทธิ
                คำนวณสด (total_amount - wht_amount) ไม่ใช่คอลัมน์ในฐานข้อมูล ดู lib/invoiceLogic.ts calcNetPayment */}
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">หัก ณ ที่จ่าย</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดจ่ายสุทธิ</th>
            {/* ผู้ติดต่อ (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — บอกว่าควรตามเอกสารกับใคร ไม่บังคับกรอก
                แถวที่ไม่มีค่าแสดง "-" เหมือนคอลัมน์ optional อื่นๆ ในตารางนี้ */}
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ผู้ติดต่อ</th>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะ</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {invoices.map((invoice, index) => {
            return (
              <tr
                key={invoice.id}
                data-testid={`invoice-row-${invoice.id}`}
                className={`transition-colors duration-150 hover:bg-table-row-hover ${
                  index % 2 === 1 ? 'bg-table-row-zebra' : ''
                }`}
              >
                <td className="px-[18px] py-[18px] text-text-sub">{formatDate(invoice.transaction_date)}</td>
                <td className="px-[18px] py-[18px] text-text-sub">{invoice.reference_no || '-'}</td>
                <td className="px-[18px] py-[18px] font-medium text-text">
                  {invoice.vendor_name}
                  {/* เลขที่ใบหัก ณ ที่จ่าย + ชื่อที่ออกใบให้ (2026-08-12) — แสดงเฉพาะแถวที่ผูกกับใบที่ยัง
                      ไม่ถูกยกเลิก (wht_certificate_id ไม่เป็น null เสมอกลับไปเป็น null ทันทีที่ใบถูกยกเลิก
                      ผ่าน void_wht_certificate — ดู migration_016) ชื่อที่ออกอาจไม่ตรงกับ vendor_name
                      คอลัมน์นี้เพราะเลือกออกใบให้คนละคนได้ (ดู IssueWhtCertificateModal.tsx) */}
                  {invoice.wht_certificate_id &&
                    whtCertificatesById?.get(invoice.wht_certificate_id) &&
                    (() => {
                      const cert = whtCertificatesById.get(invoice.wht_certificate_id!)!;
                      return (
                        <div className="mt-0.5 text-xs font-normal text-text-sub" data-testid={`wht-cert-info-${invoice.id}`}>
                          <p>เลขที่ {cert.cert_number}</p>
                          <p>ชื่อ {cert.payee_name}</p>
                        </div>
                      );
                    })()}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`amount-excl-vat-${invoice.id}`}
                >
                  {THB.format(invoice.amount_excl_vat)}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`vat-amount-${invoice.id}`}
                >
                  {THB.format(invoice.vat_amount)}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`wht-amount-${invoice.id}`}
                >
                  {invoice.wht_amount ? THB.format(invoice.wht_amount) : '-'}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text"
                  data-testid={`net-payment-${invoice.id}`}
                >
                  {THB.format(calcNetPayment(invoice.total_amount, invoice.wht_amount))}
                </td>
                <td
                  className="px-[18px] py-[18px] text-text-sub"
                  data-testid={`contact-person-${invoice.id}`}
                >
                  {invoice.contact_person || '-'}
                </td>
                <td className="px-[18px] py-[18px]">
                  {/* เอาป้าย Aging (ช่อง "-" ใต้สถานะ) ออกทั้งหมด (2026-08-14 ตามคำขอผู้ใช้) — เดิมคอลัมน์นี้มี
                      2 ป้ายซ้อนกัน (สถานะ + Aging) เหลือแค่ป้ายสถานะป้ายเดียว ไม่ต้องมี div ครอบ flex-col
                      อีกต่อไปเพราะมีลูกแค่ตัวเดียว */}
                  <span
                    className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${getTaxInvoiceStatusBadgeClass(invoice)}`}
                    data-testid={`tax-status-badge-${invoice.id}`}
                  >
                    {getTaxInvoiceStatusLabel(invoice)}
                  </span>
                </td>
                <td className="px-[18px] py-[18px]">
                  {/* ปุ่มเปิดเมนูเท่านั้น — ตัวเมนูเองย้ายไป portal ที่ document.body แล้ว (ดู
                      ActionsMenuPortal + expandedInvoice ท้ายไฟล์) ไม่ได้ซ้อนอยู่ในเซลล์นี้อีกต่อไป (แก้บั๊ก
                      เมนูโดนกรอบ div.card-surface ตัด — ดูคอมเมนต์เต็มที่ menuAnchorRect ด้านบน) data-row-
                      actions-menu ยังต้องอยู่ที่นี่เหมือนเดิม เพื่อกันไม่ให้คลิกปุ่มนี้เองถูกนับเป็น "คลิกนอกเมนู" */}
                  <div data-row-actions-menu>
                    <button
                      type="button"
                      onClick={(e) => handleToggleActionsMenu(e, invoice.id)}
                      className="btn-press flex items-center gap-1 rounded-[10px] border border-border px-2.5 py-1.5 text-xs font-medium text-text-sub hover:bg-page-bg"
                      aria-expanded={expandedActionsId === invoice.id}
                      data-testid={`manage-actions-${invoice.id}`}
                    >
                      จัดการเอกสาร
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${
                          expandedActionsId === invoice.id ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {receivingInvoice &&
        createPortal(
          <ReceiveInvoiceModal
            invoice={receivingInvoice}
            taxInvoiceNumber={taxInvoiceNumber}
            setTaxInvoiceNumber={setTaxInvoiceNumber}
            receivedDate={receivedDate}
            setReceivedDate={setReceivedDate}
            taxInvoiceDate={taxInvoiceDate}
            setTaxInvoiceDate={setTaxInvoiceDate}
            vatClaimMonth={vatClaimMonth}
            setVatClaimMonth={setVatClaimMonth}
            vatClaimYear={vatClaimYear}
            setVatClaimYear={setVatClaimYear}
            busy={busyId === receivingInvoice.id}
            onClose={() => {
              setReceivingId(null);
              setTaxInvoiceNumber('');
            }}
            onConfirm={() => handleConfirmReceived(receivingInvoice)}
          />,
          document.body
        )}
      {viewingInvoice &&
        createPortal(
          <InvoiceDetailModal
            invoice={viewingInvoice}
            whtCertificatesById={whtCertificatesById}
            onClose={() => setViewingId(null)}
          />,
          document.body
        )}
      {/* เมนู "จัดการเอกสาร" — portal ออกไป document.body ตรงๆ (ดูเหตุผลเต็มที่ menuAnchorRect ด้านบน) แทนที่
          จะซ้อนอยู่ในเซลล์ตารางแบบเดิม ใช้ position:fixed คำนวณพิกัดจาก menuAnchorRect ที่จับตอนคลิกปุ่ม —
          เปิดได้ทีละแถวเท่านั้น (expandedActionsId เป็น id เดียว) จึง render แค่ก้อนเดียวพอ ไม่ต้องวนซ้ำต่อแถว */}
      {expandedInvoice &&
        menuAnchorRect &&
        createPortal(
          <div
            data-row-actions-menu
            className="fixed z-30 w-44 rounded-[10px] border border-border bg-card-bg p-1.5 shadow-lg"
            style={{
              right: window.innerWidth - menuAnchorRect.right,
              ...(menuOpensUpward
                ? { bottom: window.innerHeight - menuAnchorRect.top + 6 }
                : { top: menuAnchorRect.bottom + 6 }),
            }}
          >
            <div className="flex flex-col gap-1">
              {/* "ดูรายละเอียด" — วางไว้บนสุดของเมนูเสมอ (ไม่ผูกเงื่อนไข status/tax_type ใดๆ ต่างจากตัวเลือก
                  อื่นด้านล่าง) เพราะเป็น action ดูอย่างเดียวไม่มีผลข้างเคียง เหมาะกับทุกแถวไม่ว่าจะอยู่สถานะไหน */}
              <button
                type="button"
                onClick={() => {
                  setExpandedActionsId(null);
                  setViewingId(expandedInvoice.id);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                data-testid={`view-detail-${expandedInvoice.id}`}
              >
                ดูรายละเอียด
              </button>
              {expandedInvoice.status === 'pending' &&
                expandedInvoice.tax_type !== 'no_vat' &&
                expandedInvoice.tax_type !== 'non_claimable_vat' && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedActionsId(null);
                      setReceivingId(expandedInvoice.id);
                      setTaxInvoiceNumber('');
                      setReceivedDate(today);
                      setTaxInvoiceDate('');
                      // เดือน/ปีที่ใช้เครดิต VAT ตั้งค่าเริ่มต้นเป็นเดือน/ปีปัจจุบัน (กรณีส่วนใหญ่ที่นำไปเครดิต
                      // ในเดือนเดียวกับที่กำลังบันทึก) ผู้ใช้แก้เป็นเดือน/ปีอื่นได้เสมอ
                      setVatClaimMonth(currentMonth());
                      setVatClaimYear(currentBuddhistYear());
                    }}
                    className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-success hover:bg-success/10"
                    data-testid={`mark-received-${expandedInvoice.id}`}
                  >
                    ได้รับแล้ว
                  </button>
                )}
              {/* "จัดการใบหัก ณ ที่จ่าย" — เงื่อนไขแสดงตรงกับที่ checkbox เดิมเคยใช้ (isWhtCertEligible เท่านั้น
                  ไม่ผูกกับ status/tax_type แบบ "ได้รับแล้ว"/"ยกเลิกรายการ" เพราะรายการที่ "ได้รับแล้ว" ก็ยังออก
                  ใบหัก ณ ที่จ่ายได้ถ้ายังไม่เคยออก) */}
              {onIssueWht && isWhtCertEligible(expandedInvoice) && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedActionsId(null);
                    onIssueWht(expandedInvoice);
                  }}
                  className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                  data-testid={`issue-wht-${expandedInvoice.id}`}
                >
                  จัดการใบหัก ณ ที่จ่าย
                </button>
              )}
              {expandedInvoice.status === 'pending' &&
                expandedInvoice.tax_type !== 'no_vat' &&
                expandedInvoice.tax_type !== 'non_claimable_vat' && (
                  <button
                    type="button"
                    disabled={busyId === expandedInvoice.id}
                    onClick={() => {
                      setExpandedActionsId(null);
                      onCancelInvoice(expandedInvoice);
                    }}
                    className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                  >
                    ยกเลิกรายการ
                  </button>
                )}
              <button
                type="button"
                onClick={() => {
                  setExpandedActionsId(null);
                  onEdit(expandedInvoice);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                data-testid={`edit-${expandedInvoice.id}`}
              >
                แก้ไข
              </button>
              <button
                type="button"
                disabled={busyId === expandedInvoice.id}
                onClick={() => handleDeleteClick(expandedInvoice)}
                onBlur={() => setConfirmingDeleteId(null)}
                className={`btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium ${
                  confirmingDeleteId === expandedInvoice.id
                    ? 'bg-danger text-white'
                    : 'text-danger hover:bg-danger/10'
                }`}
                data-testid={`delete-${expandedInvoice.id}`}
              >
                {confirmingDeleteId === expandedInvoice.id ? 'ยืนยันลบ?' : 'ลบ'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Modal กรอกข้อมูล "ได้รับแล้ว" (เลขที่ใบกำกับภาษี/วันที่/เดือน-ปีที่ใช้เครดิต VAT) — เพิ่มเข้ามาแทนฟอร์ม
 * inline เดิมที่ยัดอยู่ในเซลล์ตาราง "การจัดการ" แคบๆ (2026-08-17 ตามคำขอผู้ใช้ "อยากให้การกรอกเลขที่
 * ใบกำกับภาษี เด้งขึ้นมาเป็นหน้าต่างกลางจอ") state ทั้งหมดยังคงอยู่ที่ InvoiceTable (ตัว parent) เหมือนเดิม
 * ไม่ย้ายเข้ามาในนี้ ที่นี่เป็นแค่ presentational component รับ props ล้วนๆ ตามสไตล์เดียวกับที่ modal อื่นๆ
 * ในระบบทำ (ดู IssueWhtCertificateModal.tsx) — วางไว้ท้ายไฟล์นี้แทนแยกไฟล์ใหม่ เพราะใช้เฉพาะใน
 * InvoiceTable.tsx จุดเดียวเท่านั้น ไม่มีจุดอื่นเรียกใช้ */
interface ReceiveInvoiceModalProps {
  invoice: PendingTaxInvoice;
  taxInvoiceNumber: string;
  setTaxInvoiceNumber: (v: string) => void;
  receivedDate: string;
  setReceivedDate: (v: string) => void;
  taxInvoiceDate: string;
  setTaxInvoiceDate: (v: string) => void;
  vatClaimMonth: number | '';
  setVatClaimMonth: (v: number | '') => void;
  vatClaimYear: number | '';
  setVatClaimYear: (v: number | '') => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ReceiveInvoiceModal({
  invoice,
  taxInvoiceNumber,
  setTaxInvoiceNumber,
  receivedDate,
  setReceivedDate,
  taxInvoiceDate,
  setTaxInvoiceDate,
  vatClaimMonth,
  setVatClaimMonth,
  vatClaimYear,
  setVatClaimYear,
  busy,
  onClose,
  onConfirm,
}: ReceiveInvoiceModalProps) {
  const canConfirm = taxInvoiceNumber.trim() !== '' && taxInvoiceDate !== '' && vatClaimMonth !== '' && vatClaimYear !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="บันทึกว่าได้รับเอกสารแล้ว"
      data-testid="receive-invoice-modal"
    >
      {/* การ์ด/โมดัลทั้งระบบเป็นกระจกเข้มเสมอ (card-surface ชนะ bg-white เสมอตาม CSS Cascade Layers — ดู
          คอมเมนต์เต็มใน app/globals.css) ใช้ตัวเลือกสี/โครงเดียวกับ IssueWhtCertificateModal.tsx ทุกประการ
          เพื่อความสม่ำเสมอของ modal ทั้งระบบ */}
      <div
        className="card-surface card-surface-modal max-h-[calc(100vh-48px)] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">บันทึกว่าได้รับเอกสารแล้ว</h3>
            <p className="mt-0.5 text-sm text-text-sub">{invoice.vendor_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="receive-invoice-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-sub">
            เลขที่ใบกำกับภาษี *
            <input
              placeholder="เลขที่ใบกำกับภาษี"
              value={taxInvoiceNumber}
              onChange={(e) => setTaxInvoiceNumber(e.target.value)}
              className="w-full rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-gray-800 focus-ring-primary"
              data-testid={`tax-invoice-number-input-${invoice.id}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-sub">
            วันที่ได้รับเอกสาร
            <BuddhistDateInput
              value={receivedDate}
              onChange={setReceivedDate}
              buildClassName={() =>
                'w-full rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-gray-800 focus-ring-primary'
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-sub">
            วันที่ใบกำกับภาษี *
            <BuddhistDateInput
              value={taxInvoiceDate}
              onChange={setTaxInvoiceDate}
              buildClassName={() =>
                'w-full rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-gray-800 focus-ring-primary'
              }
              testId={`tax-invoice-date-input-${invoice.id}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-sub">
            เดือนที่ใช้เครดิต VAT *
            <select
              value={vatClaimMonth}
              onChange={(e) => setVatClaimMonth(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-gray-800 focus-ring-primary"
              data-testid={`vat-claim-month-select-${invoice.id}`}
            >
              <option value="">เลือกเดือน</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {thaiMonthName(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-sub">
            ปีที่ใช้เครดิต VAT *
            <select
              value={vatClaimYear}
              onChange={(e) => setVatClaimYear(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-gray-800 focus-ring-primary"
              data-testid={`vat-claim-year-select-${invoice.id}`}
            >
              <option value="">เลือกปี</option>
              {buddhistYearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border px-3.5 py-2 text-sm text-text-sub hover:bg-page-bg"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!canConfirm || busy}
            onClick={onConfirm}
            className="btn-press rounded-[10px] bg-success px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid={`confirm-received-${invoice.id}`}
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}
