'use client';

import {
  Building2,
  BookUser,
  FileClock,
  FileInput,
  FileOutput,
  FileText,
  History,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  SearchCheck,
  Send,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useTheme } from '@/lib/ThemeContext';

interface HeaderProps {
  title: string;
  onMenuClick: () => void;
}

// หมายเหตุ: handleSignOut ที่นี่คือ logic เดิมจาก Navbar.tsx ทุกประการ (ย้ายมาไว้ใน Header
// ของโครง Sidebar ใหม่ — ไม่ได้แก้ไข event หรือฟังก์ชันการทำงาน) ปุ่ม "ออกจากระบบ" ยังคงมี
// ข้อความ/พฤติกรรมเดิมทุกอย่างเพื่อไม่ให้กระทบเทสต์และผู้ใช้เดิม

// ไอคอน + คำอธิบายประจำแต่ละหน้า สำหรับ Header เท่านั้น (ผูกกับ title ที่ได้รับมาเป็น prop
// อยู่แล้ว — ไม่ได้แก้ไข lib/navigation.ts หรือ activeId ใดๆ) รายการ key ตรงกับ label ของ
// NavLeaf ทุกอันใน lib/navigation.ts ณ ปัจจุบัน ไอคอนที่เลือกใช้ตัวเดียวกับใน Sidebar ของ
// เมนูนั้นๆ เพื่อให้ผู้ใช้เห็นความต่อเนื่องกับเมนูที่กดเลือก
const PAGE_META: Record<string, { icon: LucideIcon; description: string }> = {
  Dashboard: {
    icon: LayoutDashboard,
    description: 'ภาพรวมระบบและสรุปข้อมูลสำคัญ',
  },
  // key เปลี่ยนจาก 'บันทึกค่าใช้จ่าย' เป็น 'บันทึกการจ่ายเงิน' ตาม label ใหม่ใน lib/navigation.ts
  // (2026-07-17 — ยุบหมวด "บันทึกการจ่ายเงิน" เหลือเมนูเดียว) ไอคอนเปลี่ยนจาก Wallet เป็น Send ให้ตรงกับ
  // ไอคอน Sidebar ของเมนูนี้ตามกฎเดิม (ดูคอมเมนต์ด้านบน) — description คงข้อความเดิมไว้เพราะยังอธิบาย
  // เนื้อหาหน้านี้ถูกต้อง (หน้า/component เดิมไม่ถูกแก้ไขเลย) — คีย์ 'รายงานจ่ายเงิน' เดิมถูกลบออกเพราะเมนู
  // ปลายทางของมัน (payment-report) ไม่มีอยู่ใน Sidebar อีกต่อไปแล้ว
  บันทึกการจ่ายเงิน: {
    icon: Send,
    description: 'จัดการรายการค่าใช้จ่ายและติดตามใบกำกับภาษี',
  },
  สมุดรายชื่อ: {
    icon: BookUser,
    description: 'จัดการข้อมูลลูกค้าและผู้จัดจำหน่าย',
  },
  'Bank Reconcile': {
    icon: Landmark,
    description: 'กระทบยอดรายการธนาคารกับรายการบัญชี',
  },
  // เพิ่มพร้อมฟีเจอร์ "จับคู่เอง + บันทึกประวัติ" (2026-07-19) — ไอคอนตัวเดียวกับ NavLeaf ของเมนูนี้ใน
  // lib/navigation.ts (id: 'reconcile-history') ตามกฎเดิมของไฟล์นี้
  ประวัติการกระทบยอด: {
    icon: History,
    description: 'ดูและแก้ไขรายการกระทบยอดที่เคยบันทึกไว้',
  },
  รายงานภาษีซื้อ: {
    icon: FileInput,
    description: 'สรุปภาษีซื้อและใบกำกับภาษีที่ได้รับจากผู้ขาย',
  },
  รายงานภาษีขาย: {
    icon: FileOutput,
    description: 'สรุปภาษีขายและใบกำกับภาษีที่ออกให้ลูกค้า',
  },
  // key เปลี่ยนจาก 'ภาษีซื้อไม่ถึงกำหนด' เป็น 'ภาษีซื้อที่ยังไม่ได้รับ' ตาม label ใหม่ใน
  // lib/navigation.ts (2026-07-16) — ต้องตรงกันเป๊ะเพราะ PAGE_META lookup ใช้ title (=label) ตรงๆ
  ภาษีซื้อที่ยังไม่ได้รับ: {
    icon: FileClock,
    description: 'ติดตามใบกำกับภาษีซื้อที่บันทึกค่าใช้จ่ายแล้วแต่ยังไม่ได้รับเอกสาร',
  },
  ตรวจสอบข้อมูล: {
    icon: SearchCheck,
    description: 'ตรวจสอบความถูกต้องของข้อมูลในระบบ',
  },
};

