'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/components/providers/AuthProvider';
import { formatMinorAmount } from '@/lib/mandates/money';
import { listMandates } from '@/lib/mandates/client';
import { type MandateRecord, type MandateStatus } from '@/models/mandate';

const statusStyles: Record<MandateStatus, string> = {
  draft: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  active: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  paused: 'border-amber-700 bg-amber-50 text-amber-900',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  revoked: 'border-red-700 bg-red-50 text-red-800',
};

function spendingPercent(mandate: MandateRecord): number {
  return Math.min(
    100,
    Math.round((mandate.spentAmountMinor / mandate.spendingLimitMinor) * 100),
  );
}

export function MandateList() {
  const { user } = useAuth();
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMandates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMandates(await listMandates());
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Mandates could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listMandates()
      .then((result) => {
        if (active) {
          setMandates(result);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Mandates could not be loaded.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Delegated authority</p>
          <h1 className="mp-page-title mt-2">Mandates</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Define what an authorized agent may do, within which dates, and under what spending
            and approval limits.
          </p>
        </div>
        <Link
          href="/mandates/new"
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start bg-mp-orange px-4 text-sm font-semibold text-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mp-orange sm:self-auto"
        >
          <Plus size={17} aria-hidden="true" />
          Create mandate
        </Link>
      </header>

      {loading ? (
        <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
          Loading mandates…
        </p>
      ) : error ? (
        <div className="mp-empty-state px-6 py-10" role="alert">
          <p className="font-semibold">Mandates could not be loaded</p>
          <p className="mp-copy mt-2">{error}</p>
          <Button type="button" onClick={() => void loadMandates()} className="mt-4">
            Try again
          </Button>
        </div>
      ) : mandates.length === 0 ? (
        <div className="mp-empty-state flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
          <ShieldCheck size={26} className="text-mp-orange" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold">No mandates yet</h2>
          <p className="mp-copy mt-2 max-w-lg">
            Create a mandate to define an agent’s permitted operations, spending authority, and
            approval rules. No sample mandates are shown.
          </p>
          <Link
            href="/mandates/new"
            className="mt-5 inline-flex min-h-10 items-center gap-2 font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4"
          >
            Create a mandate <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {mandates.map((mandate) => {
            const percent = spendingPercent(mandate);
            const isOwner = mandate.ownerId === user?.uid;

            return (
              <article
                key={mandate.id}
                className="border border-mp-warm-grey bg-mp-surface p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold">{mandate.title}</h2>
                      <span className={`border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${statusStyles[mandate.status]}`}>
                        {mandate.status}
                      </span>
                      <span className="text-xs text-mp-medium-grey">
                        {isOwner ? 'Owned by you' : 'Assigned to you'}
                      </span>
                    </div>
                    <p className="mp-copy mt-2 line-clamp-2">{mandate.description}</p>
                  </div>
                  <Link
                    href={`/mandates/${encodeURIComponent(mandate.id)}`}
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4"
                  >
                    View details <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>

                <div className="mt-5 grid gap-4 border-t border-mp-warm-grey pt-4 sm:grid-cols-3">
                  <div>
                    <p className="mp-kicker">Spending authority</p>
                    <p className="mt-1 font-semibold">
                      {formatMinorAmount(mandate.spendingLimitMinor, mandate.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="mp-kicker">Committed</p>
                    <p className="mt-1 font-semibold">
                      {formatMinorAmount(mandate.spentAmountMinor, mandate.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="mp-kicker">Authorized agent</p>
                    <p className="mt-1 truncate font-mono text-sm">{mandate.authorizedAgentId}</p>
                  </div>
                </div>
                <div className="mt-4" aria-label={`${percent}% of mandate budget committed`}>
                  <div className="mb-1 flex justify-between text-xs text-mp-medium-grey">
                    <span>Budget committed</span>
                    <span>{percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden bg-mp-app-bg">
                    <div
                      className="h-full bg-mp-orange transition-[width]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs text-mp-medium-grey">
                  {mandate.expiresAt
                    ? `Expires ${new Date(mandate.expiresAt).toLocaleDateString()}`
                    : 'Expiry date unavailable'}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
