'use client';

import { useEffect, useState, type TouchEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { NAV_STRUCTURE, allSectionIds, isNavSection, type NavEntry, type NavLeaf } from '@/lib/navigation';
// หมายเหตุ: NavItem ด้านล่างเรียกตัวเองซ้ำ (recursive) เพื่อรองรับเมนูซ้อนได้ไม่จำกัดระดับ
// (ดู lib/navigation.ts — NavSection.children เป็น NavEntry[] แล้ว ไม่ใช่ NavLeaf[] เหมือนเดิม)

const EXPANDED_STORAGE_KEY = 'benz_sidebar_expanded';
const SWIPE_CLOSE_THRESHOLD_PX = 50;

function defaultExpandedState(): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const id of allSectionIds()) state[id] = true;
  return state;
}

interface SidebarProps {
  activeId: string;
  onSelect: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

// อ่านสถานะ expand/collapse ที่บันทึกไว้จาก localStorage (client-only) — ไม่มีค่าก็ใช้ default (เปิดทุกหมวด)
function readInitialExpanded(): Record<string, boolean> {
  if (typeof window === 'undefined') return defaultExpandedState();
  try {
    const saved = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (saved) return { ...defaultExpandedState(), ...JSON.parse(saved) };
  } catch {
    // localStorage ใช้ไม่ได้ (เช่น private mode) — ใช้ค่า default ต่อไป
  }
  return defaultExpandedState();
}

export default function Sidebar({ activeId, onSelect, isOpen, onClose }: SidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readInitialExpanded);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // บันทึกสถานะ expand/collapse ไว้ทุกครั้งที่เปลี่ยน เพื่อให้จำได้ข้าม refresh
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      // เขียน localStorage ไม่ได้ก็ไม่เป็นไร แค่จำสถานะข้าม refresh ไม่ได้
    }
  }, [expanded]);

  // ล็อกการ scroll ของพื้นหลังตอนเปิด sidebar แบบ overlay บนมือถือ
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  function toggleSection(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleTouchStart(e: TouchEvent<HTMLElement>) {
    setTouchStartX(e.touches[0]?.clientX ?? null);
  }

  function handleTouchEnd(e: TouchEvent<HTMLElement>) {
    if (touchStartX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX;
    if (touchStartX - endX > SWIPE_CLOSE_THRESHOLD_PX) onClose();
    setTouchStartX(null);
  }

  return (
    <>
      {isOpen && (
        // เริ่มที่ left-[250px] (ความกว้าง sidebar) แทน inset-0 ตรง ๆ เพื่อไม่ให้ overlay
        // ซ้อนอยู่ใต้ sidebar เอง (sidebar อยู่ z-50 สูงกว่าอยู่แล้ว) — ป้องกัน pointer-event
        // ของ overlay ถูก sidebar บังในพื้นที่ที่ทับกัน
        <div
          className="fixed inset-y-0 left-[250px] right-0 z-40 bg-black/40 min-[992px]:hidden"
          onClick={onClose}
          data-testid="sidebar-overlay"
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col overflow-hidden bg-linear-to-b from-sidebar-start to-sidebar-end text-gray-50 shadow-xl transition-transform duration-[250ms] ease-in-out min-[992px]:!translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="sidebar"
        aria-label="เมนูหลัก"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-primary to-brand text-base font-bold text-white shadow-[0_4px_14px_-2px_rgba(47,167,226,0.55)]">
              B
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-wide text-white">BENZ</p>
              <p className="truncate text-[11px] text-gray-400">ระบบบัญชีและกระทบยอด</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-[250ms] hover:bg-white/[0.08] min-[992px]:hidden"
            aria-label="ปิดเมนู"
            data-testid="sidebar-close"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4" data-testid="sidebar-nav">
          {NAV_STRUCTURE.map((entry) => (
            <NavItem
              key={entry.id}
              entry={entry}
              activeId={activeId}
              onSelect={onSelect}
              expanded={expanded}
              onToggleSection={toggleSection}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}

function NavItem({
  entry,
  activeId,
  onSelect,
  expanded,
  onToggleSection,
}: {
  entry: NavEntry;
  activeId: string;
  onSelect: (id: string) => void;
  expanded: Record<string, boolean>;
  onToggleSection: (id: string) => void;
}) {
  if (isNavSection(entry)) {
    const isExpanded = expanded[entry.id] ?? true;
    const Icon = entry.icon;
    const panelId = `nav-section-panel-${entry.id}`;
    return (
      <div className="mb-1">
        <button
          type="button"
          onClick={() => onToggleSection(entry.id)}
          className="group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium text-gray-50 transition-all duration-[250ms] hover:translate-x-[3px] hover:bg-primary/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid={`nav-section-${entry.id}`}
          aria-expanded={isExpanded}
          aria-controls={panelId}
        >
          <Icon
            size={18}
            className="shrink-0 text-gray-400 transition-colors duration-[250ms] group-hover:text-gray-100"
            aria-hidden="true"
          />
          <span className="flex-1">{entry.label}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`shrink-0 text-gray-400 transition-transform duration-[250ms] group-hover:text-gray-100 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        {/* เมนูย่อยเรนเดอร์ไว้เสมอ (ไม่ conditional unmount แบบเดิม) แล้วสลับด้วยคลาส is-expanded แทน
            เพื่อให้ CSS transition (grid-template-rows 0fr→1fr ใน globals.css) เล่น Accordion Animation
            แบบนุ่มนวลได้ — visibility:hidden ตอนยุบจะตัด element ลูกออกจาก Tab/Screen reader ให้เองอยู่
            แล้ว (ดูคอมเมนต์ .nav-accordion-panel ใน globals.css) จึงไม่ต้องกังวลเรื่อง focus หลุดไปโดน
            เมนูที่มองไม่เห็น */}
        <div id={panelId} className={`nav-accordion-panel ${isExpanded ? 'is-expanded' : ''}`}>
          <div className="ml-3.5 flex flex-col gap-0.5 border-l border-white/[0.08] pt-0.5 pl-2.5">
            {entry.children.map((child) => (
              <NavItem
                key={child.id}
                entry={child}
                activeId={activeId}
                onSelect={onSelect}
                expanded={expanded}
                onToggleSection={onToggleSection}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-1">
      <NavLeafButton entry={entry} activeId={activeId} onSelect={onSelect} />
    </div>
  );
}

function NavLeafButton({
  entry,
  activeId,
  onSelect,
}: {
  entry: NavLeaf;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const Icon = entry.icon;
  const isActive = activeId === entry.id;
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.id)}
      className={`group flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium transition-all duration-[250ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        isActive
          ? 'bg-primary text-white shadow-[0_0_14px_1px_rgba(47,167,226,0.5)]'
          : 'text-gray-50 hover:translate-x-[3px] hover:bg-primary/15 hover:text-white'
      }`}
      data-testid={`nav-item-${entry.id}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon
        size={18}
        className={
          isActive
            ? 'shrink-0 text-white'
            : 'shrink-0 text-gray-400 transition-colors duration-[250ms] group-hover:text-gray-100'
        }
        aria-hidden="true"
      />
      <span className="flex-1">{entry.label}</span>
    </button>
  );
}
