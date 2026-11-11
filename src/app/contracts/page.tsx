import Link from 'next/link';
import { ArrowRight, FileSearch, FileText } from 'lucide-react';

const reviewStages = ['Original agreement', 'Requested changes', 'Evidence and ambiguity'];

export default function ContractsPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Contract intelligence</p>
        <h1 className="mp-page-title mt-2">Contracts</h1>
        <p className="mp-copy mt-3 max-w-2xl">
          Keep the signed scope visible as proposed changes are examined against the original
          agreement.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(16rem,0.7fr)]">
        <section aria-labelledby="contract-register-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="contract-register-heading" className="text-lg font-semibold">
              Contract register
            </h2>
            <span className="text-sm text-mp-medium-grey">No records</span>
          </div>
          <div className="mp-empty-state flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
            <FileText size={25} className="text-mp-medium-grey" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold">No contract records available</h3>
            <p className="mp-copy mt-2 max-w-lg">
              Contract documents and analyses will appear here when the contract workflow is
              connected. No contract content is loaded in this workspace.
            </p>
            <Link
              href="/projects"
              className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 hover:text-mp-medium-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
            >
              Open projects <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <aside aria-labelledby="review-stages-heading" className="border-l-2 border-mp-orange pl-5">
          <div className="flex items-center gap-3">
            <FileSearch className="text-mp-orange" size={22} aria-hidden="true" />
            <h2 id="review-stages-heading" className="text-lg font-semibold">
              Review framework
            </h2>
          </div>
          <p className="mp-copy mt-3">
            A contract review should make each proposed change traceable to its source.
          </p>
          <ol className="mt-6">
            {reviewStages.map((stage, index) => (
              <li
                key={stage}
                className="flex gap-4 border-t border-mp-warm-grey py-4 last:border-b"
              >
                <span className="font-mono text-sm text-mp-medium-grey">
                  0{index + 1}
                </span>
                <span className="font-medium">{stage}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-mp-medium-grey">
            This describes the review approach; no analysis is currently attached to a contract.
          </p>
        </aside>
      </div>
    </section>
  );
}
