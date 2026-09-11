'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { THEME_STORAGE_KEY, type Theme } from './themeConstants';

/**
 * ตัวจัดการธีมสว่าง/กลางคืน (2026-09-11 — ตามคำขอผู้ใช้ "อยากให้สวิตช์เปลี่ยนเป็นโหมดกลางคืนได้ เผื่อไว้
 * ใช้ในที่กลางคืนจะได้ถนอมสายตา")
 *
 * กลไก: เขียน attribute `data-theme="dark"` ลงที่ <html> เท่านั้น ชุดสีทั้งหมดถูกสลับด้วย CSS ที่
 * app/globals.css (`:root[data-theme='dark'] { ... }`) — ไม่มี logic สีอยู่ในไฟล์นี้เลยแม้แต่ค่าเดียว
 * ไฟล์นี้ทำหน้าที่ "จำว่าผู้ใช้เลือกอะไรไว้" กับ "สลับ attribute" สองอย่างเท่านั้น
 *
 * ทำไมถึงเลือกจำใน localStorage ไม่ใช่ฐานข้อมูล: ธีมเป็นความชอบส่วนตัวของ "เครื่องที่กำลังใช้" ไม่ใช่ของ
 * บัญชีผู้ใช้ — คนเดียวกันอาจอยากเปิดโหมดกลางคืนบนโน้ตบุ๊กที่ใช้ตอนดึก แต่ใช้โหมดสว่างบนเครื่องที่ออฟฟิศ
 * ตอนกลางวัน เก็บไว้ที่เครื่องจึงตรงกับพฤติกรรมจริงมากกว่า และไม่ต้องแตะฐานข้อมูล/RLS เพิ่มเลยแม้แต่นิดเดียว
 *
 * ไม่ผูกกับ prefers-color-scheme ของเครื่องโดยอัตโนมัติ เพราะผู้ใช้ขอ "สวิตช์" ที่กดเองได้ชัดเจน ถ้าสลับ
 * ตามระบบเองด้วยจะกลายเป็นว่าบางครั้งธีมเปลี่ยนโดยที่ผู้ใช้ไม่ได้สั่ง ซึ่งน่าสับสนกว่าเดิม — ค่าเริ่มต้น
 * สำหรับคนที่ยังไม่เคยกดสวิตช์เลยคือโหมดสว่าง (ธีมชมพูพาสเทลที่เพิ่งเลือกกันไว้)
 */

/* ค่าคงที่ (คีย์ localStorage + สคริปต์กันจอกะพริบ) อยู่ที่ lib/themeConstants.ts ซึ่งไม่มี 'use client'
   เพราะ app/layout.tsx ที่เป็น Server Component ต้องใช้สคริปต์นั้นด้วย — ดูเหตุผลเต็มในไฟล์นั้น */

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

/** ต้องตรงกับ transition-duration ของบล็อก .theme-transition ใน app/globals.css (320ms) — เผื่อเวลาปิด
 *  ท้ายอีกเล็กน้อยให้ไล่สีจบสนิทก่อนถอดคลาสออก ไม่งั้นจะเห็นสีกระตุกตอนท้ายสุดของ animation */
const THEME_TRANSITION_MS = 380;

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/** ผู้ใช้ตั้งค่าเครื่องให้ลดการเคลื่อนไหวไว้หรือไม่ — ถ้าใช่ ให้สลับธีมทันทีโดยไม่ต้องไล่สี (สอดคล้องกับ
 *  บล็อก @media (prefers-reduced-motion: reduce) ใน globals.css ที่บังคับ duration แทบเป็น 0 อยู่แล้ว) */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // เริ่มที่ 'light' เสมอในรอบ render แรก แล้วค่อย sync ค่าจริงจาก localStorage ใน effect — ห้ามอ่าน
  // localStorage ตรงๆ ตอน initial state เพราะ Server Component render ฝั่งเซิร์ฟเวอร์ก่อน ที่นั่นไม่มี
  // localStorage ทำให้ HTML ที่เซิร์ฟเวอร์ส่งมากับที่ client render รอบแรกไม่ตรงกัน (hydration mismatch)
  // — ส่วนภาพที่ผู้ใช้เห็นไม่กะพริบอยู่แล้วเพราะ THEME_INIT_SCRIPT ตั้ง attribute ให้ตั้งแต่ก่อนวาดจอ
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // อ่าน localStorage ไม่ได้ (โหมดส่วนตัว/บล็อก site data) — ใช้โหมดสว่างตามค่าเริ่มต้น ไม่ต้องแจ้งอะไร
    }
    const next: Theme = stored === 'dark' ? 'dark' : 'light';
    // setState ห่อด้วย Promise.resolve().then() ตาม pattern เดียวกับ AuthContext/CompanyContext ทุกจุด
    // ในโปรเจกต์นี้ (กฎ react-hooks/set-state-in-effect: ห้าม setState ตรงๆ ใน effect body)
    Promise.resolve().then(() => {
      setThemeState(next);
      applyTheme(next);
    });
  }, []);

  // ตัวจับเวลาถอดคลาส .theme-transition — เก็บไว้ใน ref เพื่อยกเลิกตัวเก่าได้ถ้าผู้ใช้กดสวิตช์รัวๆ
  // (ถ้าไม่ยกเลิก ตัวจับเวลาของครั้งก่อนจะมาถอดคลาสกลางคันของครั้งใหม่ ทำให้ไล่สีค้างครึ่งทางแล้วกระตุก)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // เคลียร์ตัวจับเวลาที่ค้างอยู่ตอน component ถูกถอดออก (เช่นตอน Fast Refresh ระหว่างพัฒนา)
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    // เติมคลาสให้ทั้งหน้าไล่สีพร้อมกันก่อนสลับธีมจริง แล้วถอดออกเมื่อไล่สีจบ — รายละเอียดเหตุผลอยู่ที่
    // บล็อก .theme-transition ใน app/globals.css
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const animate = root !== null && !prefersReducedMotion();

    if (animate && root) {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      root.classList.add('theme-transition');
      transitionTimerRef.current = setTimeout(() => {
        root.classList.remove('theme-transition');
        transitionTimerRef.current = null;
      }, THEME_TRANSITION_MS);
    }

    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // เขียนไม่ได้ก็ยังใช้งานได้ปกติในรอบนี้ แค่จะไม่ถูกจำไว้ตอนเปิดใหม่ครั้งหน้า
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
