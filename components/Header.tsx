'use client';

import {
  FileClock,
  FileInput,
  FileOutput,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  ScrollText,
  SearchCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';

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
  บันทึกค่าใช้จ่าย: {
    icon: Wallet,
    description: 'จัดการรายการค่าใช้จ่ายและติดตามใบกำกับภาษี',
  },
  รายงานจ่ายเงิน: {
    icon: ScrollText,
    description: 'สรุปประวัติการจ่ายเงินทั้งหมด',
  },
  'Bank Reconcile': {
    icon: Landmark,
    description: 'กระทบยอดรายการธนาคารกับรายการบัญชี',
  },
  รายงานภาษีซื้อ: {
    icon: FileInput,
    description: 'สรุปภาษีซื้อและใบกำกับภาษีที่ได้รับจากผู้ขาย',
  },
  รายงานภาษีขาย: {
    icon: FileOutput,
    description: 'สรุปภาษีขายและใบกำกับภาษีที่ออกให้ลูกค้า',
  },
  ภาษีซื้อไม่ถึงกำหนด: {
    icon: FileClock,
    description: 'รายการภาษีซื้อที่ยังไม่ถึงกำหนดชำระ',
  },
  ตรวจสอบข้อมูล: {
    icon: SearchCheck,
    description: 'ตรวจสอบความถูกต้องของข้อมูลในระบบ',
  },
};

export default function Header({ title, onMenuClick }: HeaderProps) {
  const { session } = useAuth();
  const router = useRouter();
  const meta = PAGE_META[title];
  const PageIcon = meta?.icon ?? FileText;

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
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
          {session?.user?.email && (
            <span className="hidden text-sm text-text-sub sm:inline">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-text hover:border-primary/50 hover:bg-primary-light"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  );
}
