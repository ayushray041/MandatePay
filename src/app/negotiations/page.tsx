import React from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

// Mock negotiation data
const rounds = [
  { round: 1, client: 'Offer: $2000, 5 revisions', freelancer: 'Counter: $2500, 3 revisions' },
  { round: 2, client: 'Offer: $2200, 5 revisions', freelancer: 'Counter: $2400, 3 revisions' },
  { round: 3, client: 'Final Offer: $2300, 5 revisions', freelancer: 'Accepted' },
];

export default function NegotiationsPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Negotiation Deal Room</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Client AI panel */}
        <Card
          title="Client AI Agent"
          value={
            <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <p>Proposed price: $2300</p>
              <p>Deliverables: 5 pages, SEO</p>
              <p>Revisions: 5</p>
              <p>Timeline: 2 weeks</p>
            </div>
          }
        />
        {/* Freelancer AI panel */}
        <Card
          title="Freelancer AI Agent"
          value={
            <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <p>Proposed price: $2300</p>
              <p>Deliverables: 5 pages, SEO</p>
              <p>Revisions: 5</p>
              <p>Timeline: 2 weeks</p>
            </div>
          }
        />
      </div>
      <div className="mt-4">
        <h2 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Negotiation Transcript</h2>
        <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded overflow-x-auto text-sm text-gray-800 dark:text-gray-200">
{rounds.map(r => `Round ${r.round}:\n  Client: ${r.client}\n  Freelancer: ${r.freelancer}\n`).join('\n')}
        </pre>
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="primary">Accept Final Offer</Button>
        <Button variant="secondary">Reject / Counter</Button>
        <Button variant="ghost">Stress Test</Button>
      </div>
    </section>
  );
}
