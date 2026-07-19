'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { applyChromaKey } from '@/lib/assistantChromaKey';

const VIDEO_SRC = '/videos/ai-assistant.mp4';
const POSTER_SRC = '/videos/ai-assistant-poster.png';
const AVATAR_ALT = 'ACC Reconcile AI Copilot';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** ความละเอียดภายในของ canvas — วิดีโอต้นฉบับ 1080x1080 ถูก drawImage แบบย่อขนาดลงมาระดับนี้ก่อนเริ่ม
 * คำนวณลบพื้นหลังทุกเฟรม (ประหยัด getImageData/putImageData มาก — สำคัญเพราะฟังก์ชันนี้ทำงานทุกเฟรมตลอดที่
 * แสดงอวตารอยู่) อวตารแสดงผลจริงบนจอสูงสุดแค่ 88px (ดู AssistantBubble.tsx) 180 = พอสำหรับความคมชัดระดับ
 * retina (2x) ที่ขนาดใหญ่สุดพร้อมเผื่อไว้เล็กน้อย */
const CANVAS_RESOLUTION = 180;

/** subscribe/getSnapshot สำหรับ useSyncExternalStore — เลียนแบบ pattern เดียวกับที่ app/login/page.tsx ใช้
 * เช็ค prefers-reduced-motion อยู่แล้ว (ไม่ import ข้ามมาเพราะฟังก์ชันเดิมเป็น local ของไฟล์นั้น ไม่ได้ export
 * ออกมา — คัดลอก pattern มาเพื่อไม่ต้องแก้ไฟล์ login/page.tsx ที่มีอยู่แล้ว) วิธีนี้เป็นวิธีมาตรฐานของ React
 * สำหรับ subscribe ค่าจาก external API อย่าง matchMedia โดยไม่ชน react-hooks/set-state-in-effect
 * getServerSnapshot คืนค่า false เสมอเพราะฝั่ง server ไม่มี window ให้เช็ค (ต้อง match กับค่าตอน hydrate
 * เพื่อไม่ให้เกิด hydration mismatch) */
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

/** canvas 2d support ไม่เปลี่ยนแปลงระหว่างอายุของหน้าเลย (ไม่เหมือน reduced-motion ที่ผู้ใช้สลับได้ระหว่าง
 * เปิดหน้าอยู่) จึงไม่มีอะไรให้ subscribe จริงๆ — แต่ยังใช้ useSyncExternalStore เพื่อประโยชน์ 2 อย่าง: (1)
 * ได้ getServerSnapshot คืนค่า false เสมอ ปลอดภัยกับ SSR/hydration แบบเดียวกับ reduced-motion ด้านบน (2)
 * หลีกเลี่ยง react-hooks/set-state-in-effect (การ setState เปล่าๆ ใน useEffect ที่ไม่ได้ subscribe อะไรจริง
 * ถือเป็น derive-state-from-nothing ตามกฎนี้) subscribe จึงเป็นแค่ no-op unsubscribe เพราะไม่มีเหตุการณ์ให้ฟัง */
function subscribeCanvasSupport(): () => void {
  return () => {};
}

function getCanvasSupportSnapshot(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('2d'));
}

function getCanvasSupportServerSnapshot(): boolean {
  return false;
}

interface ChromaKeyAvatarProps {
  /** ควบคุมขนาดที่แสดงจริงบนจอทั้งหมดผ่าน className (ต้องมีคลาส w- กับ h- อยู่ในนี้เสมอ) — ตั้งใจไม่ใช้ prop
   * ตัวเลข size แบบเดิม เพราะผู้เรียกจริง (AssistantBubble.tsx) ต้องการขนาดที่เปลี่ยนตาม breakpoint
   * (64px มือถือ → 72px แท็บเล็ต → 88px จอใหญ่) ซึ่งทำได้เฉพาะผ่าน Tailwind responsive class เท่านั้น —
   * ถ้ากำหนดผ่าน inline style={{width,height}} แทน จะชนะ/บล็อก class ทุกตัวเสมอ (inline style มี
   * priority สูงกว่า class ไม่ว่า specificity จะเป็นอย่างไร) ทำให้ปรับขนาดตาม breakpoint ไม่ได้เลย */
  className: string;
}

/**
 * อวตารผู้ช่วย AI — แสดงวิดีโอลูปแบบลบพื้นหลังสีเขียวออกแบบ real-time ด้วย 2D Canvas (ไม่ใช้ WebGL เพราะ
 * แสดงผลแค่ 64-88px เท่านั้น ไม่คุ้มความซับซ้อนที่เพิ่มขึ้น) ใช้ตรรกะลบพื้นหลังจาก lib/assistantChromaKey.ts
 * (แยกไฟล์เพื่อเทสต์ pure logic ได้โดยไม่ต้องพึ่ง canvas จริง)
 *
 * fallback ไปที่ภาพนิ่ง poster PNG (โปร่งใสอยู่แล้ว สร้างจากเฟรมเดียวกันด้วยอัลกอริทึมเดียวกัน — ดู
 * public/videos/ai-assistant-poster.png) เมื่อเงื่อนไขใดเงื่อนไขหนึ่งเป็นจริง: ผู้ใช้ตั้งค่า
 * prefers-reduced-motion, เบราว์เซอร์ไม่รองรับ canvas 2d context, หรือวิดีโอเล่นไม่สำเร็จ (onError)
 *
 * ทุกค่าที่ใช้ตัดสินใจโหมดเริ่มต้นที่ false/poster เสมอ (ปลอดภัยกับ SSR — ไม่อ่าน window ระหว่าง render)
 * แล้วค่อยยืนยันค่าจริงหลัง mount — progressive enhancement ผู้ใช้ทุกคนเห็นอวตารได้ทันทีไม่มีจอว่างระหว่างรอ
 * แม้แต่ตอน JS ยังโหลดไม่เสร็จ (poster เป็น <img> ธรรมดา)
 */
