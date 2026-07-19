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
  // เพิ่มสำหรับฟีเจอร์ "รายงานภาษีซื้อ" (VAT Reconcile) — ดู supabase/migration_002_purchase_tax_report_fields.sql
  vendor_tax_id?: string | null;
  tax_invoice_date?: string | null;
  vat_claim_month?: number | null;
  vat_claim_year?: number | null;
  // เพิ่มสำหรับฟีเจอร์จำแนกประเภทภาษี — ดู supabase/migration_003_tax_type_classification.sql
  // ไม่ระบุ (undefined) = เหมือนข้อมูลเก่าก่อนมีฟีเจอร์นี้ (NULL ในฐานข้อมูลจริง)
  tax_type?: 'no_vat' | 'claimable_vat' | 'non_claimable_vat' | null;
}

// เพิ่มสำหรับฟีเจอร์ "สมุดรายชื่อ" (ตาราง business_partners ใหม่) — ดู
// supabase/migration_004_business_partners.sql ทุกฟิลด์ที่ optional ในนี้จะ default ตามที่ฐานข้อมูลจริง
// กำหนดไว้ (branch_type → 'head_office', status → 'active') ไม่กระทบ MockSeedInvoice/pending_tax_invoices
// เดิมด้านบนเลยแม้แต่บรรทัดเดียว
export interface MockSeedContact {
  id?: string;
  partner_type: 'customer' | 'vendor';
  contact_code: string;
  entity_type: 'individual' | 'company';
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  tax_id?: string | null;
  branch_type?: 'head_office' | 'branch';
  branch_number?: string | null;
  address?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_person?: string | null;
  note?: string | null;
  status?: 'active' | 'inactive';
  created_by?: string | null;
}

// เพิ่มสำหรับฟีเจอร์ "บันทึกประวัติการกระทบยอด" (จับคู่เอง + save/history) — ดู
// supabase/migration_006_bank_reconcile_history.sql รูปร่าง seed ตั้งใจให้ใกล้เคียงกับแถวในฐานข้อมูลจริง
// (snake_case field ตรงกับคอลัมน์) เพื่อให้ทดสอบ "มีรายการประวัติอยู่แล้ว" ได้โดยไม่ต้องเดินผ่าน UI
// อัปโหลด+จับคู่+บันทึกทุกครั้ง — matchGroupId บนแถว Bank/GL ต้องตรงกับ id ที่ระบุไว้ใน matchGroups (id
// ของ MockSeedReconcileMatchGroup เป็นค่าที่ต้องระบุเอง ไม่ auto-generate เหมือน id อื่นๆ เพราะแถว Bank/GL
// ต้องอ้างอิงกลับมาได้)
export interface MockSeedReconcileBankRow {
  id?: string;
  matchGroupId?: string | null;
  rowOrder?: number;
  date: string;
  type: 'receive' | 'payment';
  amount: number;
}

export interface MockSeedReconcileGlRow {
  id?: string;
  matchGroupId?: string | null;
  rowOrder?: number;
  documentNo?: string;
  date: string;
  type: 'receive' | 'payment';
  amount: number;
}

export interface MockSeedReconcileMatchGroup {
  id: string;
  matchType: 'auto' | 'manual';
  type: 'receive' | 'payment';
}

export interface MockSeedReconcileReport {
  id?: string;
  reportName: string;
  periodMonth: number;
  periodYear: number;
  status?: 'draft' | 'complete';
  bankFileName?: string | null;
  glFileName?: string | null;
  toleranceDays?: 1 | 3;
  matchGroups?: MockSeedReconcileMatchGroup[];
  bankRows?: MockSeedReconcileBankRow[];
  glRows?: MockSeedReconcileGlRow[];
  createdBy?: string | null;
  createdByEmail?: string | null;
}