export default function Header({ title, onMenuClick }: HeaderProps) {
  const { session } = useAuth();
  // เพิ่มเข้ามา 2026-08-07 พร้อมฟีเจอร์รองรับหลายบริษัท — companies/selectedCompany ใช้แสดงชื่อบริษัท
  // ปัจจุบัน + ปุ่ม "สลับบริษัท" (แสดงเฉพาะ user ที่เป็นสมาชิกมากกว่า 1 บริษัทเท่านั้น) clearSelection ใช้
  // ล้างค่าที่จำไว้ตอนออกจากระบบ (ผู้ใช้ยืนยันว่าต้องเลือกใหม่ทุกครั้งที่ล็อกอิน ไม่ใช่จำไว้ข้ามรอบ)
  const { companies, selectedCompany, clearSelection } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const meta = PAGE_META[title];
  const PageIcon = meta?.icon ?? FileText;

  async function handleSignOut() {
    clearSelection();
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function handleSwitchCompany() {
    clearSelection();
    router.replace('/select-company');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card-bg/90 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="shrink-0 rounded-md p-1.5 text-text-sub transition-colors duration-[250ms] hover:bg-primary-light min-[992px]:hidden"
            aria-label="เปิดเมนู"
            data-testid="mobile-menu-button"
          >
            <Menu size={20} />
          </button>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
            <PageIcon size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-text sm:text-2xl">{title}</h1>
            {meta?.description && (
              <p className="truncate text-sm text-text-sub">{meta.description}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* (2026-09-11) แผ่นชื่อบริษัทด้านล่างเดิมใช้ bg-white/8 (ขาวจางๆ ให้เห็นเป็นแผ่นนูนบนพื้นเข้ม) —
              บนแถบหัวสีขาวของธีมชมพูตอนนี้ ขาวบนขาวคือมองไม่เห็นเลย เปลี่ยนเป็นชมพูจางแทน */}
          {selectedCompany && (
            <div className="hidden items-center gap-1.5 rounded-[10px] border border-border bg-primary/6 px-3 py-2 text-sm text-text sm:flex">
              {selectedCompany.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL มาจาก Supabase Storage (โดเมนไม่คงที่ล่วงหน้า) และเป็นไอคอนเล็กมาก ไม่คุ้ม next/image
                <img src={selectedCompany.logo_url} alt="" className="h-[15px] w-[15px] shrink-0 object-contain" aria-hidden="true" />
              ) : (
                <Building2 size={15} className="text-text-sub" aria-hidden="true" />
              )}
              <span className="max-w-[160px] truncate">{selectedCompany.name}</span>
              {companies.length > 1 && (
                <button
                  type="button"
                  onClick={handleSwitchCompany}
                  className="ml-1 text-xs font-medium text-primary hover:underline"
                  data-testid="switch-company-button"
                >
                  สลับบริษัท
                </button>
              )}
            </div>
          )}
          {session?.user?.email && (
            <span className="hidden text-sm text-text-sub sm:inline">{session.user.email}</span>
          )}
          {/* สวิตช์สลับโหมดกลางวัน/กลางคืน (2026-09-11 ตามคำขอผู้ใช้ "เผื่อไว้ใช้ในที่กลางคืนจะได้ถนอมสายตา")
              รอบแรกทำเป็นปุ่มไอคอนสี่เหลี่ยมกดสลับ แต่ผู้ใช้ส่งภาพอ้างอิงมาว่าอยากได้ "ปุ่มเลื่อนซ้ายขวา"
              (toggle switch แบบแคปซูล + ปุ่มกลมเลื่อนไปมา) จึงเปลี่ยนมาเป็นแบบนี้แทน

              ใช้ role="switch" + aria-checked (ไม่ใช่ aria-pressed แบบปุ่มธรรมดา) เพราะนี่คือ "สวิตช์เปิด/ปิด"
              จริงๆ ตามความหมาย — screen reader จะอ่านว่า "เปิด/ปิด" ให้เองถูกต้อง ส่วนคนที่ใช้เมาส์ยังเห็น
              คำอธิบายเต็มจาก title ตอนชี้ค้าง

              วางไว้ก่อนปุ่ม "ออกจากระบบ" เพราะเป็นปุ่มที่กดบ่อยกว่า และไม่ควรอยู่ติดขอบขวาสุดจนกดพลาดเป็น
              ปุ่มออกจากระบบ

              ตัวเลข: รางกว้าง 44px สูง 24px (w-11 h-6) ปุ่มกลม 20px (h-5 w-5) เลื่อนจาก 2px ไป 22px
              (44 − 20 − 2 = 22 พอดี เว้นขอบเท่ากันทั้งสองข้าง) ตั้งใจไม่ใส่ border ที่ราง เพื่อให้คำนวณ
              ระยะเลื่อนตรงไปตรงมาโดยไม่ต้องเผื่อความหนาขอบ

              ไอคอนอยู่ "ในปุ่มกลม" และบอก "สถานะปัจจุบัน" (ไม่ใช่สิ่งที่จะเกิดเมื่อกด) ตามธรรมเนียมของสวิตช์:
              อยู่โหมดกลางคืน = พระจันทร์ / อยู่โหมดกลางวัน = ดวงอาทิตย์ */}
          <button
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            onClick={toggleTheme}
            aria-label="โหมดกลางคืน"
            title={theme === 'dark' ? 'ปิดโหมดกลางคืน (กลับเป็นกลางวัน)' : 'เปิดโหมดกลางคืน'}
            className={`btn-press relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-[250ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              theme === 'dark' ? 'bg-primary' : 'bg-text-sub/40'
            }`}
            data-testid="theme-toggle"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none flex h-5 w-5 items-center justify-center rounded-full bg-card-bg shadow-sm transition-transform duration-[250ms] ${
                theme === 'dark' ? 'translate-x-[22px]' : 'translate-x-[2px]'
              }`}
            >
              {theme === 'dark' ? (
                <Moon size={11} className="text-primary" />
              ) : (
                <Sun size={11} className="text-text-sub" />
              )}
            </span>
          </button>
          {/* ปุ่ม "ออกจากระบบ" — ประวัติ: เคยเป็น bg-white/8 + text-text แล้วผู้ใช้เจอบน production ว่าอ่านแทบ
              ไม่ออกบนธีมเข้ม จึงแก้เป็น bg-black + text-on-primary (2026-07-19)
              (2026-09-11 — ธีมชมพูพาสเทล) ปุ่มดำสนิทบนธีมชมพูอ่อนกลายเป็นก้อนดำสะดุดตาผิดที่ผิดทาง เปลี่ยน
              เป็น bg-primary (โรส) + text-on-primary ได้ contrast 5.76:1 ชัดเจนพอๆ กับปุ่มดำเดิม แต่อยู่ในธีม
              hover เดิมใช้ bg-primary-light ซึ่งตอนนี้เป็นโรสจางมาก ถ้าคงไว้ตัวหนังสือขาวจะหายไปตอนชี้ จึง
              เปลี่ยนเป็น bg-primary-hover (โรสเข้มขึ้น) แทน */}
          <button
            type="button"
            onClick={handleSignOut}
            className="btn-press rounded-[10px] border border-primary bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:border-primary-hover hover:bg-primary-hover"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  );
}
