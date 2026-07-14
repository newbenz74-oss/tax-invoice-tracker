'use client';

import { useState } from 'react';
import type { PendingTaxInvoice, SortDirection, SortField } from '@/types/invoice';
import {
  AGING_BADGE_CLASS,
  AGING_LABELS,
  STATUS_LABELS,
  getAgingBucket,
} from '@/lib/invoiceLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface InvoiceTableProps {
  invoices: PendingTaxInvoice[];
  today: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField) => void;
  onEdit: (invoice: PendingTaxInvoice) => void;
  onMarkReceived: (invoice: PendingTaxInvoice, taxInvoiceNumber: string, receivedDate: string) => Promise<void>;
  onCancelInvoice: (invoice: PendingTaxInvoice) => Promise<void>;
  onDelete: (invoice: PendingTaxInvoice) => Promise<void>;
}

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'vendor_name', label: 'ผู้ขาย' },
  { field: 'transaction_date', label: 'วันที่ทำรายการ' },
  { field: 'total_amount', label: 'ยอดรวม' },
  { field: 'expected_date', label: 'คาดว่าจะได้รับ' },
];

export default function InvoiceTable({
  invoices,
  today,
  sortField,
  sortDirection,
  onSortChange,
  onEdit,
  onMarkReceived,
  onCancelInvoice,
  onDelete,
}: InvoiceTableProps) {
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleConfirmReceived(invoice: PendingTaxInvoice) {
    if (!taxInvoiceNumber.trim()) return;
    setBusyId(invoice.id);
    try {
      await onMarkReceived(invoice, taxInvoiceNumber.trim(), receivedDate);
      setReceivingId(null);
      setTaxInvoiceNumber('');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteClick(invoice: PendingTaxInvoice) {
    if (confirmingDeleteId !== invoice.id) {
      setConfirmingDeleteId(invoice.id);
      return;
    }
    setBusyId(invoice.id);
    try {
      await onDelete(invoice);
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
        ไม่พบรายการ
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.field}
                onClick={() => onSortChange(col.field)}
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold text-gray-500 hover:text-gray-700"
                data-testid={`sort-${col.field}`}
              >
                {col.label}
                {sortField === col.field && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
              </th>
            ))}
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่อ้างอิง</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">สถานะ / Aging</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((invoice) => {
            const bucket = getAgingBucket(invoice.expected_date, invoice.status, today);
            const isReceiving = receivingId === invoice.id;
            const isBusy = busyId === invoice.id;
            return (
              <tr key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{invoice.vendor_name}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(invoice.transaction_date)}</td>
                <td className="px-4 py-3 text-gray-900">{THB.format(invoice.total_amount)}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(invoice.expected_date)}</td>
                <td className="px-4 py-3 text-gray-600">{invoice.reference_no || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="inline-block w-fit rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {STATUS_LABELS[invoice.status]}
                    </span>
                    {invoice.status === 'pending' && (
                      <span
                        className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs ${AGING_BADGE_CLASS[bucket]}`}
                        data-testid={`aging-badge-${invoice.id}`}
                      >
                        {AGING_LABELS[bucket]}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {isReceiving ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <input
                        placeholder="เลขที่ใบกำกับภาษี"
                        value={taxInvoiceNumber}
                        onChange={(e) => setTaxInvoiceNumber(e.target.value)}
                        className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        data-testid={`tax-invoice-number-input-${invoice.id}`}
                      />
                      <input
                        type="date"
                        value={receivedDate}
                        onChange={(e) => setReceivedDate(e.target.value)}
                        className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setReceivingId(null);
                            setTaxInvoiceNumber('');
                          }}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={!taxInvoiceNumber.trim() || isBusy}
                          onClick={() => handleConfirmReceived(invoice)}
                          className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          data-testid={`confirm-received-${invoice.id}`}
                        >
                          ยืนยัน
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {invoice.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setReceivingId(invoice.id);
                              setTaxInvoiceNumber('');
                              setReceivedDate(today);
                            }}
                            className="rounded-md border border-green-300 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                            data-testid={`mark-received-${invoice.id}`}
                          >
                            ได้รับแล้ว
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onCancelInvoice(invoice)}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
                          >
                            ยกเลิกรายการ
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onEdit(invoice)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        data-testid={`edit-${invoice.id}`}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteClick(invoice)}
                        onBlur={() => setConfirmingDeleteId(null)}
                        className={`rounded-md border px-2 py-1 text-xs font-medium ${
                          confirmingDeleteId === invoice.id
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-red-300 text-red-600 hover:bg-red-50'
                        }`}
                        data-testid={`delete-${invoice.id}`}
                      >
                        {confirmingDeleteId === invoice.id ? 'ยืนยันลบ?' : 'ลบ'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
