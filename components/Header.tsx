'use client';

import { Menu } from 'lucide-react';
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
export default function Header({ title, onMenuClick }: HeaderProps) {
  const { session } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 min-[992px]:hidden"
            aria-label="เปิดเมนู"
            data-testid="mobile-menu-button"
          >
            <Menu size={20} />
          </button>
          <h1 className="truncate text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {session?.user?.email && (
            <span className="hidden text-sm text-gray-500 sm:inline">{session.user.email}</span>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  );
}
