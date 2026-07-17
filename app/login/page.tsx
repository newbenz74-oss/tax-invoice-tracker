'use client';

import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, Lock, Receipt } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';

type Mode = 'signin' | 'signup';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** subscribe/getSnapshot สำหรับ useSyncExternalStore — วิธีมาตรฐานของ React สำหรับ subscribe ค่าจาก
 * external API อย่าง matchMedia โดยไม่ชน react-hooks/set-state-in-effect (ห้าม setState ตรงๆ ใน
 * effect body เพราะทำให้เกิด cascading render) getServerSnapshot คืนค่า false เสมอเพราะฝั่ง server
 * ไม่มี window ให้เช็ค (ต้อง match กับค่าเริ่มต้นตอน hydrate เพื่อไม่ให้เกิด hydration mismatch) */
function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  // ใหม่: toggle แสดง/ซ่อนรหัสผ่าน — เป็น UI state ล้วนๆ ไม่ถูกใช้ใน handleSubmit หรือ logic
  // การยืนยันตัวตนใดๆ เลย กระทบแค่ attribute "type" ของ <input> เท่านั้น
  const [showPassword, setShowPassword] = useState(false);
  // 2026-07-17: พื้นหลังวิดีโอ (แทนพื้นหลังไล่สีฟ้าเดิม) — ถ้าผู้ใช้ตั้งค่า prefers-reduced-motion ไว้
  // จะไม่ mount <video> เลย (ใช้ภาพนิ่ง poster แทน) ไม่ใช่แค่ซ่อนด้วย CSS เพื่อไม่ให้เบราว์เซอร์เสีย
  // แบนด์วิดท์/แบตโหลดและเล่นวิดีโอที่มองไม่เห็นอยู่ดี ใช้ useSyncExternalStore (ไม่ใช่ useState+useEffect)
  // เพราะเป็นวิธีมาตรฐานของ React สำหรับ subscribe ค่าจาก external API แบบนี้ — getServerSnapshot คืน
  // false เสมอกัน hydration mismatch (server ไม่มี window ให้เช็คค่าจริง)
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );

  useEffect(() => {
    if (!loading && session) {
      router.replace('/dashboard');
    }
  }, [loading, session, router]);

  // ฟังก์ชันเดิมทั้งหมด — ไม่มีการแก้ไข logic แม้แต่บรรทัดเดียว (คง signInWithPassword,
  // signUp, การ validate, การ redirect, และ error handling ไว้ตามเดิมทุกประการ)
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
        router.replace('/dashboard');
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
          router.replace('/dashboard');
        } else {
          setInfoMessage('สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ถ้าทีมเปิดใช้ยืนยันอีเมลไว้)');
          setMode('signin');
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1a5f85] px-4 py-10 sm:py-12">
      {/* พื้นหลังวิดีโอทะเล (ไฟล์ VFX ที่ผู้ใช้เตรียมมา บีบอัดจากต้นฉบับ 2560x1440/56MB เหลือ 1280x720/
          ~9MB ด้วย ffmpeg libx264 CRF 30 + ตัดเสียงทิ้งเพราะเล่นแบบ muted เสมอ) แทนพื้นหลังไล่สีฟ้าเดิม
          — วางเป็น layer แยกด้านหลังสุด (-z-10) เต็มพื้นที่ ก่อนเนื้อหาการ์ด login */}
      <div className="absolute inset-0 -z-10">
        {prefersReducedMotion ? (
          <Image
            src="/videos/login-background-poster.jpg"
            alt=""
            aria-hidden="true"
            fill
            priority
            className="object-cover"
          />
        ) : (
          <video
            autoPlay
            muted
            loop
            playsInline
            poster="/videos/login-background-poster.jpg"
            aria-hidden="true"
            className="h-full w-full object-cover"
          >
            <source src="/videos/login-background.mp4" type="video/mp4" />
          </video>
        )}
        {/* overlay ไล่สีน้ำเงินเข้มทับวิดีโอ เพื่อให้การ์ดขาวตรงกลางและตัวอักษรสีขาวด้านล่างยังคมชัด
            อ่านง่ายเหมือนพื้นหลังไล่สีเดิม ไม่ว่าเฟรมวิดีโอ ณ ขณะนั้นจะสว่าง/มืดแค่ไหน (เข้มขึ้นด้านล่าง
            เพราะมีตัวอักษรขนาดเล็กวางอยู่) */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a3a5c]/50 via-[#0a3a5c]/25 to-[#031f33]/65" />
      </div>

      <div className="w-full max-w-[640px]">
        <div className="rounded-2xl bg-white p-6 shadow-[0_20px_50px_-12px_rgba(15,64,105,0.35)] sm:p-10 md:p-12">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--login-primary-light)]">
              <Receipt className="h-6 w-6 text-[var(--login-primary)]" strokeWidth={2} />
            </div>
            <h1 className="text-2xl font-bold text-[var(--login-primary)]">เว็บติดตามใบกำกับภาษี</h1>
            <p className="mt-1.5 text-sm text-gray-500">BENZ — ระบบสำหรับทีมภายใน</p>
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
                mode === 'signin' ? 'bg-white text-[var(--login-primary)] shadow' : 'text-gray-500'
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
                mode === 'signup' ? 'bg-white text-[var(--login-primary)] shadow' : 'text-gray-500'
              }`}
            >
              สมัครสมาชิก
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                อีเมล
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 w-full rounded-lg border border-[var(--login-border)] px-4 text-base text-gray-800 placeholder:text-gray-400 focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
                รหัสผ่าน
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 w-full rounded-lg border border-[var(--login-border)] px-4 pr-12 text-base text-gray-800 placeholder:text-gray-400 focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                  placeholder="กรอกรหัสผ่าน"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-400 hover:text-gray-600"
                  // หมายเหตุ: ห้ามใช้คำว่า "รหัสผ่าน" เต็มคำใน aria-label ตรงนี้ — Playwright
                  // getByLabel('รหัสผ่าน') ที่ใช้ใน e2e/auth.spec.ts เดิม (ห้ามแก้ไฟล์นั้น) จะจับคู่
                  // แบบ substring จึงชนกับ label ของ input รหัสผ่านเอง ทำให้ selector เจอ 2 element
                  // (strict mode violation) — ใช้ "รหัส" เฉยๆ แทน ความหมายยังชัดเจนในบริบทเดิม
                  aria-label={showPassword ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoMessage('ฟังก์ชันรีเซ็ตรหัสผ่านจะเปิดใช้งานในภายหลัง');
                  }}
                  className="text-sm text-[var(--login-primary)] hover:underline"
                >
                  ลืมรหัสผ่าน?
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" data-testid="auth-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            {infoMessage && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{infoMessage}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-[var(--login-primary)] text-base font-semibold text-white transition-colors hover:bg-[var(--login-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
              {submitting ? 'กำลังดำเนินการ...' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
            </button>
          </form>

          {mode === 'signin' && (
            <p className="mt-5 text-center text-sm text-gray-600">
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
          <p className="text-xs text-white/90">ระบบนี้ใช้สำหรับบุคลากรภายในเท่านั้น</p>
          <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-white/80">
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
