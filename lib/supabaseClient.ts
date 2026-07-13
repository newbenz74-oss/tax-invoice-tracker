'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ทดสอบ E2E ได้โดยไม่ต้องมี backend จริง: ก่อนโหลดหน้าเว็บ
 * ให้ inject `window.__SUPABASE_CLIENT_OVERRIDE__` เป็น mock client
 * (รูปแบบเดียวกับที่ใช้ในเว็บติดตามใบกำกับภาษีเวอร์ชันแรก)
 */
declare global {
  interface Window {
    __SUPABASE_CLIENT_OVERRIDE__?: SupabaseClient;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let cachedClient: SupabaseClient | null = null;

/** คืนค่า Supabase client เดียวกันเสมอ ยกเว้นมี override สำหรับทดสอบ */
export function getSupabaseClient(): SupabaseClient {
  if (typeof window !== 'undefined' && window.__SUPABASE_CLIENT_OVERRIDE__) {
    return window.__SUPABASE_CLIENT_OVERRIDE__;
  }
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
