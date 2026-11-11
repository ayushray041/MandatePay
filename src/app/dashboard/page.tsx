import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, FileText, Wallet } from 'lucide-react';

const destinations = [
  {
    href: '/projects',
    label: 'Projects',
    description: 'View project workspace',
    icon: BriefcaseBusiness,
  },
  {
    href: '/contracts',
    label: 'Contracts',
    description: 'Review contract workspace',
    icon: FileText,
  },
  {
    href: '/payments',
    label: 'Payments',
    description: 'Review payment records',
    icon: Wallet,
  },
];

export default function DashboardPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-10">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Workspace</p>
        <h1 className="mp-page-title mt-2">Overview</h1>
        <p className="mp-copy mt-3 max-w-2xl">
          Review your projects, agreements, negotiations, and payment activity.
        </p>
      </header>

      <section aria-labelledby="activity-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="mp-kicker">Current workspace</p>
            <h2 id="activity-heading" className="mt-1 text-xl font-semibold tracking-tight">
              Recent activity
            </h2>
          </div>
        </div>
        <div className="mp-empty-state flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey">
            <BriefcaseBusiness size={21} aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold">No workspace activity yet</h3>
          <p className="mp-copy mt-2 max-w-lg">
            Activity will appear here when project and transaction records are connected. No
            activity records are currently available.
          </p>
        </div>
      </section>

      <nav aria-label="Workspace sections" className="border-y border-mp-warm-grey">
        {destinations.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-16 items-center gap-4 border-b border-mp-warm-grey bg-mp-surface px-4 last:border-0 hover:bg-mp-app-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange sm:px-6"
          >
            <Icon className="shrink-0 text-mp-orange" size={20} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-mp-medium-grey">{description}</span>
            </span>
            <ArrowRight
              className="shrink-0 text-mp-medium-grey transition-transform group-hover:translate-x-1"
              size={18}
              aria-hidden="true"
            />
          </Link>
        ))}
      </nav>
    </section>
  );
}
