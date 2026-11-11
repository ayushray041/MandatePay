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
    description: 'Firebase ID tokens are verified on the authenticated profile API.',
    icon: Fingerprint,
  },
  {
    title: 'Scoped access',
    description: 'Profile reads and updates use the UID from the verified token. Broader project permissions are not implemented yet.',
    icon: LockKeyhole,
  },
  {
    title: 'Auditable transactions',
    description: 'Payment traceability is part of the product design; transaction audit logging is not implemented yet.',
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
              AI agents can discover services, negotiate terms, and execute authorized payments.
              MandatePay brings the agreement and payment flow together, with people in control of
              the final approval.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-mp-orange px-5 font-semibold text-white transition-colors hover:bg-mp-surface hover:text-mp-ink"
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
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              One connected workflow
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              Built around the full commerce lifecycle
            </h2>
          </div>
          <p className="max-w-md leading-7 text-gray-600 dark:text-gray-300">
            Bring the rules, conversation, contract changes, and payment authorization into a
            shared workflow.
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((feature) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="mb-5 inline-flex rounded-xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Icon size={22} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="mt-2 leading-6 text-gray-600 dark:text-gray-300">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-gray-100/80 p-6 dark:border-gray-700 dark:bg-gray-800/70 sm:p-10">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <div className="inline-flex rounded-xl bg-white p-3 text-emerald-700 shadow-sm dark:bg-gray-900 dark:text-emerald-300">
              <ShieldCheck size={24} />
            </div>
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              Security foundations
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              Trust should be part of the flow.
            </h2>
            <p className="mt-4 leading-7 text-gray-600 dark:text-gray-300">
              MandatePay is being built around verified identity and explicit approval. The
              security details below reflect what is implemented today.
            </p>
          </div>
          <div className="grid gap-4">
            {safeguards.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="flex gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/60"
                >
                  <div className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400">
                    <Icon size={21} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                    <p className="mt-1 leading-6 text-gray-600 dark:text-gray-300">
                      {item.description}
                    </p>
                  </div>
                  {item.title === 'Verified identity' ? (
                    <BadgeCheck
                      aria-label="Implemented"
                      className="ml-auto mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      size={19}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl bg-emerald-600 px-6 py-12 text-center text-white sm:px-10 sm:py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100">
          Move from discussion to agreement
        </p>
        <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          Give every negotiation a clear path to payment.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-emerald-50">
          Start with the people, terms, and approvals that make an agreement yours.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 font-semibold text-emerald-800 transition-colors hover:bg-emerald-50"
        >
          Get Started <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