export interface MockSeed {
  users?: MockSeedUser[];
  /** ถ้าใส่ email นี้ จะเริ่มต้นด้วย session ที่ login ไว้แล้ว (ข้ามหน้า login ได้เลย) */
  loggedInAs?: string;
  invoices?: MockSeedInvoice[];
  /** ข้อมูลสมุดรายชื่อเริ่มต้น (ตาราง business_partners) — ไม่ระบุ = เริ่มต้นด้วยรายการว่างเปล่า */
  contacts?: MockSeedContact[];
  /** รายการประวัติกระทบยอดที่มีอยู่ก่อนแล้ว (4 ตารางใหม่ของฟีเจอร์ save/history) — ไม่ระบุ = เริ่มต้นด้วย
   * รายการว่างเปล่า (พฤติกรรมเดิมของทุก seed ก่อนหน้านี้) */
  reconcileReports?: MockSeedReconcileReport[];
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

  // ประกอบ 4 ตารางของฟีเจอร์ "บันทึกประวัติการกระทบยอด" แยกไว้ก่อนสร้าง tables ด้านล่าง (ต่างจาก
  // pending_tax_invoices/business_partners ที่ map() ได้ในบรรทัดเดียวเพราะ report_id ของแถวลูก (match
  // groups/bank rows/gl rows) ต้องอ้างอิง id ที่สร้างให้ report แม่ตัวเดียวกัน จึงต้องวนแบบ forEach เก็บ id
  // ไว้ใช้ซ้ำ ไม่ใช่ map() แยกอิสระต่อกัน)
  const reconcileReportRows: Record<string, unknown>[] = [];
  const reconcileMatchGroupRows: Record<string, unknown>[] = [];
  const reconcileBankRowRows: Record<string, unknown>[] = [];
  const reconcileGlRowRows: Record<string, unknown>[] = [];

  (seed.reconcileReports ?? []).forEach((r) => {
    const reportId = r.id ?? genId();
    const bankRows = r.bankRows ?? [];
    const glRows = r.glRows ?? [];
    const matchGroups = r.matchGroups ?? [];

    reconcileReportRows.push({
      id: reportId,
      report_name: r.reportName,
      period_month: r.periodMonth,
      period_year: r.periodYear,
      status: r.status ?? 'draft',
      bank_file_name: r.bankFileName ?? null,
      gl_file_name: r.glFileName ?? null,
      tolerance_days: r.toleranceDays ?? 1,
      bank_row_count: bankRows.length,
      gl_row_count: glRows.length,
      matched_group_count: matchGroups.length,
      bank_unmatched_count: bankRows.filter((row) => !row.matchGroupId).length,
      gl_unmatched_count: glRows.filter((row) => !row.matchGroupId).length,
      created_by: r.createdBy ?? null,
      created_by_email: r.createdByEmail ?? null,
      created_at: nowISO(),
      updated_by: r.createdBy ?? null,
      updated_by_email: r.createdByEmail ?? null,
      updated_at: nowISO(),
    });

    matchGroups.forEach((g) => {
      reconcileMatchGroupRows.push({
        id: g.id,
        report_id: reportId,
        match_type: g.matchType,
        type: g.type,
        created_at: nowISO(),
      });
    });

    bankRows.forEach((row, index) => {
      reconcileBankRowRows.push({
        id: row.id ?? genId(),
        report_id: reportId,
        match_group_id: row.matchGroupId ?? null,
        row_order: row.rowOrder ?? index,
        transaction_date: row.date,
        type: row.type,
        amount: row.amount,
      });
    });

    glRows.forEach((row, index) => {
      reconcileGlRowRows.push({
        id: row.id ?? genId(),
        report_id: reportId,
        match_group_id: row.matchGroupId ?? null,
        row_order: row.rowOrder ?? index,
        document_no: row.documentNo ?? '',
        transaction_date: row.date,
        type: row.type,
        amount: row.amount,
      });
    });
  });

