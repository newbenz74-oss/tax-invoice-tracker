/**
 * Mock Supabase client สำหรับทดสอบ E2E โดยไม่ต้องมี backend จริง
 * ฟังก์ชันนี้จะถูก serialize แล้วรันใน browser context ผ่าน page.addInitScript
 * ก่อนที่โค้ดแอปตัวจริงจะโหลด — ห้ามอ้างอิงตัวแปรจากภายนอกฟังก์ชัน (ต้อง self-contained)
 */

export interface MockSeedUser {
  email: string;
  password: string;
}

export interface MockSeedInvoice {
  id?: string;
  vendor_name: string;
  transaction_date: string;
  description?: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  reference_no?: string | null;
  expected_date?: string | null;
  status?: 'pending' | 'received' | 'cancelled';
  received_date?: string | null;
  tax_invoice_number?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
}

export interface MockSeed {
  users?: MockSeedUser[];
  /** ถ้าใส่ email นี้ จะเริ่มต้นด้วย session ที่ login ไว้แล้ว (ข้ามหน้า login ได้เลย) */
  loggedInAs?: string;
  invoices?: MockSeedInvoice[];
}

export function installMockSupabase(seed: MockSeed = {}) {
  function genId() {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  function nowISO() {
    return new Date().toISOString();
  }

  const users: { id: string; email: string; password: string }[] = (seed.users ?? []).map((u) => ({
    id: genId(),
    email: u.email,
    password: u.password,
  }));

  const tables: { pending_tax_invoices: Record<string, unknown>[] } = {
    pending_tax_invoices: (seed.invoices ?? []).map((inv) => ({
      id: inv.id ?? genId(),
      vendor_name: inv.vendor_name,
      transaction_date: inv.transaction_date,
      description: inv.description ?? null,
      amount_excl_vat: inv.amount_excl_vat,
      vat_amount: inv.vat_amount,
      total_amount: round2(inv.amount_excl_vat + inv.vat_amount),
      reference_no: inv.reference_no ?? null,
      expected_date: inv.expected_date ?? null,
      status: inv.status ?? 'pending',
      received_date: inv.received_date ?? null,
      tax_invoice_number: inv.tax_invoice_number ?? null,
      notes: inv.notes ?? null,
      created_by: inv.created_by ?? null,
      created_by_email: inv.created_by_email ?? null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })),
  };

  type Listener = (event: string, session: unknown) => void;
  let session: { user: { id: string; email: string }; access_token: string } | null = null;
  const listeners: Listener[] = [];

  if (seed.loggedInAs) {
    const found = users.find((u) => u.email === seed.loggedInAs);
    const id = found?.id ?? genId();
    session = { user: { id, email: seed.loggedInAs }, access_token: 'mock-token' };
  }

  function emit(event: string) {
    listeners.forEach((l) => l(event, session));
  }

  const auth = {
    async signUp({ email, password }: { email: string; password: string }) {
      if (users.find((u) => u.email === email)) {
        return { data: { user: null, session: null }, error: { message: 'User already registered' } };
      }
      const user = { id: genId(), email, password };
      users.push(user);
      session = { user: { id: user.id, email }, access_token: 'mock-token' };
      emit('SIGNED_IN');
      return { data: { user: session.user, session }, error: null };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) {
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      }
      session = { user: { id: found.id, email: found.email }, access_token: 'mock-token' };
      emit('SIGNED_IN');
      return { data: { user: session.user, session }, error: null };
    },
    async signOut() {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    },
    async getSession() {
      return { data: { session } };
    },
    onAuthStateChange(callback: Listener) {
      listeners.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe() {
              const idx = listeners.indexOf(callback);
              if (idx >= 0) listeners.splice(idx, 1);
            },
          },
        },
      };
    },
  };

  class QueryBuilder {
    private table: string;
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: Record<string, unknown> | null = null;
    private filters: [string, unknown][] = [];
    private orderBy: { field: string; ascending: boolean } | null = null;
    private wantSingle = false;

    constructor(table: string) {
      this.table = table;
    }

    select() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }

    delete() {
      this.op = 'delete';
      return this;
    }

    eq(field: string, value: unknown) {
      this.filters.push([field, value]);
      return this;
    }

    order(field: string, opts?: { ascending?: boolean }) {
      this.orderBy = { field, ascending: opts?.ascending !== false };
      return this;
    }

    single() {
      this.wantSingle = true;
      return this;
    }

    private matches(row: Record<string, unknown>) {
      return this.filters.every(([f, v]) => row[f] === v);
    }

    private execute(): { data: unknown; error: { message: string } | null } {
      const rows = tables[this.table as keyof typeof tables];
      if (!rows) {
        return { data: null, error: { message: `Unknown table: ${this.table}` } };
      }

      if (this.op === 'insert') {
        const newRow: Record<string, unknown> = {
          id: genId(),
          created_at: nowISO(),
          updated_at: nowISO(),
          status: 'pending',
          ...this.payload,
        };
        const amount = Number(newRow.amount_excl_vat ?? 0);
        const vat = Number(newRow.vat_amount ?? 0);
        newRow.total_amount = round2(amount + vat);
        rows.push(newRow);
        return { data: this.wantSingle ? newRow : [newRow], error: null };
      }

      if (this.op === 'update') {
        const matched = rows.filter((r) => this.matches(r));
        matched.forEach((r) => {
          Object.assign(r, this.payload);
          r.updated_at = nowISO();
          if (this.payload && ('amount_excl_vat' in this.payload || 'vat_amount' in this.payload)) {
            r.total_amount = round2(Number(r.amount_excl_vat ?? 0) + Number(r.vat_amount ?? 0));
          }
        });
        return { data: this.wantSingle ? matched[0] ?? null : matched, error: null };
      }

      if (this.op === 'delete') {
        tables[this.table as keyof typeof tables] = rows.filter((r) => !this.matches(r));
        return { data: null, error: null };
      }

      // select
      let result = rows.filter((r) => this.matches(r));
      if (this.orderBy) {
        const { field, ascending } = this.orderBy;
        result = [...result].sort((a, b) => {
          const av = (a[field] ?? '') as string | number;
          const bv = (b[field] ?? '') as string | number;
          if (av < bv) return ascending ? -1 : 1;
          if (av > bv) return ascending ? 1 : -1;
          return 0;
        });
      }
      return { data: this.wantSingle ? result[0] ?? null : result, error: null };
    }

    then(
      resolve: (value: { data: unknown; error: { message: string } | null }) => void,
      reject?: (reason: unknown) => void
    ) {
      try {
        const result = this.execute();
        // สำคัญ: ต้อง deep-clone ข้อมูลที่คืนออกไปเสมอ ห้ามคืน reference ของ object ใน store ตรงๆ
        // เพราะ Supabase จริงส่งข้อมูลผ่านเครือข่าย (deserialize เป็น object ใหม่ทุกครั้ง) ไม่เคยแชร์
        // reference กับฝั่งเซิร์ฟเวอร์ — ถ้าคืน reference ตรงๆ การ mutate ทีหลัง (เช่น update()
        // ใช้ Object.assign) จะย้อนไปเปลี่ยนค่าใน array ที่ SWR cache ไว้ก่อนหน้าด้วย (shared mutable
        // state) ทำให้ SWR เข้าใจผิดว่า "ข้อมูลไม่เปลี่ยน" (deep-equal เทียบกับตัวมันเอง) แล้วข้าม
        // re-render/useMemo บาง component ไป กลายเป็น UI ไม่ sync กันเอง (พบจาก E2E test จริง)
        resolve({ data: structuredClone(result.data), error: result.error });
      } catch (err) {
        if (reject) reject(err);
      }
    }
  }

  const mockClient = {
    auth,
    from(table: string) {
      return new QueryBuilder(table);
    },
  };

  // @ts-expect-error — window ไม่มี type ของ property นี้ในบริบทนี้ (self-contained script)
  window.__SUPABASE_CLIENT_OVERRIDE__ = mockClient;
}
