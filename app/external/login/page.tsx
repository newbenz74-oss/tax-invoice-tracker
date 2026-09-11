'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { ensureExternalViewerRegistered } from '@/lib/externalWhtViewerApi';

/**
 * หน้าล็อกอิน/สมัครสมาชิกสำหรับ "บุคคลภายนอก" (เพิ่มเข้ามา 2026-08-15 — ดู
 * supabase/migration_018_external_wht_viewers.sql, lib/externalWhtViewerApi.ts) แยกออกจากหน้า /login เดิม
 * (สำหรับทีมบัญชีภายในเท่านั้น) โดยสิ้นเชิง — คนละ URL คนละหน้าตา คนละปลายทางหลังล็อกอินสำเร็จ
 * (/external/dashboard แทน /select-company) แต่ใช้ auth.signInWithPassword/signUp ของ Supabase ตัวเดียวกัน
 * เหมือนหน้า /login (session เป็น global เดียวกันทั้งแอป ผ่าน lib/AuthContext.tsx — ณ ขณะหนึ่งเบราว์เซอร์
 * ล็อกอินได้แค่บัญชีเดียว ไม่ว่าจะเข้าทางหน้าไหนก็ตาม)
 *
 * ต่างจากหน้า /login ตรงที่หลังล็อกอิน/สมัครสำเร็จ (มี session แล้ว) ต้องเรียก
 * ensureExternalViewerRegistered() เพิ่มอีกขั้นเสมอ เพื่อ "ประกาศตัว" ว่าบัญชีนี้สมัครผ่านช่องทางภายนอก —
 * สำคัญมากเพราะเป็นตัวกันไม่ให้ผู้ใช้ภายนอกไปปนอยู่ในรายชื่อ "รออนุมัติสมาชิกภายใน" (ดูคอมเมนต์หัวไฟล์
 * migration ด้านบน) เรียกทุกครั้งที่ล็อกอินสำเร็จ (ทั้งโหมด signin และ signup ที่มี session ทันที) ไม่ใช่แค่
 * ตอนสมัครใหม่ครั้งแรก เพราะ idempotent อยู่แล้ว (upsert + ignoreDuplicates)
 */
type Mode = 'signin' | 'signup';

export default function ExternalLoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) {
      router.replace('/external/dashboard');
    }
  }, [loading, session, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!email.trim() || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }

    setSubmitting(true);
    const supabase = getSupabaseClient();

    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          setError(translateAuthError(signInError.message));
          return;
        }
        await afterAuthSuccess();
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          setError(translateAuthError(signUpError.message));
          return;
        }
        if (data.session) {
          await afterAuthSuccess();
        } else {
          setInfoMessage('สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ถ้าทีมเปิดใช้ยืนยันอีเมลไว้)');
          setMode('signin');
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function afterAuthSuccess() {
    try {
      await ensureExternalViewerRegistered();
    } catch (err) {
      // ไม่บล็อกการเข้าสู่ระบบถ้าขั้นตอนนี้ล้มเหลว (เช่นเน็ตหลุดจังหวะนี้พอดี) — หน้า dashboard จะลองเรียก
      // ซ้ำเองอีกทีตอนโหลด เพราะเรียกซ้ำได้ปลอดภัยเสมอ (idempotent) ไม่ต้องการให้ผู้ใช้ติดอยู่หน้านี้เฉยๆ
      console.error('ensureExternalViewerRegistered failed', err);
    }
    router.replace('/external/dashboard');
  }

  const busy = submitting;

  return (
    // (2026-09-11 — ธีมชมพูพาสเทล) เดิมพื้นหลังเป็นน้ำเงินเข้ม #0f2f42 (จอ login ของบุคคลภายนอก ไม่มีวิดีโอ
    // พื้นหลังแบบหน้า login ภายใน) เปลี่ยนเป็นชมพูอ่อนของพาเลตใหม่ — ตัวหนังสือเล็กๆ ใต้การ์ดที่เคยเป็นสีขาว
    // จึงต้องเปลี่ยนเป็นโทนเข้มคู่กันด้วย (ดูท้ายไฟล์)
    <div className="auth-gradient-bg flex min-h-screen flex-1 items-center justify-center px-4 py-10 sm:py-12">
      <div className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-border bg-card-bg p-6 shadow-[0_20px_50px_-12px_rgba(92,31,56,0.28)] sm:p-8 md:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--login-primary-light)]">
              <ShieldCheck className="h-6 w-6 text-[var(--login-primary)]" strokeWidth={2} />
            </div>
            <h1 className="text-2xl font-bold text-[var(--login-primary)]">ใบหัก ณ ที่จ่าย</h1>
            <p className="mt-1.5 text-sm text-text-sub">สำหรับบุคคลภายนอก</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setInfoMessage(null);
              }}
              className={`rounded-md py-2.5 transition-colors ${
                mode === 'signin' ? 'bg-card-bg text-[var(--login-primary)] shadow' : 'text-text-sub'
              }`}
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
                setInfoMessage(null);
              }}
              className={`rounded-md py-2.5 transition-colors ${
                mode === 'signup' ? 'bg-card-bg text-[var(--login-primary)] shadow' : 'text-text-sub'
              }`}
            >
              สมัครสมาชิก
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text">
                อีเมล
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 w-full rounded-lg border border-[var(--login-border)] bg-input px-4 text-base text-text placeholder:text-text-sub focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text">
                รหัสผ่าน
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 w-full rounded-lg border border-[var(--login-border)] bg-input px-4 pr-12 text-base text-text placeholder:text-text-sub focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                  placeholder="กรอกรหัสผ่าน"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-sub hover:text-primary"
                  aria-label={showPassword ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" data-testid="external-auth-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            {infoMessage && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{infoMessage}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-[var(--login-primary)] text-base font-semibold text-on-primary transition-colors hover:bg-[var(--login-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy ? 'กำลังดำเนินการ...' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
            </button>
          </form>

          {mode === 'signin' && (
            <p className="mt-5 text-center text-sm text-text-sub">
              ยังไม่มีบัญชีกับเรา?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                  setInfoMessage(null);
                }}
                className="font-medium text-[var(--login-primary)] hover:underline"
              >
                สมัครใช้งาน
              </button>
            </p>
          )}
        </div>

        <div className="mt-6 text-center">
          {/* (2026-09-11) ตัวหนังสือสองบรรทัดนี้วางตรงบนพื้นหลังของหน้า (ไม่มีการ์ดรองรับ) เดิมเป็นสีขาว
              เพราะพื้นหลังเป็นน้ำเงินเข้ม — ตอนนี้พื้นหลังเป็นชมพูอ่อนแล้ว ต้องสลับเป็นโทนเข้ม */}
          <p className="text-xs text-text">สมัครแล้วต้องรอผู้ดูแลระบบอนุมัติสิทธิ์ก่อนจึงจะเห็นข้อมูลได้</p>
          <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-text-sub">
            <Lock className="h-3 w-3" />
            ข้อมูลของคุณได้รับการปกป้องอย่างปลอดภัย
          </p>
        </div>
      </div>
    </div>
  );
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('user already registered')) return 'อีเมลนี้สมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบ';
  if (m.includes('email not confirmed')) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';
  if (m.includes('password') && m.includes('least')) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  return message;
}
