'use client';

import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, Lock, Receipt } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import LoginBackgroundVideoCarousel from '@/components/LoginBackgroundVideoCarousel';

type Mode = 'signin' | 'signup';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
// ระยะเวลาเอฟเฟกต์ตอนเข้าสู่ระบบสำเร็จ (การ์ดย่อ+จาง / พื้นหลังเบลอ / light sweep) ก่อนนำทางไป /dashboard
// จริง (2026-07-18) — ยาวกว่า duration ที่ประกาศไว้ใน .login-card-exiting/.login-bg-normal/
// .login-light-sweep ใน globals.css (500-600ms) เล็กน้อยโดยตั้งใจ เผื่อเวลาให้ทุกเอฟเฟกต์เล่นจบสนิทก่อน
// เปลี่ยนหน้าจริง ไม่ตัดกลางอนิเมชัน (ไม่จำเป็นต้องเท่ากันเป๊ะ แค่ต้อง >= อันที่นานที่สุด)
const EXIT_TRANSITION_MS = 700;

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
  // ใหม่ (2026-07-18): true ตั้งแต่วินาทีที่เข้าสู่ระบบสำเร็จ จนกว่าจะนำทางไปหน้า Dashboard จริง — คุม
  // เอฟเฟกต์การ์ดย่อ+จาง/พื้นหลังเบลอ/light sweep (ดู enterDashboard ด้านล่าง) ตั้งใจไม่ reset กลับ false
  // เพราะหน้านี้จะถูกแทนที่ด้วยหน้า Dashboard ไปเลยหลัง router.replace — ไม่มีจังหวะไหนที่ต้องใช้ค่า false
  // อีกหลังจากนี้ในอายุของ component instance นี้
  const [exiting, setExiting] = useState(false);
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

  // ฟังก์ชันเดิมเกือบทั้งหมด — ไม่มีการแก้ไข logic การยืนยันตัวตนแม้แต่บรรทัดเดียว (คง
  // signInWithPassword, signUp, การ validate, และ error handling ไว้ตามเดิมทุกประการ) จุดเดียวที่เปลี่ยน
  // (2026-07-18) คือตอนสำเร็จ: เดิมเรียก router.replace('/dashboard') ตรงๆ ตอนนี้เรียก enterDashboard()
  // แทน (ดูด้านล่าง) เพื่อเล่นเอฟเฟกต์ก่อนค่อยนำทางจริง — เส้นทาง error ทั้งหมดยังคง return ทันทีเหมือนเดิม
  // ไม่แตะ exiting เลย จึงไม่มีทางเข้าเอฟเฟกต์นี้ได้ถ้าเข้าสู่ระบบไม่สำเร็จ
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
        enterDashboard();
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
          enterDashboard();
        } else {
          setInfoMessage('สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ถ้าทีมเปิดใช้ยืนยันอีเมลไว้)');
          setMode('signin');
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ใหม่ (2026-07-18): เริ่มลำดับเอฟเฟกต์ "เข้าสู่ระบบสำเร็จ" (การ์ดย่อ+จาง, พื้นหลังเบลอเล็กน้อย, light
  // sweep สีฟ้าพาดจอ 1 ครั้ง — ดู JSX + globals.css) แล้วค่อยนำทางไป /dashboard จริงหลังเล่นจบ ตั้ง
  // exiting=true ไว้ก่อนเสมอ (ควบคุมสถานะปุ่ม disabled/ข้อความ "กำลังเข้าสู่ระบบ..." ให้ยังติดอยู่แม้
  // finally ของ handleSubmit จะ setSubmitting(false) ไปแล้วก็ตาม) ถ้าผู้ใช้เปิด prefers-reduced-motion
  // ไว้ ข้าม setTimeout แล้วนำทางทันที (ลด/ปิด animation ตามสเปก ไม่ใช่แค่ทำให้สั้นลง)
  function enterDashboard() {
    setExiting(true);
    if (prefersReducedMotion) {
      router.replace('/dashboard');
      return;
    }
    window.setTimeout(() => {
      router.replace('/dashboard');
    }, EXIT_TRANSITION_MS);
  }

  // ปุ่ม submit "ยุ่ง" (disabled + แสดง spinner/ข้อความกำลังโหลด) ตลอดตั้งแต่กด submit จนกว่าจะนำทางไป
  // Dashboard จริง ไม่ใช่แค่ระหว่าง await signInWithPassword/signUp เท่านั้น — ป้องกันผู้ใช้กดซ้ำระหว่าง
  // เล่นเอฟเฟกต์เข้าสู่ระบบสำเร็จด้วย (2026-07-18) ข้อความระหว่างนี้ให้เป็น "กำลังเข้าสู่ระบบ..." เสมอไม่ว่า
  // จะมาจากโหมด signin หรือกำลัง exiting อยู่ (นับเป็นการเข้าสู่ระบบสำเร็จแล้วทั้งคู่) ส่วนโหมด signup ที่
  // ยัง submitting อยู่ (ยังไม่ทราบผล) คงข้อความเดิม "กำลังดำเนินการ..." ไว้ตามเดิมทุกประการ
  const busy = submitting || exiting;
  const busyLabel = mode === 'signin' || exiting ? 'กำลังเข้าสู่ระบบ...' : 'กำลังดำเนินการ...';

  return (
    // การ์ด login บังพื้นหลังวิดีโอเยอะเกินไป (2026-07-18 ต่อ) — ผู้ใช้ขอ 3 อย่างพร้อมกัน: (1) ย่อการ์ด
    // ให้เล็กลง (2) ทำการ์ดโปร่งแสง+เบลอด้านหลัง (3) ย้ายการ์ดไปด้านขวา ให้เห็นพื้นหลังฝั่งซ้ายเต็มๆ — ข้อ
    // (3) ทำผ่าน justify-end บน md ขึ้นไปเท่านั้น (จอมือถือยังคง justify-center เหมือนเดิม เพราะจอแคบเกินกว่า
    // จะ "เห็นพื้นหลังฝั่งซ้าย" ได้จริง การย้ายไปขวาบนจอเล็กจะดูเหมือนการ์ดหลุดขอบมากกว่า) เพิ่ม padding-right
    // ให้การ์ดไม่ชิดขอบจอเกินไปบนจอกว้าง
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1a5f85] px-4 py-10 sm:py-12 md:justify-end md:pr-16 lg:pr-24">
      {/* พื้นหลังวิดีโอหน้า login แบบสลับ 4 คลิปวนลูป (อัปเดตชุดวิดีโอ 2026-07-18 — เปลี่ยนจากชุดเดิม
          5 คลิปธีมทะเล/ฉลาม/โลมา เป็นชุดใหม่ที่ผู้ใช้ระบุเอง 4 คลิป วนลูปคลิป 1→2→3→4 แล้วกลับไปคลิปแรก
          เล่นแบบ crossfade ไม่กระพริบระหว่างเปลี่ยนคลิป — ดู logic เต็มที่
          components/LoginBackgroundVideoCarousel.tsx แทนพื้นหลังไล่สีฟ้าเดิม วางเป็น layer แยกด้านหลังสุด
          เต็มพื้นที่ ก่อนเนื้อหาการ์ด login
          หมายเหตุ: ตั้งใจไม่ใช้ z-index ติดลบ (-z-10) กับ layer นี้ — พบว่า Chrome บางเครื่องมีปัญหาจริง
          ไม่ paint <video> element เลยเมื่ออยู่ใน stacking context ที่ z-index ติดลบ (วิดีโอเล่นอยู่จริงใน
          DOM ตรวจสอบผ่าน readyState/currentTime ได้ปกติ แต่จอไม่แสดงผลอะไรเลย) แก้โดยให้ layer นี้อยู่ z-0
          (ปกติ ไม่ติดลบ) แล้วให้การ์ด login ด้านล่างเป็น `relative z-10` แทน — อาศัยลำดับ z-index บวกตามปกติ
          ให้การ์ดวาดทับพื้นหลังแทนการใช้ z-index ติดลบกับพื้นหลัง ผลลัพธ์การจัดวางเหมือนเดิมทุกประการ แต่
          หลีกเลี่ยงบั๊กนี้ได้ */}
      {/* เบลอเล็กน้อย (2026-07-18) ตอนเข้าสู่ระบบสำเร็จ — ครอบทั้งวิดีโอ/ภาพ poster และ overlay ไล่สีด้วย
          ใช้ transition ธรรมดา (.login-bg-normal/.login-bg-exiting ใน globals.css) สลับด้วย state
          `exiting` จาก enterDashboard() ด้านบน ไม่กระทบ logic การเล่นวิดีโอใดๆ ใน
          LoginBackgroundVideoCarousel เลย (component นั้นไม่รู้จัก state นี้ด้วยซ้ำ) */}
      <div className={`absolute inset-0 z-0 ${exiting ? 'login-bg-exiting' : 'login-bg-normal'}`}>
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
          <LoginBackgroundVideoCarousel />
        )}
        {/* overlay ไล่สีน้ำเงินเข้มทับวิดีโอ เพื่อให้การ์ดขาวตรงกลางและตัวอักษรสีขาวด้านล่างยังคมชัด
            อ่านง่ายเหมือนพื้นหลังไล่สีเดิม ไม่ว่าเฟรมวิดีโอ ณ ขณะนั้นจะสว่าง/มืดแค่ไหน (เข้มขึ้นด้านล่าง
            เพราะมีตัวอักษรขนาดเล็กวางอยู่) */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a3a5c]/50 via-[#0a3a5c]/25 to-[#031f33]/65" />
      </div>

      {/* Light Sweep (2026-07-18): แถบแสงฟ้าพาดจอครั้งเดียวตอนเข้าสู่ระบบสำเร็จ — mount เฉพาะตอน
          exiting=true และไม่เปิด reduced-motion ไว้เท่านั้น (ปิดเอฟเฟกต์นี้ไปเลยแทนที่จะพึ่ง CSS override
          อย่างเดียว เพราะข้าม setTimeout ไปนำทางทันทีอยู่แล้วใน enterDashboard เมื่อ reduced-motion เปิด
          จึงไม่มีเวลาให้เอฟเฟกต์นี้เล่นจบพอดี ไม่ mount เลยสะอาดกว่า) data-testid ไว้ให้เทสต์ตรวจสอบว่า
          ไม่ปรากฏเมื่อ reduced-motion เปิดได้ */}
      {exiting && !prefersReducedMotion && (
        <div className="login-light-sweep" aria-hidden="true" data-testid="login-light-sweep" />
      )}

      <div
        // ย่อจาก max-w-[640px] เดิมเหลือ 420px (2026-07-18 ต่อ) — การ์ดกว้างสุดของฟอร์ม login ทั่วไปมักอยู่
        // แถว 380-480px อยู่แล้ว 640px เดิมกว้างเกินความจำเป็นของฟอร์มแค่ 2 ช่อง จึงบังพื้นหลังมากเกินไปโดย
        // ไม่ได้ประโยชน์ด้าน UX เพิ่มขึ้นเลย
        className={`relative z-10 w-full max-w-[420px] ${exiting ? 'login-card-exiting' : 'login-card-normal'}`}
      >
        {/* การ์ดกระจกโปร่งแสง (2026-07-18 ต่อ) — เดิม bg-white ทึบล้วน เปลี่ยนเป็น bg-white/85 +
            backdrop-blur-xl ให้เห็นวิดีโอ/ภาพพื้นหลังเลือนๆ ผ่านการ์ด แทนที่จะบังไว้ทึบๆ ทั้งแผ่น — เลือก 85%
            ไม่ใช่ค่าต่ำกว่านี้ เพราะต้องคง contrast ของตัวหนังสือ text-gray-800/700/500 เดิมในฟอร์มให้ยังอ่าน
            ง่ายชัดเจนแม้พื้นหลังจะเป็นวิดีโอสีสันจัดจ้านแค่ไหนก็ตาม (คำนวณแล้ว: เบลอ 85% ขาวทับพื้นหลังโทน
            กลางๆ ให้ผลลัพธ์ยังใกล้ขาวมาก contrast ratio ยังเกิน 12:1 อยู่) เพิ่ม border สีขาวโปร่งแสงบางๆ
            (border-white/40) ช่วยขีดขอบการ์ดให้ชัดขึ้น เพราะไม่มีขอบทึบตัดกับพื้นหลังแบบการ์ดขาวล้วนเดิมแล้ว
            — ไม่แตะ globals.css เลยจุดนี้ (ใช้ Tailwind utility ล้วนๆ ในไฟล์นี้) เพราะ globals.css ตอนนี้มี
            งานธีมมืดที่ยังพักไว้ (ไม่ได้ apply เข้าเครื่องผู้ใช้) ปะปนอยู่ ไม่อยากให้งานสองชิ้นที่ไม่เกี่ยวกัน
            ไปปนกันในไฟล์เดียว */}
        <div className="rounded-2xl border border-white/40 bg-white/85 p-6 shadow-[0_20px_50px_-12px_rgba(15,64,105,0.35)] backdrop-blur-xl sm:p-8 md:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--login-primary-light)]">
              <Receipt className="h-6 w-6 text-[var(--login-primary)]" strokeWidth={2} />
            </div>
            <h1 className="text-2xl font-bold text-[var(--login-primary)]">ACC Reconcile</h1>
            <p className="mt-1.5 text-sm text-gray-500">ระบบสำหรับทีมภายใน</p>
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
              disabled={busy}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-[var(--login-primary)] text-base font-semibold text-white transition-colors hover:bg-[var(--login-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy ? busyLabel : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
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
