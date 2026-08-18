import type { Metadata } from "next";
import { AuthProvider } from "@/lib/AuthContext";
import { CompanyProvider } from "@/lib/CompanyContext";
// ปิดผู้ช่วย AI ไว้ก่อนตามคำขอผู้ใช้ (2026-08-18) — ดูคอมเมนต์เต็มที่จุด mount ด้านล่าง
// import AssistantRoot from "@/components/AssistantRoot";
import "./globals.css";

// หมายเหตุ: ตั้งใจไม่ใช้ next/font/google (Geist) เพราะต้อง fetch จาก Google Fonts
// ตอน build — ถ้า build ในเครือข่ายที่จำกัด (corporate proxy ฯลฯ) จะ build ไม่ผ่าน
// ใช้ system font stack แทนเพื่อให้ build ได้แน่นอนทุกที่ ไม่มีผลต่อการใช้งานจริง

// เอาคำว่า "BENZ" ออกจากหัวแท็บเริ่มต้น (2026-08-14 ตามคำขอผู้ใช้ — เดิม "BENZ | เว็บติดตามใบกำกับภาษี")
// เหลือแค่ "เว็บติดตามใบกำกับภาษี" เฉยๆ ใช้เป็นค่าเริ่มต้นก่อน login/เลือกบริษัท (เช่นหน้า /login,
// /select-company) หลังเลือกบริษัทแล้ว app/dashboard/page.tsx จะเปลี่ยน document.title เป็นชื่อบริษัทแทน
export const metadata: Metadata = {
  title: "เว็บติดตามใบกำกับภาษี",
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
          {/* CompanyProvider ต้องอยู่ใน AuthProvider เสมอ (ดึงรายชื่อบริษัทจาก session ปัจจุบัน) — ครอบ
              AssistantRoot ด้วยเพราะ AI Copilot อาจต้องรู้บริบทบริษัทที่กำลังใช้งานอยู่ในอนาคต */}
          <CompanyProvider>
            {children}
            {/* ปิดการแสดงผู้ช่วย AI ไว้ก่อนตามคำขอผู้ใช้ (2026-08-18 — ยังไม่พร้อมใช้งานจริง/บังตำแหน่งอื่นบนจอ)
                ไม่ได้ลบโค้ดออก แค่ไม่ mount เฉยๆ เพื่อให้เรียกกลับมาใช้ได้ทันทีในอนาคตแค่เอาคอมเมนต์นี้ออก */}
            {/* <AssistantRoot /> */}
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
