import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness } from 'lucide-react';

export default function ProjectsPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Engagements</p>
          <h1 className="mp-page-title mt-2">Projects</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            A workspace for service agreements and the work they define.
          </p>
        </div>
        <p className="text-sm text-mp-medium-grey">Project records are not connected yet.</p>
      </header>

      <div className="mp-empty-state flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center border border-mp-warm-grey bg-mp-app-bg text-mp-ink">
          <BriefcaseBusiness size={24} aria-hidden="true" />
        </div>
        <p className="mp-kicker">Project register</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">No projects to show</h2>
        <p className="mp-copy mt-2 max-w-lg">
          Projects will appear here when project records are available. The workspace does not
          currently contain project data.
        </p>
        <Link
          href="/contracts"
          className="mt-6 inline-flex min-h-10 items-center gap-2 border border-mp-warm-grey bg-mp-surface px-4 text-sm font-semibold text-mp-ink hover:border-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-orange"
        >
          View contracts <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