  const tables: {
    pending_tax_invoices: Record<string, unknown>[];
    business_partners: Record<string, unknown>[];
    bank_reconcile_reports: Record<string, unknown>[];
    bank_reconcile_match_groups: Record<string, unknown>[];
    bank_reconcile_bank_rows: Record<string, unknown>[];
    bank_reconcile_gl_rows: Record<string, unknown>[];
  } = {
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
      vendor_tax_id: inv.vendor_tax_id ?? null,
      tax_invoice_date: inv.tax_invoice_date ?? null,
      vat_claim_month: inv.vat_claim_month ?? null,
      vat_claim_year: inv.vat_claim_year ?? null,
      tax_type: inv.tax_type ?? null,
    })),
    // ตารางใหม่สำหรับฟีเจอร์ "สมุดรายชื่อ" — แยกจาก pending_tax_invoices โดยสิ้นเชิง (คนละ array คนละ
    // seed) ไม่กระทบการ seed/query ของ pending_tax_invoices เลย
    business_partners: (seed.contacts ?? []).map((c) => ({
      id: c.id ?? genId(),
      partner_type: c.partner_type,
      contact_code: c.contact_code,
      entity_type: c.entity_type,
      company_name: c.company_name ?? null,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      tax_id: c.tax_id ?? null,
      branch_type: c.branch_type ?? 'head_office',
      branch_number: c.branch_number ?? null,
      address: c.address ?? null,
      subdistrict: c.subdistrict ?? null,
      district: c.district ?? null,
      province: c.province ?? null,
      postal_code: c.postal_code ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      contact_person: c.contact_person ?? null,
      note: c.note ?? null,
      status: c.status ?? 'active',
      created_by: c.created_by ?? null,
      created_at: nowISO(),
      updated_at: nowISO(),
    })),
    // 4 ตารางของฟีเจอร์ "บันทึกประวัติการกระทบยอด" — ประกอบไว้แล้วด้านบน (ไม่ใช้ .map() ตรงนี้เพราะแถวลูก
    // ต้องอ้างอิง report_id ที่ผูกกับ report แม่ตัวเดียวกัน ดูคอมเมนต์ที่นิยาม reconcileReportRows)
    bank_reconcile_reports: reconcileReportRows,
    bank_reconcile_match_groups: reconcileMatchGroupRows,
    bank_reconcile_bank_rows: reconcileBankRowRows,
    bank_reconcile_gl_rows: reconcileGlRowRows,
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
    private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    private filters: [string, unknown][] = [];
    // array แทนที่จะเป็นค่าเดียว เพื่อรองรับการเรียง .order() ต่อกันหลายครั้ง (multi-column sort) เช่น
    // fetchReconcileReports() ที่เรียง period_year desc, period_month desc, updated_at desc พร้อมกัน — ค่า
    // แรกที่ push เข้ามาคือคีย์เรียงหลัก ค่าถัดไปใช้ตัดสินเมื่อค่าคีย์ก่อนหน้าเท่ากันเท่านั้น (ดู execute())
    private orderBy: { field: string; ascending: boolean }[] = [];
    private wantSingle = false;

    constructor(table: string) {
      this.table = table;
    }

    select() {
      return this;
    }

    // Supabase จริงรองรับทั้ง insert แถวเดียว (object) และ insert หลายแถวพร้อมกัน (array of object)
    // เช่นที่ bulkCreateInvoices() ใช้ตอน import จาก Excel — mock นี้ต้องรองรับทั้งสองแบบให้ตรงพฤติกรรมจริง
    insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
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

    // .is('deleted_at', null) ของ Supabase จริงใช้เช็ค IS NULL/IS NOT NULL/IS TRUE/IS FALSE โดยเฉพาะ (ต่างจาก
    // .eq() ที่ compile เป็น "= value" ธรรมดาซึ่งไม่ match NULL ใน SQL จริง) — mock นี้เทียบด้วย === ตรงๆ ก็ให้
    // ผลถูกต้องเหมือนกันสำหรับกรณีใช้งานจริงในระบบนี้ (เทียบกับ null/true/false ล้วนๆ ไม่มี case อื่น) จึงใช้
    // filter mechanism เดียวกับ eq() ได้เลยโดยไม่ต้องแยก logic ซ้ำ
    is(field: string, value: unknown) {
      this.filters.push([field, value]);
      return this;
    }

    order(field: string, opts?: { ascending?: boolean }) {
      this.orderBy.push({ field, ascending: opts?.ascending !== false });
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
        const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        const newRows = payloadRows.map((p) => {
          const newRow: Record<string, unknown> = {
            id: genId(),
            created_at: nowISO(),
            updated_at: nowISO(),
            // default 'pending' เฉพาะตาราง pending_tax_invoices เท่านั้น (พฤติกรรมเดิมทุกประการ) —
            // ตารางอื่น (เช่น business_partners ที่ใช้ status active/inactive) ไม่ใส่ default นี้ให้
            // เพราะผู้เรียก (lib/contactApi.ts) กำหนดค่า status ที่ถูกต้องมาเสมออยู่แล้ว
            ...(this.table === 'pending_tax_invoices' ? { status: 'pending' } : {}),
            ...p,
          };
          // total_amount คำนวณเฉพาะแถวที่มีฟิลด์ยอดเงินของใบกำกับภาษีจริงๆ เท่านั้น (กันไม่ให้ตารางอื่น
          // ที่ไม่มีฟิลด์นี้ เช่น business_partners ถูกใส่ total_amount: 0 ปนเข้าไปโดยไม่มีความหมาย)
          if ('amount_excl_vat' in newRow || 'vat_amount' in newRow) {
            const amount = Number(newRow.amount_excl_vat ?? 0);
            const vat = Number(newRow.vat_amount ?? 0);
            newRow.total_amount = round2(amount + vat);
          }
          return newRow;
        });
        rows.push(...newRows);
        return { data: this.wantSingle ? newRows[0] ?? null : newRows, error: null };
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
      if (this.orderBy.length > 0) {
        const orderBy = this.orderBy;
        result = [...result].sort((a, b) => {
          for (const { field, ascending } of orderBy) {
            const av = (a[field] ?? '') as string | number;
            const bv = (b[field] ?? '') as string | number;
            if (av < bv) return ascending ? -1 : 1;
            if (av > bv) return ascending ? 1 : -1;
          }
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

  // จำลอง Postgres function public.save_bank_reconcile_report(...) (supabase/migration_006_*.sql) — ต้อง
  // ให้พฤติกรรมตรงกับฟังก์ชันจริงเป๊ะๆ: สร้างใหม่เมื่อไม่มี id ส่งมา, บันทึกทับ (ลบลูกทั้งหมดของ report นั้น
  // แล้วแทรกชุดใหม่ทั้งหมด) เมื่อมี id ส่งมา, คำนวณคอลัมน์สรุป (bank_row_count ฯลฯ) จาก payload สดทุกครั้ง —
  // ไม่ generate id ให้ match_groups เอง (ใช้ id ที่ฝั่ง client ส่งมาตรงๆ เหมือนฟังก์ชันจริง เพราะ bank/gl
  // rows อ้างอิง match_group_id กลับมาที่ id นี้ภายใน payload เดียวกัน)
  function saveBankReconcileReport(params: Record<string, unknown> | undefined) {
    const p = (params ?? {}) as {
      p_report?: Record<string, unknown>;
      p_match_groups?: Record<string, unknown>[];
      p_bank_rows?: Record<string, unknown>[];
      p_gl_rows?: Record<string, unknown>[];
    };
    const report = p.p_report ?? {};
    const matchGroups = p.p_match_groups ?? [];
    const bankRows = p.p_bank_rows ?? [];
    const glRows = p.p_gl_rows ?? [];

    const bankUnmatchedCount = bankRows.filter((r) => !r.match_group_id).length;
    const glUnmatchedCount = glRows.filter((r) => !r.match_group_id).length;
    const summaryFields = {
      report_name: report.report_name ?? null,
      period_month: report.period_month ?? null,
      period_year: report.period_year ?? null,
      status: report.status ?? 'draft',
      bank_file_name: report.bank_file_name ?? null,
      gl_file_name: report.gl_file_name ?? null,
      tolerance_days: report.tolerance_days ?? 1,
      bank_row_count: bankRows.length,
      gl_row_count: glRows.length,
      matched_group_count: matchGroups.length,
      bank_unmatched_count: bankUnmatchedCount,
      gl_unmatched_count: glUnmatchedCount,
    };

    let reportId = (report.id as string | null | undefined) || null;

    if (!reportId) {
      reportId = genId();
      tables.bank_reconcile_reports.push({
        id: reportId,
        ...summaryFields,
        created_by: report.created_by ?? null,
        created_by_email: report.created_by_email ?? null,
        created_at: nowISO(),
        updated_by: report.updated_by ?? null,
        updated_by_email: report.updated_by_email ?? null,
        updated_at: nowISO(),
      });
    } else {
      const existing = tables.bank_reconcile_reports.find((r) => r.id === reportId);
      if (!existing) {
        return { data: null, error: { message: `ไม่พบรายการกระทบยอด id=${reportId}` } };
      }
      Object.assign(existing, summaryFields, {
        updated_by: report.updated_by ?? null,
        updated_by_email: report.updated_by_email ?? null,
        updated_at: nowISO(),
      });
      tables.bank_reconcile_match_groups = tables.bank_reconcile_match_groups.filter((g) => g.report_id !== reportId);
      tables.bank_reconcile_bank_rows = tables.bank_reconcile_bank_rows.filter((r) => r.report_id !== reportId);
      tables.bank_reconcile_gl_rows = tables.bank_reconcile_gl_rows.filter((r) => r.report_id !== reportId);
    }

    matchGroups.forEach((g) => {
      tables.bank_reconcile_match_groups.push({
        id: g.id,
        report_id: reportId,
        match_type: g.match_type,
        type: g.type,
        created_at: nowISO(),
      });
    });
    bankRows.forEach((r) => {
      tables.bank_reconcile_bank_rows.push({
        id: genId(),
        report_id: reportId,
        match_group_id: r.match_group_id ?? null,
        row_order: r.row_order,
        transaction_date: r.transaction_date,
        type: r.type,
        amount: r.amount,
      });
    });
    glRows.forEach((r) => {
      tables.bank_reconcile_gl_rows.push({
        id: genId(),
        report_id: reportId,
        match_group_id: r.match_group_id ?? null,
        row_order: r.row_order,
        document_no: r.document_no ?? '',
        transaction_date: r.transaction_date,
        type: r.type,
        amount: r.amount,
      });
    });

    const finalReport = tables.bank_reconcile_reports.find((r) => r.id === reportId) ?? null;
    return { data: finalReport, error: null };
  }

  const mockClient = {
    auth,
    from(table: string) {
      return new QueryBuilder(table);
    },
    async rpc(fnName: string, params?: Record<string, unknown>) {
      if (fnName === 'save_bank_reconcile_report') {
        // deep-clone ผลลัพธ์ก่อนคืนออกไปเสมอ เหตุผลเดียวกับ QueryBuilder.then() ด้านบน (กัน SWR/state
        // ฝั่ง client ถือ reference เดียวกับข้อมูลใน store แล้วเผลอ mutate ย้อนกลับมา)
        const result = saveBankReconcileReport(params);
        return { data: structuredClone(result.data), error: result.error };
      }
      return { data: null, error: { message: `Unknown rpc function: ${fnName}` } };
    },
  };

  // @ts-expect-error — window ไม่มี type ของ property นี้ในบริบทนี้ (self-contained script)
  window.__SUPABASE_CLIENT_OVERRIDE__ = mockClient;
}
