/**
 * ค่าคงที่ของธีมสว่าง/กลางคืน (2026-09-11)
 *
 * แยกออกมาเป็นไฟล์ต่างหากที่ *ไม่มี* 'use client' โดยเจตนา เพราะ app/layout.tsx เป็น Server Component
 * และต้องใช้ THEME_INIT_SCRIPT ตั้งแต่ตอน render ฝั่งเซิร์ฟเวอร์ (ใส่ลง <head> ก่อนเบราว์เซอร์วาดจอ)
 * ถ้าปล่อยค่าพวกนี้ไว้ใน lib/ThemeContext.tsx ซึ่งมี 'use client' อยู่บนสุด จะกลายเป็นการดึงโมดูลฝั่ง
 * client เข้ามาใน Server Component โดยไม่จำเป็น — แยกไว้ตรงนี้ทั้งสองฝั่ง import ได้สะอาดเท่ากัน
 * และ "คีย์ที่ใช้จำค่า" มีอยู่ที่เดียวจริงๆ ไม่ต้องเขียนซ้ำสองที่ให้หลุดกันทีหลัง
 */

export type Theme = 'light' | 'dark';

/** คีย์ใน localStorage — ขึ้นต้นด้วย benz_ เหมือนคีย์อื่นของระบบ (benz_sidebar_active ฯลฯ) */
export const THEME_STORAGE_KEY = 'benz_theme';

/**
 * สคริปต์ที่รันใน <head> ก่อนเบราว์เซอร์วาดหน้าเว็บครั้งแรก — ถ้าไม่มีตัวนี้ ผู้ใช้ที่เลือกโหมดกลางคืนไว้
 * จะเห็นจอสีชมพูสว่างแวบขึ้นมาเสี้ยววินาทีก่อนจะกลายเป็นสีเข้ม (flash of wrong theme) ซึ่งแสบตากว่าเดิม
 * โดยเฉพาะตอนกลางคืนที่เป็นเหตุผลหลักของฟีเจอร์นี้ทั้งฟีเจอร์
 *
 * ห่อ try/catch ไว้เพราะ localStorage โยน error ได้จริงในบางสภาพแวดล้อม (โหมดส่วนตัวบางเบราว์เซอร์,
 * การตั้งค่าบล็อกคุกกี้/site data) — ถ้าอ่านไม่ได้ให้ใช้โหมดสว่างเงียบๆ ไม่ต้องทำให้ทั้งหน้าพัง
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}`;
