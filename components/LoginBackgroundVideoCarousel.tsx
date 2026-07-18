'use client';

import { useEffect, useRef, useState } from 'react';

// เปลี่ยนชุดวิดีโอพื้นหลังใหม่ทั้งหมด (2026-07-18) — จากชุดเดิม 5 คลิปธีมทะเล (ฉลาม/ทะเล/โลมา/...) เป็น
// ชุดใหม่ 4 คลิปตามที่ผู้ใช้ระบุไฟล์ในดาวโหลด ("พื้นหลัง 1.mp4" ถึง "พื้นหลัง 4.mp4") ย้ายมาไว้ที่
// public/videos/login-bg-1.mp4 ... login-bg-4.mp4 (เปลี่ยนชื่อให้สั้นลง ตัดคำอธิบายเนื้อหาเดิม เช่น
// "-shark"/"-dolphin" ออกเพราะไม่ตรงกับเนื้อหาชุดใหม่แล้ว) — logic การวนลูป/crossfade ด้านล่างทั้งหมดใช้
// VIDEO_SOURCES.length แบบ dynamic อยู่แล้ว จึงรองรับจำนวนคลิปที่เปลี่ยนจาก 5 เป็น 4 ได้โดยไม่ต้องแก้ที่อื่น
const VIDEO_SOURCES = [
  '/videos/login-bg-1.mp4',
  '/videos/login-bg-2.mp4',
  '/videos/login-bg-3.mp4',
  '/videos/login-bg-4.mp4',
];

const CROSSFADE_SECONDS = 1.2;

/**
 * พื้นหลังวิดีโอหน้า login แบบสลับ 4 คลิปวนลูป (อัปเดตชุดวิดีโอ 2026-07-18 จากเดิม 5 คลิป) — เล่นคลิปที่ 1
 * จนจบ ค่อยๆ crossfade ไปคลิปที่ 2 แล้ววนไปเรื่อยๆ จนครบ 4 คลิปแล้ววนกลับไปคลิปที่ 1 ใหม่ ไม่มีจอกระพริบ/ดำระหว่างเปลี่ยนคลิป
 *
 * ใช้ <video> สองตัวสลับกัน (A/B) แทนการเปลี่ยน src ของตัวเดียว:
 * - ตัวหนึ่งเป็น "front" (opacity 1, กำลังเล่นอยู่) อีกตัวเป็น "back" (opacity 0, preload คลิปถัดไปรอไว้
 *   ล่วงหน้าตั้งแต่ยังไม่ถึงคิว)
 * - เมื่อ front เหลือเวลาน้อยกว่า CROSSFADE_SECONDS (เช็คผ่าน timeupdate) จะสั่งให้ back เริ่มเล่นจาก
 *   currentTime 0 ทันที แล้ว crossfade opacity ทั้งคู่พร้อมกันด้วย CSS transition — สลับบทบาท front/back
 * - หลัง crossfade เสร็จ (setTimeout ตรงกับ CROSSFADE_SECONDS) ตัวที่เพิ่งเล่นจบ (ตอนนี้กลายเป็น back
 *   แล้ว) จะถูก pause + รีเซ็ต + เซ็ต src เป็นคลิปถัดไปในคิว (วนกลับไปคลิปแรกหลังคลิปที่ 5) เตรียมพร้อม
 *   preload ไว้ล่วงหน้าสำหรับรอบถัดไป (อีก 4 คลิปข้างหน้า)
 *
 * state การเล่น (slotVideoIndex, frontSlot, transitioning) เก็บใน mutable object ภายใน useEffect
 * (ไม่ใช่ useState) เพราะ event listener ผูกครั้งเดียวตอน mount (dependency array ว่าง) — ถ้าอ่านค่าจาก
 * React state ตรงๆ ใน handler จะเจอปัญหา stale closure ใช้ useState (`frontSlot`) แค่จุดเดียวเพื่อ
 * trigger re-render ให้ opacity เปลี่ยนตาม CSS transition เท่านั้น
 *
 * หมายเหตุสำคัญ: ห้ามใช้ z-index ติดลบ (เช่น -z-10) กับ wrapper ที่ครอบ component นี้ — เจอบั๊กจริงมาแล้ว
 * ที่ Chrome บางเครื่องไม่ยอม paint <video> เลยเมื่ออยู่ใน stacking context ที่ z-index ติดลบ ทั้งที่วิดีโอ
 * เล่นอยู่จริงในระดับ DOM (readyState/currentTime ปกติทุกอย่าง) ผู้เรียกใช้ component นี้ต้องวางไว้ใน
 * wrapper ที่ z-index เป็น 0 หรือค่าปกติเท่านั้น แล้วให้เนื้อหาด้านหน้า (เช่นการ์ด login) ใช้ z-index บวก
 * (`relative z-10`) แทนเพื่อวาดทับ ดูรายละเอียดเพิ่มเติมได้ที่ app/login/page.tsx
 */
export default function LoginBackgroundVideoCarousel() {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const [frontSlot, setFrontSlot] = useState<0 | 1>(0);

  useEffect(() => {
    const videoA = videoRefA.current;
    const videoB = videoRefB.current;
    if (!videoA || !videoB) return;

    const videos: [HTMLVideoElement, HTMLVideoElement] = [videoA, videoB];
    const state = {
      slotVideoIndex: [0, 1 % VIDEO_SOURCES.length] as [number, number],
      frontSlot: 0 as 0 | 1,
      transitioning: false,
    };

    videos[0].src = VIDEO_SOURCES[state.slotVideoIndex[0]];
    videos[1].src = VIDEO_SOURCES[state.slotVideoIndex[1]];
    videos[0].play().catch(() => {});

    function handleTimeUpdate() {
      if (state.transitioning) return;
      const frontIdx = state.frontSlot;
      const backIdx: 0 | 1 = frontIdx === 0 ? 1 : 0;
      const frontVideo = videos[frontIdx];
      const backVideo = videos[backIdx];
      if (
        !frontVideo.duration ||
        Number.isNaN(frontVideo.duration) ||
        !Number.isFinite(frontVideo.duration)
      ) {
        return;
      }
      if (frontVideo.duration - frontVideo.currentTime > CROSSFADE_SECONDS) return;

      state.transitioning = true;
      backVideo.currentTime = 0;
      backVideo.play().catch(() => {});
      state.frontSlot = backIdx;
      setFrontSlot(backIdx);

      window.setTimeout(() => {
        const nextVideoIndex = (state.slotVideoIndex[backIdx] + 1) % VIDEO_SOURCES.length;
        frontVideo.pause();
        frontVideo.currentTime = 0;
        frontVideo.src = VIDEO_SOURCES[nextVideoIndex];
        state.slotVideoIndex[frontIdx] = nextVideoIndex;
        state.transitioning = false;
      }, CROSSFADE_SECONDS * 1000);
    }

    videos[0].addEventListener('timeupdate', handleTimeUpdate);
    videos[1].addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      videos[0].removeEventListener('timeupdate', handleTimeUpdate);
      videos[1].removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRefA}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
        style={{ opacity: frontSlot === 0 ? 1 : 0, transitionDuration: `${CROSSFADE_SECONDS * 1000}ms` }}
      />
      <video
        ref={videoRefB}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
        style={{ opacity: frontSlot === 1 ? 1 : 0, transitionDuration: `${CROSSFADE_SECONDS * 1000}ms` }}
      />
    </>
  );
}
