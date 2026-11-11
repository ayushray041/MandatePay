import React from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

// Demo contract data
const originalContract = `
Agreement between Acme Corp (Client) and John Doe (Freelancer).
Scope: Design a responsive website.
Deliverables: Home page, About page, Contact page.
Payment: $2000 upon completion.
`; 

const clientRequest = `Please add a blog section with SEO optimization and increase the total pages to 6.`;

// Dummy analysis result
const analysis = {
  added: ['Blog section', 'SEO optimization'],
  modified: ['Total pages increased from 3 to 6'],
  removed: [],
  alreadyIncluded: ['Home page', 'About page', 'Contact page'],
  ambiguous: ['SEO optimization details'],
  evidence: ['Line 12 of original contract mentions "responsive website"', 'Line 8 mentions "Deliverables"'],
};

export default function ContractsPage() {
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contract Intelligence</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title="Original Contract"
          value={<textarea readOnly rows={10} className="w-full p-2 border rounded" defaultValue={originalContract} />}
        />
        <Card
          title="Client Change Request"
          value={<textarea readOnly rows={10} className="w-full p-2 border rounded" defaultValue={clientRequest} />}
        />
      </div>
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-100">Scope‑Change Analysis</h2>
        <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
          <li><strong>Added:</strong> {analysis.added.join(', ')}</li>
          <li><strong>Modified:</strong> {analysis.modified.join(', ')}</li>
          <li><strong>Removed:</strong> {analysis.removed.length ? analysis.removed.join(', ') : 'None'}</li>
          <li><strong>Already Included:</strong> {analysis.alreadyIncluded.join(', ')}</li>
          <li><strong>Ambiguous:</strong> {analysis.ambiguous.join(', ')}</li>
        </ul>
        <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-100">Evidence</h3>
        <ul className="list-disc list-inside ml-4 text-gray-600 dark:text-gray-400">
          {analysis.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button variant="primary">Approve Changes</Button>
          <Button variant="secondary">Reject / Edit</Button>
        </div>
      </div>
    </section>
  );
}
