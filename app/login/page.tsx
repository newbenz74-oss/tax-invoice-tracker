'use client';

import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  ArrowRight,
  Calculator,
  Eye,
  EyeOff,
  FileInput,
  FileText,
  Loader2,
  Lock,
  Mail,
  Send,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSupabaseClient } from '@/lib/supabaseClient';

type Mode = 'signin' | 'signup';

/**
 * ฟีเจอร์หลักที่โชว์บนแผงซ้ายของหน้า login (2026-09-22)
 *
 * ชื่อและไอคอนล้อกับเมนูจริงใน lib/navigation.ts โดยตั้งใจ — คนที่เพิ่งได้รับสิทธิ์เข้าใช้จะได้เห็นตั้งแต่
 * ก่อนล็อกอินว่าข้างในทำอะไรได้บ้าง และพอเข้าไปแล้วก็เจอชื่อเดียวกันในแถบเมนู ไม่ต้องมานั่งแปลชื่ออีกรอบ
 *
 * ประกาศไว้นอก component เพราะเป็นค่าคงที่ ไม่ต้องสร้างใหม่ทุกครั้งที่ re-render
 */
const LOGIN_FEATURES = [
  { icon: Send, label: 'บันทึกจ่ายเงิน' },
  { icon: ArrowLeftRight, label: 'กระทบยอด' },
  { icon: FileInput, label: 'รายงานภาษีซื้อ' },
  { icon: FileText, label: 'ใบหัก ณ ที่จ่าย' },
] as const;

/** คีย์ localStorage ที่ใช้จำอีเมลของผู้ใช้ไว้ในเครื่อง — ตั้งชื่อขึ้นต้น benz_ เหมือนคีย์อื่นทั้งระบบ
 *  (benz_theme, benz_sidebar_expanded) จะได้มองออกทันทีว่าเป็นของเว็บนี้เวลาเปิดดู DevTools */
