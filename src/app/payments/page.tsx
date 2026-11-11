import React from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';

// Demo summary data (cents are converted to dollars for display)
const summary = {
  totalTransactions: 5,
  authorizedCents: 350000, // $3,500.00
  capturedCents: 300000, // $3,000.00
  pendingCents: 50000, // $500.00
};

// Demo transaction list
const transactions = [
  {
    id: 'TX001',
    project: 'Website Redesign',
    buyer: 'Acme Corp',
    amountCents: 250000,
    orderId: 'ORD-12345',
    authStatus: 'AUTHORIZED',
    captureStatus: 'CAPTURED',
  },
  {
    id: 'TX002',
    project: 'Mobile App MVP',
    buyer: 'Beta Ltd',
    amountCents: 50000,
    orderId: 'ORD-67890',
    authStatus: 'APPROVED',
    captureStatus: 'AUTHORIZED',
  },
  {
    id: 'TX003',
    project: 'Logo Design',
    buyer: 'Gamma Studios',
    amountCents: 30000,
    orderId: 'ORD-11223',
    authStatus: 'CREATED',
    captureStatus: 'FAILED',
  },
  {
    id: 'TX004',
    project: 'Content Writing',
    buyer: 'Delta Media',
    amountCents: 20000,
    orderId: 'ORD-44556',
    authStatus: 'VOIDED',
    captureStatus: 'VOIDED',
  },
  {
    id: 'TX005',
    project: 'SEO Optimization',
    buyer: 'Epsilon LLC',
    amountCents: 50000,
    orderId: 'ORD-77889',
    authStatus: 'APPROVED',
    captureStatus: 'PENDING', // custom status for demo
  },
];

// Helper to format cents → $d.cc
const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Map badge variant per status
const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  CREATED: 'info',
  APPROVED: 'info',
  AUTHORIZED: 'success',
  CAPTURED: 'success',
  VOIDED: 'warning',
  FAILED: 'danger',
  PENDING: 'info',
};

export default function PaymentsPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Total Transactions" value={summary.totalTransactions} />
        <Card title="Authorized Amount" value={formatCents(summary.authorizedCents)} />
        <Card title="Captured Amount" value={formatCents(summary.capturedCents)} />
        <Card title="Pending Payments" value={formatCents(summary.pendingCents)} />
      </div>

      {/* Transactions table */}
      <Table
        headers={[
          'Transaction ID',
          'Project',
          'Buyer',
          'Amount',
          'PayPal Order ID',
          'Auth Status',
          'Capture Status',
        ]}
        rows={transactions.map((t) => [
          t.id,
          t.project,
          t.buyer,
          formatCents(t.amountCents),
          t.orderId,
          <Badge variant={statusVariant[t.authStatus] || 'info'}>{t.authStatus}</Badge>,
          <Badge variant={statusVariant[t.captureStatus] || 'info'}>{t.captureStatus}</Badge>,
        ])}
      />

      {/* Transaction detail placeholder */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-100">Transaction Detail (Demo)</h2>
        <p className="text-gray-700 dark:text-gray-300">
          Select a transaction to view full details. (Static placeholder showing first transaction.)
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
{JSON.stringify(transactions[0], null, 2)}
        </pre>
      </div>
    </section>
  );
}
