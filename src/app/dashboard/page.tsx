import React from 'react';
import { Card } from '@/components/ui/Card';

// Simple demo data
const stats = {
  projects: 12,
  pendingRequests: 3,
  negotiations: 5,
  payments: 8,
};

export default function DashboardPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Active Projects" value={stats.projects} />
        <Card title="Pending Change Requests" value={stats.pendingRequests} />
        <Card title="Active Negotiations" value={stats.negotiations} />
        <Card title="Payments Overview" value={stats.payments} />
      </div>
      <section>
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-100">Recent Activity</h2>
        <ul className="space-y-2 list-disc list-inside text-gray-700 dark:text-gray-300">
          <li>Project Alpha scope change submitted.</li>
          <li>Negotiation round 3 completed for Project Beta.</li>
          <li>Payment authorized for Amendment #4.</li>
        </ul>
      </section>
    </section>
  );
}
