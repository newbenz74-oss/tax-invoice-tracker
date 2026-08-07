'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight, Loader2, LogOut, Plus, X } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { createCompany } from '@/lib/companyApi';

/**
 * หน้า "เลือกบริษัท" (เพิ่มเข้ามา 2026-08-07 พร้อมฟีเจอร์รองรับหลายบริษัท) — อยู่ระหว่างหน้าล็อกอินกับ
 * แดชบอร์ด (ล็อกอิน → เลือกบริษัท → แดชบอร์ด) ธีมกระจกใสต่อเนื่องจากการ์ดหน้าล็อกอิน (ตามที่ผู้ใช้เลือกจาก
 * มอคอัพ 4 แบบ — "แบบที่ 2") ไม่ใช้พื้นหลังวิดีโอซ้ำ (ใช้ไล่สีเดียวกับพื้นหลัง fallback ของหน้าล็อกอินแทน
 * เพื่อไม่ต้องโหลดวิดีโอซ้ำอีกรอบ)
 *
 * ถ้ามีบริษัทเดียว: ข้ามหน้านี้ไปแดชบอร์ดทันทีอัตโนมัติ ไม่ต้องให้กดเลือกเอง
 * ถ้ามีมากกว่า 1 บริษัท: แสดงการ์ดลิสต์ให้เลือก — คลิกครั้งเดียวแค่ไฮไลต์/เลือกไว้ก่อน ต้อง "ดับเบิ้ลคลิก"
 * (หรือกดปุ่ม "เข้าใช้งาน" ที่โผล่มาหลังเลือกแล้ว สำหรับจอสัมผัสที่ดับเบิ้ลคลิกไม่สะดวก) เพื่อเข้าใช้งานจริง
 * ตามที่ผู้ใช้ยืนยันชัดเจนว่าไม่อยากให้คลิกครั้งเดียวแล้วเข้าเลย (กันกดพลาดสลับบริษัทผิด)
 * ถ้าไม่มีบริษัทเลย (ยังไม่ได้รับสิทธิ์): แสดงข้อความให้ติดต่อผู้ดูแลระบบ (ยังสร้างบริษัทใหม่เองได้อยู่ดี
 * ผ่านปุ่ม "เพิ่มบริษัทใหม่" ด้านล่าง)
 *
 * "เพิ่มบริษัทใหม่" (เพิ่มเข้ามา 2026-08-07 เช่นกัน — ดู supabase/migration_008_self_service_create_company.sql):
 * ใครก็ตามที่ login เข้ามาได้สร้างบริษัทใหม่เองได้เลย ไม่ต้องรอแอดมินรัน SQL อีกต่อไป สร้างเสร็จจะกลายเป็น
 * สมาชิกบริษัทนั้นทันทีและพาเข้าแดชบอร์ดของบริษัทที่เพิ่งสร้างเลย
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

function SelectCompanyContent() {
  const router = useRouter();
  const { session } = useAuth();
  const { companies, loading, error, selectCompany, reload } = useCompany();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
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
    // คลิกครั้งเดียว = แค่ไฮไลต์ไว้ก่อน (toggle ถ้าคลิกซ้ำการ์ดเดิมที่เลือกอยู่แล้วให้ยกเลิกไฮไลต์)
    setHighlightedId((prev) => (prev === id ? null : id));
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
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
      handleEnter(company.id);
    } catch (err) {
      setCreating(false);
      setCreateError(err instanceof Error ? err.message : 'สร้างบริษัทไม่สำเร็จ');
    }
  }

  const showPicker = !loading && companies.length > 1;
  const showEmpty = !loading && !error && companies.length === 0;

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1a5f85] px-4 py-10 sm:py-12">
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#0a3a5c]/50 via-[#0a3a5c]/25 to-[#031f33]/65" />

      <div className="relative z-10 w-full max-w-[440px]">
        <div className="rounded-2xl border border-white/40 bg-white/65 p-6 shadow-[0_20px_50px_-12px_rgba(15,64,105,0.35)] backdrop-blur-xl sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--login-primary-light)]">
              <Building2 className="h-6 w-6 text-[var(--login-primary)]" strokeWidth={2} />
            </div>
            <h1 className="text-xl font-bold text-[var(--login-primary)]">เลือกบริษัทที่ต้องการเข้าใช้งาน</h1>
            {session?.user?.email && <p className="mt-1 text-sm text-gray-500">{session.user.email}</p>}
          </div>

          {loading && (
            <div className="flex flex-col items-center gap-2 py-8 text-gray-500" data-testid="select-company-loading">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">กำลังโหลดรายชื่อบริษัท...</p>
            </div>
          )}

          {!loading && error && (
            <p role="alert" data-testid="select-company-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {showEmpty && (
            <div
              className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500"
              data-testid="select-company-empty"
            >
              บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งานบริษัทใดเลย กดปุ่ม &quot;เพิ่มบริษัทใหม่&quot; ด้านล่างเพื่อสร้างเอง
              หรือติดต่อผู้ดูแลระบบให้เพิ่มสิทธิ์ให้
            </div>
          )}

          {showPicker && (
            <>
              <p className="mb-2 text-xs text-gray-400">คลิกเลือก แล้วดับเบิ้ลคลิก (หรือกดปุ่ม &quot;เข้าใช้งาน&quot;) เพื่อเข้าใช้งาน</p>
              <div className="space-y-2.5" data-testid="select-company-list">
                {companies.map((company) => {
                  const isHighlighted = highlightedId === company.id;
                  return (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => handleCardClick(company.id)}
                      onDoubleClick={() => handleEnter(company.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                        isHighlighted
                          ? 'border-[var(--login-primary)] bg-white ring-2 ring-[var(--login-primary)]/30'
                          : 'border-gray-200 bg-white/75 hover:bg-white'
                      }`}
                      data-testid={`select-company-option-${company.id}`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--login-primary-light)] text-sm font-semibold text-[var(--login-primary)]">
                        {company.name.replace('บริษัท', '').replace('ห้างหุ้นส่วน', '').trim().charAt(0) || '?'}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{company.name}</span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>

              {highlightedId && (
                <button
                  type="button"
                  onClick={() => handleEnter(highlightedId)}
                  className="mt-3 w-full rounded-xl bg-[var(--login-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  data-testid="select-company-confirm-enter"
                >
                  เข้าใช้งาน
                </button>
              )}
            </>
          )}

          {!loading && !showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:bg-white/50"
              data-testid="select-company-add-toggle"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              เพิ่มบริษัทใหม่
            </button>
          )}

          {!loading && showAddForm && (
            <form
              onSubmit={handleCreateCompany}
              className="mt-4 rounded-xl border border-gray-200 bg-white/80 p-3.5"
              data-testid="select-company-add-form"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">เพิ่มบริษัทใหม่</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewCompanyName('');
                    setCreateError(null);
                  }}
                  aria-label="ยกเลิกเพิ่มบริษัทใหม่"
                  className="text-gray-400 hover:text-gray-600"
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-[var(--login-primary)] focus:outline-none disabled:opacity-60"
                data-testid="select-company-add-input"
              />
              {createError && (
                <p role="alert" data-testid="select-company-add-error" className="mt-2 text-xs text-red-600">
                  {createError}
                </p>
              )}
              <button
                type="submit"
                disabled={creating || !newCompanyName.trim()}
                className="mt-2.5 w-full rounded-lg bg-[var(--login-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="select-company-add-submit"
              >
                {creating ? 'กำลังสร้าง...' : 'สร้างและเข้าใช้งาน'}
              </button>
            </form>
          )}

          {!loading && (
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              ออกจากระบบ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
