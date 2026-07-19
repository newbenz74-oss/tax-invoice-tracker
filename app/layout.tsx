import type { Metadata } from "next";
import { AuthProvider } from "@/lib/AuthContext";
import AssistantRoot from "@/components/AssistantRoot";
import "./globals.css";

// หมายเหตุ: ตั้งใจไม่ใช้ next/font/google (Geist) เพราะต้อง fetch จาก Google Fonts
// ตอน build — ถ้า build ในเครือข่ายที่จำกัด (corporate proxy ฯลฯ) จะ build ไม่ผ่าน
// ใช้ system font stack แทนเพื่อให้ build ได้แน่นอนทุกที่ ไม่มีผลต่อการใช้งานจริง

export const metadata: Metadata = {
  title: "BENZ | เว็บติดตามใบกำกับภาษี",
  description: "ระบบติดตามรายการซื้อที่ยังไม่ได้รับใบกำกับภาษีจากผู้ขาย",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-page-bg">
        {/* ACC Reconcile AI Copilot (2026-07-19) — mount ครั้งเดียวตรงนี้เป็น sibling ของ {children} ภายใน
            AuthProvider เดียวกัน เพื่อให้ปรากฏตั้งแต่หน้า /login เป็นต้นไปตามแผนงาน (ProtectedRoute ห่อแค่
            หน้า /dashboard เท่านั้น ถ้า mount ไว้ในนั้นแทนจะไม่โผล่บนหน้า /login เลยและจะกระพริบหายไปช่วง
            auth กำลังตรวจสอบสถานะด้วย — ดู app/dashboard/page.tsx ProtectedRoute) เป็น Client Component
            (ดู 'use client' บนสุดของ components/AssistantRoot.tsx) แต่ import ตรงๆ เข้ามาใน Server
            Component นี้ได้ปกติตามธรรมชาติของ Next.js App Router ไม่ต้องทำอะไรพิเศษเพิ่ม */}
        <AuthProvider>
          {children}
          <AssistantRoot />
        </AuthProvider>
      </body>
    </html>
  );
}
