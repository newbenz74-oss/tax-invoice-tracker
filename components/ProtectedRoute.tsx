'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login');
    }
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-page-bg">
        <p className="text-text-sub">กำลังโหลด...</p>
      </div>
    );
  }

  if (!session) return null;

  return <>{children}</>;
}
