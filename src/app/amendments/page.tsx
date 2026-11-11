import Link from 'next/link';
import { ArrowRight, FileCheck2, GitBranch, Handshake } from 'lucide-react';

const reviewPoints = [
  {
    title: 'Review the proposed terms',
    detail: 'Compare the amendment with the existing agreement.',
    icon: FileCheck2,
  },
  {
    title: 'Record both approvals',
    detail: 'Client and freelancer approval are separate requirements.',
    icon: Handshake,
  },
  {
    title: 'Keep versions connected',
    detail: 'Preserve an amendment history alongside its negotiation.',
    icon: GitBranch,
  },
];

export default function AmendmentsPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Contract lifecycle</p>
        <h1 className="mp-page-title mt-2">Amendments</h1>
        <p className="mp-copy mt-3 max-w-2xl">
          Review proposed changes and preserve each approved version with its agreement.
        </p>
      </header>

      <section aria-labelledby="amendment-register-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mp-kicker">Amendment register</p>
            <h2 id="amendment-register-heading" className="mt-1 text-xl font-semibold">
              Version history
            </h2>
          </div>
          <span className="border border-mp-warm-grey px-3 py-1 text-sm text-mp-medium-grey">
            No amendment records
          </span>
        </div>
        <div className="mp-empty-state flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <FileCheck2 size={26} className="text-mp-medium-grey" aria-hidden="true" />
          <h3 className="mt-4 text-lg font-semibold">No amendments are available</h3>
          <p className="mp-copy mt-2 max-w-lg">
            Approved contract changes will be listed here once negotiation and amendment
            persistence are connected. This workspace has no version records yet.
          </p>
        </div>
      </section>

      <section aria-labelledby="review-path-heading">
        <div className="mb-4">
          <p className="mp-kicker">Review path</p>
          <h2 id="review-path-heading" className="mt-1 text-xl font-semibold">
            Keep approval explicit
          </h2>
        </div>
        <ol className="grid border-y border-mp-warm-grey bg-mp-surface md:grid-cols-3">
          {reviewPoints.map(({ title, detail, icon: Icon }, index) => (
            <li
              key={title}
              className="border-b border-mp-warm-grey p-5 last:border-0 md:border-b-0 md:border-r md:last:border-r-0"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-mp-medium-grey">0{index + 1}</span>
                <Icon size={20} className="text-mp-orange" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mp-copy mt-1 text-sm">{detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-mp-medium-grey">
          These are review principles, not approval actions available in the current build.
        </p>
        <Link
          href="/negotiations"
          className="mt-5 inline-flex min-h-10 items-center gap-2 font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 hover:text-mp-medium-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
        >
          View negotiations <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </section>
  );
}
