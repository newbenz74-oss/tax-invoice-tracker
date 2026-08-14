'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronRight, Loader2, LogOut, Plus, X } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { createCompany } from '@/lib/companyApi';

/**
 * หน้า "เลือกบริษัท" (เพิ่มเข้ามา 2026-08-07 พร้อมฟีเจอร์รองรับหลายบริษัท) — อยู่ระหว่างหน้าล็อกอินกับ
 * แดชบอร์ด (ล็อกอิน → เลือกบริษัท → แดชบอร์ด)
 *
 * ดีไซน์ปรับใหม่ 2026-08-10 ตามภาพตัวอย่างที่ผู้ใช้ส่งมา (สไตล์ dark hero เต็มจอ + กริดการ์ดโลโก้ + แถบบนสุด) —
 * ปรับรายละเอียดบางจุดจากภาพต้นฉบับให้ทนทานต่อ layout จริง:
 *  - ตอนนั้นยังไม่มีโลโก้บริษัทจริง ใช้ตัวอักษรย่อ + สีพื้นหลังแทน — ตั้งแต่ฟีเจอร์อัปโหลดโลโก้ (2026-08-14 ดู
 *    CompanySettingsPage.tsx/migration_017_company_logo.sql) ถ้าบริษัทมี logo_url จะแสดงรูปจริงแทนตัวอักษรย่อ
 *    ทันที ตัวอักษรย่อยังเป็น fallback สำหรับบริษัทที่ยังไม่ได้อัปโหลดโลโก้อยู่เหมือนเดิม
 *  - ป้าย "เลือกบริษัทนี้ / คลิกเพื่อเข้าใช้งาน" ในภาพต้นฉบับลอยอยู่ใต้การ์ด (absolute tooltip) — ที่นี่ทำเป็น
 *    ส่วนขยายภายในตัวการ์ดเองแทน (การ์ดสูงขึ้นเวลาถูกเลือก) กัน tooltip ไปทับการ์ดแถวถัดไปเวลาบริษัทมีเยอะ
 *  - ปุ่ม "เพิ่มบริษัทใหม่" ทำเป็นการ์ดเส้นประในกริดเดียวกัน กดแล้วเด้งเป็น modal กรอกชื่อ (แทนฟอร์มขยายในที่เดิม)
 *
 * คลิกครั้งเดียว = ไฮไลต์การ์ด (โชว์ปุ่ม "เข้าใช้งาน" ในการ์ด) — ดับเบิ้ลคลิก = เข้าใช้งานทันทีเป็นทางลัด ตามที่
 * ผู้ใช้ยืนยันชัดเจนว่าไม่อยากให้คลิกครั้งเดียวแล้วเข้าเลย (กันกดพลาดสลับบริษัทผิด)
 *
 * ไม่จำบริษัทที่เลือกไว้ข้ามการล็อกอิน (ผู้ใช้ยืนยันชัดเจนว่าต้องการแบบนี้) — ดู lib/CompanyContext.tsx และ
 * components/Header.tsx (ล้าง sessionStorage ตอนออกจากระบบ)
 */
export default function SelectCompanyPage() {
  return (
    <ProtectedRoute>
      <SelectCompanyContent />
    </ProtectedRoute>
  );
}

// วนสีพื้นหลังของตัวอักษรย่อบริษัทตามลำดับ id ให้แต่ละบริษัทมีสีต่างกันพอแยกออกด้วยสายตา (ไม่ผูกกับความหมาย
// ใดๆ เป็นแค่ความสวยงาม)
const AVATAR_COLORS = [
  'bg-[#2fa4d7]',
  'bg-[#1d9e75]',
  'bg-[#d85a30]',
  'bg-[#ba7517]',
  'bg-[#d4537e]',
  'bg-[#7f77dd]',
];

