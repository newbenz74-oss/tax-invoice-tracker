'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';

export default function Navbar() {
  const { session } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ใบกำกับภาษี</h1>
          <p className="text-xs text-gray-400">BENZ</p>
        </div>
        <div className="flex items-center gap-3">
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
