import React from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

// Demo project data
const projects = [
  {
    id: '1',
    title: 'Website Redesign',
    status: 'In Progress',
    priceCents: 250000,
    client: 'Acme Corp',
    freelancer: 'John Doe',
  },
  {
    id: '2',
    title: 'Mobile App MVP',
    status: 'Pending Review',
    priceCents: 500000,
    client: 'Beta Ltd',
    freelancer: 'Jane Smith',
  },
];

export default function ProjectsPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
      <div className="flex flex-col space-y-4">
        <input
          type="text"
          placeholder="Search projects…"
          className="p-2 border rounded w-full max-w-md"
          disabled
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((p) => (
            <Card
              key={p.id}
              title={p.title}
              value={
                <div className="space-y-2 text-sm">
                  <p>Status: {p.status}</p>
                  <p>Price: ${(p.priceCents / 100).toFixed(2)}</p>
                  <p>Client: {p.client}</p>
                  <p>Freelancer: {p.freelancer}</p>
                  <Button variant="secondary" className="mt-2">View Project</Button>
                </div>
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}
