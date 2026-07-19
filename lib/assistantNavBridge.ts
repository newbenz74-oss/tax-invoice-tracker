'use client';

import { useSyncExternalStore } from 'react';
import type { AssistantNavBridge } from '@/types/assistant';

/**
 * เชื่อม(bridge)ความสามารถนำทางจริงของ DashboardShell (app/dashboard/page.tsx) เข้ากับผู้ช่วย AI ที่ mount
 * แยกอยู่คนละจุดที่ root layout (app/layout.tsx) — ใช้ external store แบบ module-level ธรรมดา +
 * useSyncExternalStore แทนการส่งผ่าน React Context เพราะ Context จะทำให้ทุก subtree ที่ subscribe re-render
 * ทุกครั้งที่ identity ของ callback เปลี่ยน ในขณะที่ useSyncExternalStore เป็น primitive ที่ถูกต้องกว่าสำหรับ
 * external mutable state แบบนี้ (และปลอดภัยกับ concurrent rendering ของ React 19)
 *
 * DashboardShell เป็นเจ้าของค่านี้เพียงผู้เดียว — เรียก registerAssistantNavBridge(bridge) ตอน mount และ
 * registerAssistantNavBridge(null) ตอน unmount ผ่าน useEffect เดียว (การลงทะเบียน callback แบบนี้ถือเป็น
 * side effect ที่ถูกต้องตามกฎ react-hooks/set-state-in-effect ของโปรเจกต์นี้ — ไม่ใช่การ derive state จาก
 * prop เหมือนที่กฎนั้นห้าม เทียบได้กับที่ lib/AuthContext.tsx สมัคร supabase.auth.onAuthStateChange ใน
 * useEffect อยู่แล้ว) หน้า /login ไม่เคย mount DashboardShell เลย (ยังไม่ผ่าน ProtectedRoute) จึงไม่มีการ
 * ลงทะเบียนใดๆ เกิดขึ้นตอนนั้น — ผู้ช่วยจะเห็นค่า null และไม่เสนอคำสั่ง "นำทางไปหน้า X" เลย ซึ่งถูกต้องแล้ว
 * เพราะยังไม่มีที่ให้นำทางไป
 */

let currentBridge: AssistantNavBridge | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AssistantNavBridge | null {
  return currentBridge;
}

function getServerSnapshot(): AssistantNavBridge | null {
  return null;
}

/** เรียกจาก DashboardShell เท่านั้น (app/dashboard/page.tsx) — ส่ง null ตอน unmount เพื่อเลิกลงทะเบียน */
export function registerAssistantNavBridge(bridge: AssistantNavBridge | null): void {
  currentBridge = bridge;
  for (const listener of listeners) listener();
}

/** เรียกจากฝั่งผู้ช่วย (components/AssistantRoot.tsx) เพื่ออ่านความสามารถนำทางปัจจุบัน — คืนค่า null ถ้า
 * ยังไม่มี DashboardShell mount อยู่ (เช่น ตอนอยู่หน้า /login) */
export function useAssistantNavBridge(): AssistantNavBridge | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
