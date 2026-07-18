import { Clock } from 'lucide-react';

interface ComingSoonProps {
  label: string;
}

/** หน้า placeholder สำหรับเมนูที่ยังไม่ได้พัฒนาฟีเจอร์จริง — คลิกได้ปกติ ไม่ใช่ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น
 * ห่อข้อความด้วย card-surface (2026-07-18 พร้อมกับพื้นหลังภาพใหม่ .app-background) — เดิมข้อความวางตรงบน
 * พื้นหลังหน้าตรงๆ ไม่มีการ์ดรองรับ พอเปลี่ยนพื้นหลังจากสีขาวล้วนเป็นภาพแล้วจะอ่านยากทันที การใส่การ์ดขาวรอง
 * ยังทำให้ดูเป็นดีไซน์ตั้งใจ (การ์ดลอยตรงกลางจอ) มากกว่าแค่ข้อความลอยเฉยๆ ด้วย ไม่กระทบ data-testid/ข้อความ/
 * โครงสร้างอื่นใดเลย แค่เพิ่ม wrapper div ห่อรอบเนื้อหาเดิมทั้งหมด */
export default function ComingSoon({ label }: ComingSoonProps) {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6"
      data-testid="coming-soon"
    >
      <div className="card-surface flex flex-col items-center rounded-2xl px-10 py-12 text-center">
        <div className="rounded-full bg-primary-light p-4">
          <Clock size={32} className="text-primary" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-text">{label}</h2>
        <p className="mt-2 max-w-sm text-sm text-text-sub">
          ฟีเจอร์นี้กำลังอยู่ระหว่างการพัฒนา เร็วๆ นี้จะเปิดให้ใช้งาน
        </p>
      </div>
    </main>
  );
}
