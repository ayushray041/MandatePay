import Link from 'next/link';
import { ArrowRight, Check, CircleDot, MessagesSquare } from 'lucide-react';

const stages = [
  {
    name: 'Mandate set',
    detail: 'Define the boundaries an agent may negotiate within.',
  },
  {
    name: 'Terms exchanged',
    detail: 'Client-side and freelancer-side proposals are compared.',
  },
  {
    name: 'Agreement reached',
    detail: 'A final proposal is prepared for human review.',
  },
  {
    name: 'Both parties approve',
    detail: 'The approved terms are ready to become an amendment.',
  },
];

export default function NegotiationsPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Agent-to-agent commerce</p>
          <h1 className="mp-page-title mt-2">Negotiations</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            A bounded process for proposals, counter-proposals, and human approval.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start border border-mp-warm-grey bg-mp-surface px-3 py-1.5 text-sm text-mp-medium-grey sm:self-auto">
          <CircleDot size={15} aria-hidden="true" />
          No negotiation records
        </span>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)]">
        <section aria-labelledby="negotiation-timeline-heading">
          <div className="mb-5 flex items-center gap-3">
            <MessagesSquare size={21} className="text-mp-orange" aria-hidden="true" />
            <h2 id="negotiation-timeline-heading" className="text-lg font-semibold">
              Negotiation sequence
            </h2>
          </div>
          <ol className="border-y border-mp-warm-grey bg-mp-surface">
            {stages.map((stage, index) => (
              <li key={stage.name} className="grid grid-cols-[2rem_1fr] gap-4 border-b border-mp-warm-grey p-5 last:border-0">
                <span className="flex h-8 w-8 items-center justify-center border border-mp-warm-grey font-mono text-sm text-mp-medium-grey">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{stage.name}</h3>
                  <p className="mp-copy mt-1 text-sm">{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-mp-medium-grey">
            Process outline only — no live negotiation activity is available.
          </p>
        </section>

        <aside className="border-l-2 border-mp-orange pl-5">
          <p className="mp-kicker">Operating boundary</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Private mandates</h2>
          <p className="mp-copy mt-3">
            The product brief describes a maximum of five negotiation rounds and separate private
            mandates for each side. The negotiation service is not implemented yet.
          </p>
          <div className="mt-6 flex items-start gap-3 border-t border-mp-warm-grey pt-4 text-sm">
            <Check size={18} className="mt-0.5 shrink-0 text-mp-orange" aria-hidden="true" />
            <p className="text-mp-medium-grey">
              Human agreement remains a distinct step before amendment and payment.
            </p>
          </div>
          <Link
            href="/contracts"
            className="mt-6 inline-flex min-h-10 items-center gap-2 font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 hover:text-mp-medium-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
          >
            View contracts <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </section>
  );
}