function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function SelectCompanyContent() {
  const router = useRouter();
  const { session } = useAuth();
  const { companies, loading, error, selectCompany, reload } = useCompany();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // มีบริษัทเดียว = ข้ามหน้านี้ไปเลยอัตโนมัติ ไม่ต้องให้ผู้ใช้กดเลือกเองทั้งที่ไม่มีทางเลือกจริง
  useEffect(() => {
    if (!loading && companies.length === 1) {
      selectCompany(companies[0].id);
      router.replace('/dashboard');
    }
  }, [loading, companies, selectCompany, router]);

  function handleEnter(id: string) {
    selectCompany(id);
    router.replace('/dashboard');
  }

  function handleCardClick(id: string) {
    setHighlightedId((prev) => (prev === id ? null : id));
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function openAddModal() {
    setNewCompanyName('');
    setCreateError(null);
    setShowAddModal(true);
  }

  function closeAddModal() {
    if (creating) return;
    setShowAddModal(false);
  }

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCompanyName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const company = await createCompany(name);
      reload();
      setShowAddModal(false);
      handleEnter(company.id);
    } catch (err) {
      setCreating(false);
      setCreateError(err instanceof Error ? err.message : 'สร้างบริษัทไม่สำเร็จ');
    }
  }

  const showPicker = !loading && companies.length > 1;
  const showEmpty = !loading && !error && companies.length === 0;

  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-hidden bg-[#0b1220]">
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-[#0a3a5c] via-[#0b1220] to-[#031f33]" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-[600px] rounded-[50%] bg-[#2fa4d7]/10 blur-3xl" />

      {/* แถบบนสุด */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--login-primary)]/20">
            <Building2 className="h-4.5 w-4.5 text-[var(--login-primary)]" strokeWidth={2.2} />
          </div>
          <span className="text-sm font-semibold tracking-wide text-white">BENZ</span>
        </div>

        {session?.user?.email && (
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pl-1 pr-3 sm:flex">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--login-primary)]/25 text-[11px] font-semibold text-[var(--login-primary)]">
                {session.user.email.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-white/70">{session.user.email}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="ออกจากระบบ"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      {/* เนื้อหาหลัก */}
      <main className="relative z-10 flex flex-1 flex-col items-center px-5 py-8 sm:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <h1 className="bg-gradient-to-r from-white to-[var(--login-primary)] bg-clip-text text-3xl font-semibold text-transparent sm:text-4xl">
            เลือกบริษัท
          </h1>
          <p className="mt-2 text-sm text-white/50">เลือกบริษัทที่ต้องการเข้าใช้งานบน BENZ</p>
        </div>

        <div className="w-full max-w-4xl">
          {loading && (
            <div
              className="flex flex-col items-center gap-2 py-16 text-white/60"
              data-testid="select-company-loading"
            >
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">กำลังโหลดรายชื่อบริษัท...</p>
            </div>
          )}

          {!loading && error && (
            <p
              role="alert"
              data-testid="select-company-error"
              className="mx-auto max-w-md rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300"
            >
              {error}
            </p>
          )}

          {showEmpty && (
            // ตั้งแต่ระบบอนุมัติสมาชิกใหม่ (2026-08-10 — ดู supabase/migration_010_member_approval.sql) คน
            // ที่เพิ่งสมัครสมาชิกเองแล้วยังไม่มีบริษัทเลย "ไม่ให้" สร้างบริษัทของตัวเองได้อีกต่อไป (เดิมมีปุ่ม
            // "เพิ่มบริษัทใหม่" ตรงนี้) ต้องรอสมาชิกบริษัทที่มีอยู่แล้วอนุมัติให้เข้าบริษัทที่ถูกต้องก่อนเท่านั้น
            // — ผู้ใช้ที่ผ่านการอนุมัติมาแล้วอย่างน้อยครั้งหนึ่ง (มี >=1 บริษัท) ยังกดปุ่ม "เพิ่มบริษัทใหม่" ใน
            // กริดด้านล่าง (showPicker) ได้ตามปกติ ไม่ถูกปิด — จำกัดเฉพาะกรณี 0 บริษัทเท่านั้น
            <div className="mx-auto max-w-md text-center" data-testid="select-company-empty">
              <div
                className="rounded-2xl border border-dashed border-white/20 bg-white/5 px-6 py-8 text-sm text-white/60"
              >
                สมัครสมาชิกสำเร็จแล้ว แต่บัญชีนี้ยังไม่ได้รับอนุมัติให้เข้าใช้งานบริษัทใดเลย กรุณาแจ้งผู้ดูแลระบบ
                (หรือเพื่อนร่วมบริษัท) ให้เข้าไปอนุมัติที่เมนู &quot;อนุมัติสมาชิกใหม่&quot;
              </div>
            </div>
          )}

          {showPicker && (
            <div
              className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
              data-testid="select-company-list"
            >
              {companies.map((company, index) => {
                const isHighlighted = highlightedId === company.id;
                return (
                  // เป็น div (ไม่ใช่ button) เพราะข้างในมีปุ่ม "เข้าใช้งาน" ซ้อนอยู่อีกชั้นเวลาถูกไฮไลต์ —
                  // button ซ้อน button (หรือ element ที่มี tabIndex ซ้อนใน button) ผิดกฎ HTML content model
                  // จึงใช้ role="button" + tabIndex + onKeyDown แทนเพื่อให้ยังกด Enter/Space จากคีย์บอร์ดได้
                  <div
                    key={company.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(company.id)}
                    onDoubleClick={() => handleEnter(company.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCardClick(company.id);
                      }
                    }}
                    className={`flex cursor-pointer flex-col items-center rounded-2xl border bg-white px-4 py-6 text-center transition-all ${
                      isHighlighted
                        ? 'border-[var(--login-primary)] ring-2 ring-[var(--login-primary)]/40'
                        : 'border-transparent hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-8px_rgba(0,0,0,0.35)]'
                    }`}
                    data-testid={`select-company-option-${company.id}`}
                  >
                    {company.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL มาจาก Supabase Storage (โดเมนไม่คงที่ล่วงหน้า) และเป็นไอคอนเล็ก ไม่คุ้ม next/image
                      <img
                        src={company.logo_url}
                        alt={company.name}
                        className="h-12 w-12 shrink-0 rounded-full border border-gray-100 object-contain p-1"
                      />
                    ) : (
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white ${avatarColor(index)}`}
                      >
                        {company.name.replace('บริษัท', '').replace('ห้างหุ้นส่วน', '').trim().charAt(0) || '?'}
                      </div>
                    )}
                    <p className="mt-3 line-clamp-2 text-sm font-medium text-gray-800">{company.name}</p>

                    {isHighlighted && (
                      <div className="mt-3.5 w-full border-t border-gray-100 pt-3.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEnter(company.id);
                          }}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--login-primary)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--login-primary-hover)]"
                          data-testid={`select-company-confirm-enter-${company.id}`}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          เข้าใช้งาน
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={openAddModal}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/25 bg-white/5 px-4 py-6 text-center text-white/60 transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white/85"
                data-testid="select-company-add-toggle"
              >
                <Plus className="h-6 w-6" aria-hidden="true" />
                <span className="text-sm font-medium">เพิ่มบริษัทใหม่</span>
              </button>
            </div>
          )}
        </div>
      </main>

      {/* modal เพิ่มบริษัทใหม่ */}
      {showAddModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
          <form
            onSubmit={handleCreateCompany}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111a2c] p-5 shadow-xl"
            data-testid="select-company-add-form"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">เพิ่มบริษัทใหม่</span>
              <button
                type="button"
                onClick={closeAddModal}
                aria-label="ปิดหน้าต่างเพิ่มบริษัทใหม่"
                className="text-white/40 hover:text-white/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="ชื่อบริษัท เช่น บริษัท ตัวอย่าง จำกัด"
              disabled={creating}
              autoFocus
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--login-primary)] focus:outline-none disabled:opacity-60"
              data-testid="select-company-add-input"
            />
            {createError && (
              <p role="alert" data-testid="select-company-add-error" className="mt-2 text-xs text-red-400">
                {createError}
              </p>
            )}
            <button
              type="submit"
              disabled={creating || !newCompanyName.trim()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--login-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--login-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="select-company-add-submit"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  กำลังสร้าง...
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  สร้างและเข้าใช้งาน
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
