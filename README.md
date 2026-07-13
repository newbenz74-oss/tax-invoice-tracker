# เว็บติดตามใบกำกับภาษีที่ยังไม่ได้รับ — BENZ

ระบบสำหรับทีมภายใน ใช้บันทึก/ติดตามรายการซื้อที่ยังไม่ได้รับใบกำกับภาษีจากผู้ขาย พร้อมวันที่คาดว่าจะได้รับ
สถานะ และ aging (ค้างนานแค่ไหน) — ทุกคนที่ login แล้วมีสิทธิ์เข้าถึงข้อมูลเท่ากัน (equal access)

Stack: Next.js 16 (App Router, client-heavy) + Supabase (database + auth) + Tailwind CSS
ออกแบบให้ deploy บน Vercel

## สารบัญ

1. [ตั้งค่า Supabase](#1-ตั้งค่า-supabase)
2. [รันในเครื่องตัวเอง](#2-รันในเครื่องตัวเอง)
3. [Deploy ขึ้น Vercel](#3-deploy-ขึ้น-vercel)
4. [รันเทสต์](#4-รันเทสต์)
5. [โครงสร้างโปรเจกต์](#5-โครงสร้างโปรเจกต์)

---

## 1. ตั้งค่า Supabase

> ✅ **ตั้งค่าให้เรียบร้อยแล้ว** — มีการสร้างโปรเจกต์ Supabase แยกใหม่โดยเฉพาะสำหรับแอปนี้ชื่อ
> `benz-tax-invoice-tracker` (แยกจากระบบอื่น ๆ ของบริษัทโดยสิ้นเชิง ไม่ใช้ฐานข้อมูลร่วมกับระบบอื่น)
> และรัน migration สร้างตาราง `pending_tax_invoices` ให้แล้ว ใช้ค่านี้ได้เลย (anon/publishable key
> ไม่ใช่ความลับ ปลอดภัยที่จะใส่ใน client-side env var — สิทธิ์การเข้าถึงจริงถูกควบคุมด้วย RLS):
>
> | ตัวแปร | ค่า |
> |---|---|
> | `NEXT_PUBLIC_SUPABASE_URL` | `https://jmnxkieerpfrxgcfvesi.supabase.co` |
> | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_J_DCE2mrRtckbobdQCCwPA_TPm1hnej` |
>
> ข้ามไปขั้นตอนที่ 2 ได้เลย ขั้นตอนด้านล่างมีไว้อ้างอิงเผื่อต้องสร้างโปรเจกต์ Supabase ใหม่เองในอนาคต

1. สร้างโปรเจกต์ Supabase ใหม่ (หรือใช้โปรเจกต์เดิม) ที่ [supabase.com](https://supabase.com)
2. เปิด **SQL Editor** ในโปรเจกต์ แล้วรันไฟล์ `supabase/migration.sql` ทั้งไฟล์ (สร้างตาราง
   `pending_tax_invoices` พร้อม Row Level Security — ปลอดภัยที่จะรันซ้ำได้)
3. ไปที่ **Authentication > Providers** เช็คว่า Email provider เปิดอยู่ (ค่าเริ่มต้นเปิดอยู่แล้ว)
   - ถ้าอยากให้ทีมสมัครแล้วใช้งานได้ทันทีโดยไม่ต้องกดยืนยันอีเมล ให้ปิด **Confirm email** ใน
     Authentication > Settings (มีผลต่อความปลอดภัยเล็กน้อย — เปิดไว้ถ้าไม่มั่นใจ)
4. ไปที่ **Settings > API** คัดลอกค่า:
   - **Project URL** → ใช้เป็น `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → ใช้เป็น `NEXT_PUBLIC_SUPABASE_ANON_KEY`

RLS ที่ตั้งไว้: ทุกคนที่ login แล้ว (authenticated) อ่าน/เพิ่ม/แก้/ลบได้ทุกแถวเท่ากัน — ไม่มีสิทธิ์
สำหรับผู้ใช้ที่ไม่ได้ login (anon) เลย

## 2. รันในเครื่องตัวเอง

```bash
npm install
cp .env.local.example .env.local
# แก้ .env.local ใส่ค่า NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY จริง
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

## 3. Deploy ขึ้น Vercel

วิธีที่แนะนำ (ไม่ต้องแชร์ API token ให้ใคร):

1. สร้าง repository บน GitHub แล้ว push โค้ดโปรเจกต์นี้ขึ้นไป:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <URL ของ repo คุณ>
   git push -u origin main
   ```
2. เข้า [vercel.com/new](https://vercel.com/new) แล้วกด **Import** repository ที่เพิ่ง push ขึ้นไป
   — Vercel จะตรวจพบว่าเป็น Next.js โปรเจกต์เองอัตโนมัติ ไม่ต้องตั้งค่า build command เพิ่ม
3. ก่อนกด Deploy ให้เพิ่ม **Environment Variables** ในหน้าตั้งค่าของ Vercel:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL จาก Supabase (ขั้นตอนที่ 1) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/public key จาก Supabase (ขั้นตอนที่ 1) |
4. กด **Deploy** — ครั้งต่อไปที่ push โค้ดขึ้น branch `main` จะ deploy ให้อัตโนมัติทุกครั้ง

## 4. รันเทสต์

```bash
npm test          # unit test (Vitest) — VAT, aging bucket, filter/sort, validation, สถิติ
npm run test:e2e  # browser E2E test (Playwright) — ใช้ mock Supabase client ในหน่วยความจำ
                   # ไม่ต้องมี backend จริงตอนทดสอบ (ครอบคลุม auth, CRUD, VAT auto-suggest,
                   # aging badge, filter/search, mark received, ลบแบบยืนยัน 2 ขั้นตอน)
```

## 5. โครงสร้างโปรเจกต์

```
app/
  login/page.tsx        หน้าเข้าสู่ระบบ / สมัครสมาชิก
  dashboard/page.tsx     หน้าหลัก — สถิติ, filter, ตารางรายการ
components/              UI components (ฟอร์ม, ตาราง, navbar, การ์ดสถิติ)
lib/
  invoiceLogic.ts         business logic ล้วน (VAT, aging, filter/sort, validation) — มี unit test
  invoiceApi.ts            เรียก Supabase (CRUD)
  supabaseClient.ts        สร้าง Supabase client (รองรับ mock override สำหรับทดสอบ)
  AuthContext.tsx           React context เก็บ session ปัจจุบัน
supabase/migration.sql     SQL สร้างตาราง + RLS
e2e/                       Playwright E2E tests + mock Supabase client
```
