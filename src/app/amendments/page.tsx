import React from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';

// Demo amendment data
const amendment = {
  version: 2,
  changes: {
    priceCents: 2500,
    deliverables: ['Home page', 'About page', 'Contact page', 'Blog section'],
    revisions: 5,
    timeline: '3 weeks',
  },
  approvals: {
    client: true,
    freelancer: false,
  },
};

export default function AmendmentsPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contract Amendments</h1>
      <Card
        title={`Amendment v${amendment.version}`}
        value={
          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
            <p><strong>Price change:</strong> ${(amendment.changes.priceCents / 100).toFixed(2)}</p>
            <p><strong>Deliverables:</strong> {amendment.changes.deliverables.join(', ')}</p>
            <p><strong>Revisions:</strong> {amendment.changes.revisions}</p>
            <p><strong>Timeline:</strong> {amendment.changes.timeline}</p>
            <div className="flex space-x-2">
              <Badge variant="success">Client {amendment.approvals.client ? 'Approved' : 'Pending'}</Badge>
              <Badge variant="warning">Freelancer {amendment.approvals.freelancer ? 'Approved' : 'Pending'}</Badge>
            </div>
          </div>
        }
      />
      <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">Version History</h2>
      <Table
        headers={['Version', 'Price', 'Deliverables', 'Revisions', 'Timeline', 'Client', 'Freelancer']}
        rows={[
          [1, '$2000.00', 'Home, About, Contact', 3, '2 weeks', '✅', '✅'],
          [2, `$${(amendment.changes.priceCents / 100).toFixed(2)}`, amendment.changes.deliverables.join(', '), amendment.changes.revisions, amendment.changes.timeline, amendment.approvals.client ? '✅' : '⌛', amendment.approvals.freelancer ? '✅' : '⌛'],
        ]}
      />
    </section>
  );
}