const REMEMBERED_EMAIL_KEY = 'benz_login_email';

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
  /* "ให้จำฉันไว้ในเครื่องนี้" (2026-09-22 ตามภาพตัวอย่างที่ผู้ใช้ส่งมา)
   *
   * จำเฉพาะ "อีเมล" เท่านั้น ไม่เคยเก็บรหัสผ่านลง localStorage ไม่ว่ากรณีใด — การจำรหัสผ่านไว้ในเครื่อง
   * เป็นหน้าที่ของ password manager ของเบราว์เซอร์ ซึ่งเข้ารหัสและผูกกับบัญชีเครื่องอยู่แล้ว ต่างจาก
   * localStorage ที่สคริปต์ใดๆ บนโดเมนนี้อ่านได้หมดเป็นข้อความเปล่า
   *
   * ค่าเริ่มต้นเป็น true ตามภาพตัวอย่าง (ติ๊กไว้ให้) — เป็นระบบภายในองค์กรที่คนใช้เครื่องตัวเองเป็นหลัก
   * ถ้าใครไม่ต้องการก็ติ๊กออกได้ แล้วอีเมลที่เคยจำไว้จะถูกลบทิ้งทันทีตอนกดเข้าสู่ระบบครั้งถัดไป
   */
  const [rememberMe, setRememberMe] = useState(true);
  // ผู้ใช้ตั้งค่าเครื่องให้ลดการเคลื่อนไหวไว้หรือไม่ — ใช้ 2 จุด: (1) ข้ามการรอเอฟเฟกต์ตอนล็อกอินสำเร็จ
  // แล้วนำทางทันที (2) ไม่ mount แถบแสงพาดจอเลย ใช้ useSyncExternalStore (ไม่ใช่ useState+useEffect)
  // เพราะเป็นวิธีมาตรฐานของ React สำหรับ subscribe ค่าจาก external API แบบนี้ — getServerSnapshot คืน
  // false เสมอกัน hydration mismatch (server ไม่มี window ให้เช็คค่าจริง)
  //
  // เดิมค่านี้ยังใช้เลือกระหว่าง <video> กับภาพนิ่ง poster ด้วย — ตัดออกแล้วตั้งแต่เปลี่ยนพื้นหลังเป็น
  // ลายคลื่น SVG (2026-09-22) ซึ่งเป็นภาพนิ่งอยู่แล้ว ไม่มีอะไรต้องเลือก
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );

  useEffect(() => {
    if (!loading && session) {
      router.replace('/select-company');
    }
  }, [loading, session, router]);

  // เติมอีเมลที่เคยจำไว้ให้อัตโนมัติตอนเปิดหน้า — อ่าน localStorage ใน effect เท่านั้น (ห้ามอ่านตอน
  // initial state) เพราะ component นี้ถูก render ฝั่งเซิร์ฟเวอร์ก่อน ซึ่งไม่มี localStorage จะทำให้ HTML
  // ที่เซิร์ฟเวอร์ส่งมากับที่ client render รอบแรกไม่ตรงกัน (hydration mismatch) — แพทเทิร์นเดียวกับ
  // lib/ThemeContext.tsx และห่อ setState ด้วย Promise.resolve().then() ตามกฎ react-hooks ของโปรเจกต์
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    } catch {
      // อ่าน localStorage ไม่ได้ (โหมดส่วนตัว/บล็อก site data) — ปล่อยช่องอีเมลว่างไว้ตามปกติ
    }
    if (!saved) return;
    Promise.resolve().then(() => setEmail(saved));
  }, []);

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

    // จำ/ลืมอีเมลตามที่ผู้ใช้ติ๊กไว้ — ทำก่อนยิงคำขอ เพราะเป็นความตั้งใจของผู้ใช้เกี่ยวกับ "เครื่องนี้"
    // ไม่ได้ขึ้นกับว่าอีเมล/รหัสผ่านจะถูกต้องหรือไม่ (ถ้าพิมพ์อีเมลผิดแล้วล็อกอินไม่ผ่าน การจำอีเมลที่เพิ่ง
    // พิมพ์ไว้ก็ยังช่วยให้เขาแก้ต่อได้ง่ายกว่าต้องพิมพ์ใหม่ทั้งหมด)
    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
    } catch {
      // เขียน localStorage ไม่ได้ก็ใช้งานต่อได้ปกติ แค่จะไม่ถูกจำไว้รอบหน้า ไม่ต้องรบกวนผู้ใช้ด้วย error
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
  // เปลี่ยนปลายทางจาก '/dashboard' ตรงๆ เป็น '/select-company' (2026-08-07 พร้อมฟีเจอร์รองรับหลายบริษัท) —
  // หน้าเลือกบริษัทเป็นผู้ตัดสินใจเองว่าจะข้ามไป /dashboard ทันที (ถ้ามีบริษัทเดียว) หรือต้องให้เลือกก่อน
  // (ถ้ามีมากกว่า 1 บริษัท) ไม่ต้องรู้ตรรกะนี้ตรงนี้เลย
  function enterDashboard() {
    setExiting(true);
    if (prefersReducedMotion) {
      router.replace('/select-company');
      return;
    }
    window.setTimeout(() => {
      router.replace('/select-company');
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
    // การ์ด login บังพื้นหลังวิดีโอเยอะเกินไป (2026-07-18 ต่อ) — ลองย่อการ์ด+ทำโปร่งแสง+ย้ายไปขวา+เติม
    // โลโก้/tagline ฝั่งซ้ายที่ว่างไปก่อนหน้านี้ แต่ผู้ใช้ดูแล้วขอย้อนกลับส่วนตำแหน่ง: "ย้ายกลับมาไว้ตรงกลาง
    // เหมือนเดิมดีกว่า และทำให้โปร่งใสมากขึ้นอีกหน่อย" พร้อมยืนยันว่าไม่ต้องเติมโลโก้/ชื่อระบบฝั่งซ้ายแล้ว —
    // จึงตัด justify-end/padding-right และบล็อก branding ฝั่งซ้ายออกทั้งหมด กลับไปใช้ justify-center เดิม
    // (คงไว้แค่ 2 อย่างจากรอบก่อน: ขนาดการ์ดที่เล็กลงเหลือ 420px และความโปร่งแสง — ปรับให้โปร่งใสขึ้นอีกที่
    // การ์ดด้านล่าง)
    // สีพื้นสำรองใต้ลายคลื่น (เห็นชั่ววินาทีตอนไฟล์ SVG ยังโหลดไม่เสร็จ) — ใช้ token --page-bg ตัวเดียวกับ
    // ทั้งระบบ ซึ่งเป็นชมพูอ่อนมากในตระกูลเดียวกับแถบแรกของลายคลื่นพอดี จึงไม่เห็นสีกระพริบตอนโหลด
    // (2026-09-22 เปลี่ยนจากเทาเข้ม #22201f ที่เคยตั้งไว้ให้เข้ากับวิดีโอ)
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-page-bg px-4 py-10 sm:py-12">
      {/* พื้นหลังลายคลื่นชมพู — ชุดเดียวกับ Dashboard (2026-09-22 ตามคำขอผู้ใช้ "ไม่เอาวิดีโอนี้แล้ว")
          แทนวิดีโอ 4 คลิปวนลูปของเดิม ที่ต้องดาวน์โหลดคลิปทุกครั้งที่เปิดหน้า และเป็นต้นเหตุของปัญหาสีเพี้ยน
          ที่ตามแก้กันหลายรอบ (แผ่นกรองแสงย้อมสีทั้งคลิป) — ตอนนี้จอแรกที่ผู้ใช้เห็นเป็นลายเดียวกับหลังบ้าน
          ทั้งระบบจึงดูเป็นชุดเดียวกันตั้งแต่ก่อนล็อกอิน

          ไม่มี overlay กดความสว่างทับอีกต่อไป — ของเดิมจำเป็นเพราะเฟรมวิดีโอสว่าง/มืดไม่แน่นอน ตัวหนังสือขาว
          จึงต้องมีฉากหลังเข้มค้ำไว้ ส่วนลายคลื่นเป็นภาพนิ่งสีอ่อนคงที่ คุมความอ่านง่ายได้ที่ตัวสีตัวหนังสือ
          ตรงๆ (เปลี่ยนข้อความใต้การ์ดจากขาวเป็นโทนพลัมแล้ว) ซึ่งตรงไปตรงมากว่า

          ชั้นนอกยังคง .login-bg-normal/.login-bg-exiting ไว้เหมือนเดิม เพื่อให้เอฟเฟกต์เบลอตอนล็อกอินสำเร็จ
          ทำงานต่อได้ครบ ไม่ต้องแก้ enterDashboard() เลย */}
      <div className={`absolute inset-0 z-0 ${exiting ? 'login-bg-exiting' : 'login-bg-normal'}`}>
        <div className="login-wave-bg absolute inset-0" aria-hidden="true" />
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
        // โครงสองฝั่ง (2026-09-22 ตามภาพตัวอย่างที่ผู้ใช้ส่งมา) — ซ้ายเป็นแผงแบรนด์+ฟีเจอร์ ขวาเป็นการ์ดฟอร์ม
        //
        // ความกว้างสูงสุดต่างกันตามขนาดจอโดยตั้งใจ ไม่ใช่ค่าเดียวตลอด: ต่ำกว่า lg จะเหลือคอลัมน์เดียว
        // (แผงซ้ายซ่อน) จึงคุมที่ 420px เท่าของเดิม — จำเป็นเพราะ .zoom-125 ขยายกล่องนี้ 1.25 เท่า "หลัง"
        // คำนวณความกว้างแล้ว ถ้าปล่อยให้กว้าง 1040px ตั้งแต่จอเล็ก ผลลัพธ์จริงจะกลายเป็น 1300px แล้วล้นจอ
        // ทันที (420 × 1.25 = 525px ซึ่งยังพอดีจอมือถือที่แคบที่สุด)
        //
        // .zoom-125 (2026-09-12 ตามคำขอผู้ใช้) — ขยายเนื้อหาขึ้นอีก 25% จากค่าพื้นฐานของทั้งเว็บ
        // (html { zoom: 70% } → เห็นจริง 87.5%) ใส่ไว้ที่ชั้นนี้ชั้นเดียวโดยตั้งใจ เพราะเป็นชั้นที่ครอบ
        // "เนื้อหาที่คนอ่าน" พอดี ไม่คลุมลายคลื่นพื้นหลัง/light sweep ซึ่งเป็น absolute inset-0 คลุมเต็มจอ
        // — ถ้าไปขยายพวกนั้นด้วย ขอบภาพจะล้นออกนอกจอ (ดูคำอธิบายคลาสนี้เต็มๆ ที่ app/globals.css)
        className={`zoom-125 relative z-10 w-full max-w-[420px] lg:max-w-[1040px] ${
          exiting ? 'login-card-exiting' : 'login-card-normal'
        }`}
      >
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_420px] lg:gap-16">
        {/* การ์ดกระจกโปร่งแสง (2026-07-18 ต่อ) — เดิม bg-white ทึบล้วน เปลี่ยนเป็นโปร่งแสง + backdrop-blur-xl
            ให้เห็นวิดีโอ/ภาพพื้นหลังลอดผ่านการ์ด แทนที่จะบังไว้ทึบๆ ทั้งแผ่น เริ่มต้นที่ 85% ก่อน แล้วผู้ใช้ขอ
            ให้ "โปร่งใสมากขึ้นอีกหน่อย" จึงลดลงเหลือ bg-white/65 (โปร่งแสงเห็นพื้นหลังชัดขึ้นกว่าเดิมชัดเจน)
            ยังคง backdrop-blur-xl ไว้เท่าเดิมเพื่อไม่ให้ลวดลายวิดีโอที่ลอดผ่านเข้มจนตัวหนังสือในฟอร์มอ่านยาก —
            ตรวจสอบ contrast ซ้ำแล้วหลังลดเหลือ 65% (ดูหัวข้อ "ตรวจสอบด้วยสายตา" ในเอกสารท้ายไฟล์นี้) เพิ่ม
            border สีขาวโปร่งแสงบางๆ (border-white/40) ช่วยขีดขอบการ์ดให้ชัดขึ้น เพราะไม่มีขอบทึบตัดกับพื้นหลัง
            แบบการ์ดขาวล้วนเดิมแล้ว — ไม่แตะ globals.css เลยจุดนี้ (ใช้ Tailwind utility ล้วนๆ ในไฟล์นี้) เพราะ
            globals.css ตอนนี้มีงานธีมมืดที่ยังพักไว้ (ไม่ได้ apply เข้าเครื่องผู้ใช้) ปะปนอยู่ ไม่อยากให้งาน
            สองชิ้นที่ไม่เกี่ยวกันไปปนกันในไฟล์เดียว */}
        {/* ---- ฝั่งซ้าย: แผงแบรนด์ + ฟีเจอร์ (2026-09-22) ----
            ซ่อนต่ำกว่า lg โดยตั้งใจ — จอมือถือเหลือแค่การ์ดฟอร์มเหมือนเดิมทุกประการ (ชื่อระบบย้ายไปแสดง
            เป็นบรรทัดเล็กๆ ในการ์ดแทน ดู lg:hidden ด้านล่าง) เพราะถ้าดันแผงนี้ลงมาต่อกันบนจอแคบ ผู้ใช้จะ
            ต้องเลื่อนผ่านแบรนด์ยาวๆ กว่าจะถึงช่องกรอก ซึ่งขัดกับงานเดียวที่เขามาทำบนหน้านี้ */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-[0_10px_30px_-8px_rgba(176,58,103,0.5)]">
              <Calculator className="h-8 w-8 text-on-primary" strokeWidth={2} />
            </div>
            <div>
              {/* แยกสีสองคำตามภาพตัวอย่าง — คำแรกเป็นสีตัวหนังสือหลัก คำหลังเป็นสีแบรนด์ ทำให้ชื่อระบบ
                  มีจังหวะสายตาโดยไม่ต้องใช้กราฟิกเพิ่ม */}
              <h1 className="text-4xl font-extrabold tracking-tight text-text">
                ACC <span className="text-primary">Reconcile</span>
              </h1>
              <p className="mt-1 text-sm font-medium tracking-[0.2em] text-text-sub">
                ระบบบัญชีและกระทบยอด
              </p>
            </div>
          </div>

          {/* 4 ฟีเจอร์หลักของระบบ — ไม่ใช่ของประดับ แต่บอกคนที่เพิ่งได้รับสิทธิ์เข้าใช้ว่าข้างในทำอะไรได้บ้าง
              ชื่อและไอคอนตรงกับเมนูจริงใน lib/navigation.ts ทุกตัว จะได้ไม่เจอชื่อที่ไม่มีอยู่จริงหลังล็อกอิน */}
          <div className="mt-12 grid max-w-md grid-cols-4 gap-4">
            {LOGIN_FEATURES.map((feature) => (
              <div key={feature.label} className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card-bg/70 shadow-[0_8px_24px_-12px_rgba(176,58,103,0.45)] backdrop-blur-sm">
                  <feature.icon className="h-7 w-7 text-primary" strokeWidth={1.8} />
                </div>
                <p className="mt-3 text-xs font-semibold text-text">{feature.label}</p>
              </div>
            ))}
          </div>

          <p className="mt-12 flex items-center gap-3 text-sm text-text">
            <span className="font-semibold">ACC Reconcile</span>
            {/* ใช้ text-text-sub ไม่ใช่ text-border — token --border เป็นสีโปร่งแสง 18% ซึ่งออกแบบมาสำหรับ
                "เส้นขอบ" ที่ตาเห็นเป็นเส้นบางๆ ก็พอ แต่พอเอามาเป็นสีตัวอักษรบนพื้นหลังสว่างจะได้ contrast
                ราว 1.2:1 คือมองไม่เห็นเลย กลายเป็นช่องว่างเปล่าแทนที่จะเป็นเส้นคั่น */}
            <span className="text-text-sub" aria-hidden="true">
              │
            </span>
            <span className="text-text-sub">ระบบบัญชีและกระทบยอด</span>
          </p>
        </div>

        {/* ---- ฝั่งขวา: การ์ดฟอร์ม ---- */}
        <div className="login-card-surface rounded-2xl p-6 shadow-[0_20px_50px_-12px_rgba(92,31,56,0.35)] backdrop-blur-xl sm:p-8 md:p-10">
          <div className="mb-7 text-center">
            {/* ชื่อระบบสำหรับจอเล็กที่ไม่ได้เห็นแผงซ้าย — ไม่งั้นผู้ใช้มือถือจะเห็นแค่ฟอร์มลอยๆ ไม่รู้ว่าเว็บอะไร
                เป็น <h1> ไม่ใช่ <p> โดยตั้งใจ: แผงซ้ายที่มี <h1> จริงถูกซ่อนด้วย display:none บนจอเล็ก ซึ่ง
                ตัดออกจาก accessibility tree ไปเลย ถ้าตรงนี้เป็น <p> หน้านี้จะไม่มีหัวข้อระดับบนสุดเลยสำหรับ
                คนที่ใช้โปรแกรมอ่านหน้าจอบนมือถือ — คู่ lg:hidden / hidden lg:block ทำให้มี <h1> เพียงอันเดียว
                เสมอไม่ว่าจอกว้างแค่ไหน */}
            <h1 className="mb-4 text-sm font-bold text-primary lg:hidden">ACC Reconcile</h1>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--login-primary-light)]">
              <Lock className="h-7 w-7 text-[var(--login-primary)]" strokeWidth={2} />
            </div>
            <h2 className="text-2xl font-bold text-text">
              {mode === 'signin' ? 'ล็อกอินเข้าสู่ระบบ' : 'สร้างบัญชีใหม่'}
            </h2>
            <p className="mt-1.5 text-sm text-text-sub">
              {mode === 'signin'
                ? 'เข้าสู่ระบบเพื่อจัดการเอกสารภาษีของบริษัท'
                : 'กรอกอีเมลและรหัสผ่านเพื่อเริ่มใช้งาน'}
            </p>
            {/* ขีดสั้นใต้หัวข้อตามภาพตัวอย่าง — คั่นส่วนหัวออกจากฟอร์มโดยไม่ต้องลากเส้นเต็มความกว้าง
                ซึ่งจะทำให้การ์ดดูถูกหั่นเป็นสองท่อน */}
            <div className="mx-auto mt-4 h-1 w-14 rounded-full bg-primary/70" aria-hidden="true" />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-primary/8 p-1 text-sm font-medium">
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
              {/* ไอคอนในช่องกรอก (2026-09-22 ตามภาพตัวอย่าง) — pointer-events-none เสมอ ไม่งั้นคลิกโดน
                  ไอคอนแล้วช่องจะไม่โฟกัส ซึ่งเป็นจุดที่คนพลาดกันบ่อยเวลาทำแบบนี้ */}
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-text-sub"
                  aria-hidden="true"
                />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 w-full rounded-lg border border-[var(--login-border)] bg-input pl-12 pr-4 text-base text-text placeholder:text-text-sub focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                  placeholder="name@example.com"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text">
                รหัสผ่าน
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-text-sub"
                  aria-hidden="true"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-14 w-full rounded-lg border border-[var(--login-border)] bg-input pl-12 pr-12 text-base text-text placeholder:text-text-sub focus:border-[var(--login-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--login-primary-light)]"
                  placeholder="กรอกรหัสผ่าน"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-sub hover:text-primary"
                  // หมายเหตุ: ห้ามใช้คำว่า "รหัสผ่าน" เต็มคำใน aria-label ตรงนี้ — Playwright
                  // getByLabel('รหัสผ่าน') ที่ใช้ใน e2e/auth.spec.ts เดิม (ห้ามแก้ไฟล์นั้น) จะจับคู่
                  // แบบ substring จึงชนกับ label ของ input รหัสผ่านเอง ทำให้ selector เจอ 2 element
                  // (strict mode violation) — ใช้ "รหัส" เฉยๆ แทน ความหมายยังชัดเจนในบริบทเดิม
                  aria-label={showPassword ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {/* แถวจำอีเมล + ลืมรหัสผ่าน วางคู่กันตามภาพตัวอย่าง — ประหยัดความสูงการ์ดและจัดกลุ่ม
                  "ตัวเลือกก่อนกดเข้าสู่ระบบ" ไว้ด้วยกัน */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-text-sub">
                  {/* ข้อความบนป้ายนี้ห้ามมีคำว่า "อีเมล" หรือ "รหัสผ่าน" เด็ดขาด — เทสต์ e2e ใช้
                      getByLabel('อีเมล') / getByLabel('รหัสผ่าน') ซึ่งจับคู่แบบ substring ถ้ามีคำเหล่านั้น
                      อยู่ในป้ายนี้ด้วย selector จะเจอสอง element แล้วเทสต์ล้มทันที (strict mode violation) */}
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  ให้จำฉันไว้ในเครื่องนี้
                </label>
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

            {/* ปุ่มหลัก — ไอคอนกุญแจซ้าย + ลูกศรขวาตามภาพตัวอย่าง
                ไอคอนไม่มี text content จึงไม่กระทบเทสต์ที่ยืนยันว่าปุ่มมีข้อความว่า "เข้าสู่ระบบ" เป๊ะๆ
                (e2e/loginTransition.spec.ts) — ตอนกำลังทำงานสลับเป็น spinner + ข้อความสถานะเหมือนเดิม */}
            <button
              type="submit"
              disabled={busy}
              className="btn-press flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-[var(--login-primary)] text-base font-semibold text-on-primary shadow-[0_12px_28px_-10px_rgba(176,58,103,0.7)] transition-colors hover:bg-[var(--login-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  {busyLabel}
                </>
              ) : (
                <>
                  <Lock className="h-5 w-5" aria-hidden="true" />
                  {mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </>
              )}
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

          {/* ข้อความความปลอดภัย — ย้ายเข้ามาอยู่ "ในการ์ด" (2026-09-22 พร้อมโครงสองฝั่ง)
              เดิมลอยอยู่ใต้การ์ดบนพื้นหลังตรงๆ จึงต้องใช้สีเข้มพิเศษเพื่อให้ผ่านเกณฑ์ contrast บนลายคลื่น
              พอย้ายเข้ามาบนพื้นการ์ดขาวแล้ว --text-sub ได้ 5.94:1 ซึ่งผ่าน AA สบาย และกลับมาใช้โทนข้อความ
              รองได้ตามความหมายจริงของมัน (เป็นหมายเหตุ ไม่ใช่เนื้อหาหลัก) */}
          <div className="mt-6 text-center">
            <p className="text-xs text-text-sub">ระบบนี้ใช้สำหรับบุคลากรภายในเท่านั้น</p>
            <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-text-sub">
              <Lock className="h-3 w-3" aria-hidden="true" />
              ข้อมูลของคุณได้รับการปกป้องอย่างปลอดภัย
            </p>
          </div>
        </div>
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