export default function ChromaKeyAvatar({ className }: ChromaKeyAvatarProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );
  const canvasSupported = useSyncExternalStore(
    subscribeCanvasSupport,
    getCanvasSupportSnapshot,
    getCanvasSupportServerSnapshot
  );
  const [videoErrored, setVideoErrored] = useState(false);

  const mode: 'video' | 'poster' = !prefersReducedMotion && canvasSupported && !videoErrored ? 'video' : 'poster';

  useEffect(() => {
    if (mode !== 'video') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // willReadFrequently: บอกเบราว์เซอร์ล่วงหน้าว่า canvas นี้จะถูกเรียก getImageData ทุกเฟรมแน่ๆ — ให้เลือก
    // backend ที่เหมาะกับการอ่านค่ากลับบ่อยๆ แทนที่จะ optimize เพื่อการวาดอย่างเดียว
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      // เคสหายาก: getCanvasSupportSnapshot ผ่าน (canvas ทดสอบเปล่าๆ ขอ context ได้) แต่ canvas จริงใน DOM
      // กลับขอไม่ได้ (เช่น context ถูกใครขอไปแล้วด้วย type อื่นก่อนหน้า) — ใช้ flag เดียวกับ video error
      // เพื่อ fallback ไป poster เหมือนกัน ไม่ต้องมี state แยกอีกตัวสำหรับเคสที่แทบไม่เกิดขึ้นจริงนี้
      setVideoErrored(true);
      return;
    }

    let rafHandle: number | null = null;
    let vfcHandle: number | null = null;
    const supportsVideoFrameCallback = typeof video.requestVideoFrameCallback === 'function';

    // ฟังก์ชันข้างล่างรับ video/context เป็นพารามิเตอร์ตรงๆ แทนที่จะอ่านจากตัวแปรนอก closure (video/ctx
    // ด้านบน) เพราะ TypeScript ไม่คง narrowing (ที่ผ่าน `if (!video || !canvas) return` แล้ว) ข้ามเข้าไปใน
    // nested function declaration — ส่งเป็นพารามิเตอร์ที่มี type ไม่ nullable ตรงๆ แก้ปัญหานี้ได้สะอาดกว่า
    // การใช้ non-null assertion (!) ซึ่งไม่ใช่ธรรมเนียมของโค้ดจริงในโปรเจกต์นี้ (เจอแค่ในไฟล์เทสต์)
    function renderFrame(v: HTMLVideoElement, context: CanvasRenderingContext2D) {
      if (v.readyState >= v.HAVE_CURRENT_DATA) {
        context.drawImage(v, 0, 0, CANVAS_RESOLUTION, CANVAS_RESOLUTION);
        const frame = context.getImageData(0, 0, CANVAS_RESOLUTION, CANVAS_RESOLUTION);
        applyChromaKey(frame.data);
        context.putImageData(frame, 0, 0);
      }
      scheduleNextFrame(v, context);
    }

    function scheduleNextFrame(v: HTMLVideoElement, context: CanvasRenderingContext2D) {
      if (document.hidden) return; // หยุด loop ตอนแท็บถูกซ่อน — handleVisibilityChange ด้านล่างจะสั่งเริ่มใหม่เองตอนกลับมา
      if (supportsVideoFrameCallback) {
        vfcHandle = v.requestVideoFrameCallback(() => renderFrame(v, context));
      } else {
        rafHandle = requestAnimationFrame(() => renderFrame(v, context));
      }
    }

    function handleVisibilityChange(v: HTMLVideoElement, context: CanvasRenderingContext2D) {
      if (document.hidden) {
        v.pause();
      } else {
        v.play().catch(() => {});
        scheduleNextFrame(v, context);
      }
    }
    const onVisibilityChange = () => handleVisibilityChange(video, ctx);

    video.play().catch(() => {});
    scheduleNextFrame(video, ctx);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      if (vfcHandle !== null) video.cancelVideoFrameCallback(vfcHandle);
    };
  }, [mode]);

  if (mode === 'poster') {
    return (
      // ภาพขนาดเล็กมาก (64-88px, ไฟล์ ~80KB) ไม่คุ้มความซับซ้อนของ next/image สำหรับ asset นี้ (ไม่ต้องการ
      // responsive srcset/lazy-load ใดๆ — ขนาดคงที่เสมอ)
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={POSTER_SRC}
        alt={AVATAR_ALT}
        width={88}
        height={88}
        className={`${className} object-contain`}
        data-testid="assistant-avatar-poster"
      />
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onError={() => setVideoErrored(true)}
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        width={CANVAS_RESOLUTION}
        height={CANVAS_RESOLUTION}
        role="img"
        aria-label={AVATAR_ALT}
        className={className}
        data-testid="assistant-avatar-canvas"
      />
    </>
  );
}
