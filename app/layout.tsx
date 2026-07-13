import type { Metadata } from "next";
import { AuthProvider } from "@/lib/AuthContext";
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
      <body className="min-h-full flex flex-col bg-gray-50">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
