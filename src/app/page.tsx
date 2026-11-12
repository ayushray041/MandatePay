import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  FileCheck2,
  FileText,
  Fingerprint,
  History,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Create a mandate',
    description: 'Set clear boundaries for budget, scope, and the terms an agent may negotiate.',
    icon: LockKeyhole,
  },
  {
    number: '02',
    title: 'Negotiate',
    description: 'Let client-side and freelancer-side agents work toward terms within those boundaries.',
    icon: Scale,
  },
  {
    number: '03',
    title: 'Approve',
    description: 'Review the proposed amendment and give each party a chance to approve it.',
    icon: FileCheck2,
  },
  {
    number: '04',
    title: 'Execute payment',
    description: 'Authorize payment against the approved agreement, with capture tied to fulfillment.',
    icon: Banknote,
  },
];

const capabilities = [
  {
    title: 'Programmable mandates',
    description: 'Define the budget and terms an agent is allowed to discuss on your behalf.',
    icon: Workflow,
  },
  {
    title: 'AI negotiation',
    description: 'Give each side an agent to explore options and find workable terms.',
    icon: Scale,
  },
  {
    title: 'Contract management',
    description: 'Keep original agreements, proposed changes, and approved amendments connected.',
    icon: FileText,
  },
  {
    title: 'Payment authorization',
    description: 'Connect an approved agreement to an authorized payment flow.',
    icon: Banknote,
  },
  {
    title: 'Transaction history',
    description: 'Follow the agreement and payment lifecycle in one place.',
    icon: History,
  },
];

const safeguards = [
  {
    title: 'Verified identity',
    description: 'Firebase ID tokens are verified on protected API routes.',
    icon: Fingerprint,
  },
  {
    title: 'Scoped access',
    description: 'Server-side checks scope access to owners, authorized agents, and contract participants.',
    icon: LockKeyhole,
  },
  {
    title: 'Auditable transactions',
    description: 'Payment status and events are recorded per transaction; a cross-workspace audit log is not available yet.',
    icon: History,
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-20 pb-12 sm:space-y-28">
      <section className="overflow-hidden bg-mp-ink px-6 py-14 text-white sm:px-10 sm:py-20 lg:px-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 border border-mp-medium-grey px-3 py-1.5 text-sm text-mp-app-bg">
              <span className="h-2 w-2 bg-mp-orange" />
              A clearer way to agree and pay
            </p>
            <h1 className="mp-display text-white">
              The infrastructure for agent-to-agent commerce.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-mp-app-bg">
              Agents can discover services and negotiate terms, then connect approved agreements
              to sandbox payment flows. MandatePay keeps people in control of approvals and
              payment authorization.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-mp-orange px-5 font-semibold text-mp-ink transition-colors hover:bg-mp-surface"
              >
                Get Started <ArrowRight size={18} />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-mp-medium-grey px-5 font-semibold text-white transition-colors hover:bg-mp-medium-grey"
              >
                Explore Dashboard <ArrowUpRight size={18} />
              </Link>
            </div>
            <p className="mt-5 text-sm text-mp-warm-grey">
              Human approval stays part of the process.
            </p>
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="border border-mp-warm-grey bg-mp-surface p-5 text-mp-ink sm:p-6">
              <div className="flex items-center justify-between border-b border-mp-warm-grey pb-4">
                <div>
                  <p className="text-sm font-medium text-mp-medium-grey">Agreement flow</p>
                  <p className="mt-1 text-lg font-semibold">From terms to payment</p>
                </div>
                <div className="bg-mp-orange p-3 text-white">
                  <Workflow size={24} />
                </div>
              </div>
              <div className="space-y-3 pt-4">
                {steps.map((step) => {
                  const Icon = step.icon;

                  return (
                    <div
                      key={step.number}
                      className="flex items-start gap-4 border-b border-mp-warm-grey py-3.5 last:border-0"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-mp-app-bg text-mp-ink">
                        <Icon size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{step.title}</p>
                        <p className="mt-0.5 text-sm text-mp-medium-grey">{step.description}</p>
                      </div>
                      <span className="text-xs font-medium text-mp-medium-grey">{step.number}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <a
          href="#how-it-works"
          className="mt-12 inline-flex items-center gap-2 text-sm text-mp-warm-grey transition-colors hover:text-white"
        >
          Discover how it works <ArrowDown size={16} />
        </a>
      </section>

      <section id="how-it-works" className="scroll-mt-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mp-kicker">A deliberate process</p>
          <h2 className="mp-section-title mt-3 text-mp-ink">How it works</h2>
          <p className="mp-copy mt-4">
            Keep the rules clear, the negotiation bounded, and the payment connected to an
            approved agreement.
          </p>
        </div>
        <ol className="mt-10 grid gap-0 border-y border-mp-warm-grey sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => {
            const Icon = step.icon;

            return (
              <li
                key={step.number}
                className="border-b border-mp-warm-grey bg-mp-surface p-6 last:border-b-0 sm:border-r sm:last:border-r-0 xl:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-mp-orange">
                    STEP {step.number}
                  </span>
                  <Icon className="text-mp-medium-grey" size={21} />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-mp-ink">
                  {step.title}
                </h3>
                <p className="mp-copy mt-2">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="mp-kicker">One connected workflow</p>
            <h2 className="mp-section-title mt-3 text-mp-ink">
              Built around the full commerce lifecycle
            </h2>
          </div>
          <p className="mp-copy max-w-md">
            MandatePay is designed to connect the rules, negotiation, contract changes, and payment
            authorization in a single workflow.
          </p>
        </div>
        <div className="mt-9 grid border-y border-mp-warm-grey sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="border-b border-mp-warm-grey bg-mp-surface p-6 last:border-b-0 sm:odd:border-r lg:border-r lg:nth-[3n]:border-r-0"
              >
                <div className="mb-5 inline-flex bg-mp-app-bg p-3 text-mp-ink">
                  <Icon size={22} />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-mp-ink">
                  {feature.title}
                </h3>
                <p className="mp-copy mt-2">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-mp-warm-grey bg-mp-app-bg py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <div className="inline-flex bg-mp-surface p-3 text-mp-orange">
              <ShieldCheck size={24} />
            </div>
            <p className="mp-kicker mt-5">Security foundations</p>
            <h2 className="mp-section-title mt-3 text-mp-ink">
              Trust should be part of the flow.
            </h2>
            <p className="mp-copy mt-4">
              Identity checks are implemented across protected APIs, with server-side access
              scoped to the relevant owners, agents, and contract participants. A cross-workspace
              audit log is not available yet.
            </p>
          </div>
          <div className="grid gap-4">
            {safeguards.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="mp-panel flex gap-4 p-5"
                >
                  <div className="mt-0.5 shrink-0 text-mp-orange">
                    <Icon size={21} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-mp-ink">{item.title}</h3>
                    <p className="mp-copy mt-1">
                      {item.description}
                    </p>
                  </div>
                  {item.title === 'Verified identity' ? (
                    <BadgeCheck
                      aria-label="Implemented for profile API"
                      className="ml-auto mt-0.5 shrink-0 text-mp-orange"
                      size={19}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-mp-orange px-6 py-12 text-center text-mp-ink sm:px-10 sm:py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.18em]">
          Move from discussion to agreement
        </p>
        <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          Give every negotiation a clear path to payment.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl leading-7">
          Start with the people, terms, and approvals that make an agreement yours.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 bg-mp-ink px-5 font-semibold text-white transition-colors hover:bg-mp-medium-grey"
        >
          Get Started <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
