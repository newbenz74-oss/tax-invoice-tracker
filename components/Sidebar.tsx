'use client';

import { useEffect, useState, type TouchEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { NAV_STRUCTURE, allSectionIds, isNavSection, type NavEntry, type NavLeaf } from '@/lib/navigation';

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
        className={`fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col overflow-hidden bg-gray-900 text-gray-50 transition-transform duration-[250ms] ease-in-out min-[992px]:!translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="sidebar"
        aria-label="เมนูหลัก"
      >
        <div className="flex items-start justify-between gap-2 px-4 py-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-50">ระบบบัญชีและกระทบยอด</p>
            <p className="truncate text-xs text-gray-400">Accounting &amp; Reconciliation</p>
            <p className="mt-1.5 text-[11px] font-medium tracking-wide text-gray-500">BENZ</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-white/[0.08] min-[992px]:hidden"
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
    return (
      <div className="mb-1">
        <button
          type="button"
          onClick={() => onToggleSection(entry.id)}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium text-gray-50 transition-colors duration-[250ms] hover:bg-white/[0.08]"
          data-testid={`nav-section-${entry.id}`}
          aria-expanded={isExpanded}
        >
          <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
          <span className="flex-1">{entry.label}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`shrink-0 text-gray-400 transition-transform duration-[250ms] ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        {isExpanded && (
          <div className="ml-3.5 flex flex-col gap-0.5 border-l border-white/[0.08] pl-2.5">
            {entry.children.map((child) => (
              <NavLeafButton key={child.id} entry={child} activeId={activeId} onSelect={onSelect} />
            ))}
          </div>
        )}
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
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium transition-colors duration-[250ms] ${
        isActive ? 'bg-blue-600 text-white' : 'text-gray-50 hover:bg-white/[0.08]'
      }`}
      data-testid={`nav-item-${entry.id}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={18} className={isActive ? 'shrink-0 text-white' : 'shrink-0 text-gray-400'} aria-hidden="true" />
      <span className="flex-1">{entry.label}</span>
    </button>
  );
}
