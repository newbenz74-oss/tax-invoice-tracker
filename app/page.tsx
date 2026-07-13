'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export default function Home() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/dashboard' : '/login');
  }, [session, loading, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-gray-500">กำลังโหลด...</p>
    </div>
  );
}
