import { Clock } from 'lucide-react';

interface ComingSoonProps {
  label: string;
}

/** หน้า placeholder สำหรับเมนูที่ยังไม่ได้พัฒนาฟีเจอร์จริง — คลิกได้ปกติ ไม่ใช่ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น */
export default function ComingSoon({ label }: ComingSoonProps) {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6"
      data-testid="coming-soon"
    >
      <div className="rounded-full bg-gray-100 p-4">
        <Clock size={32} className="text-gray-400" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-gray-900">{label}</h2>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        ฟีเจอร์นี้กำลังอยู่ระหว่างการพัฒนา เร็วๆ นี้จะเปิดให้ใช้งาน
      </p>
    </main>
  );
}
