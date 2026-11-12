'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { listAmendments, type AmendmentListItem } from '@/lib/contracts/client';
import { formatMinorAmount } from '@/lib/mandates/money';

export function AmendmentList() {
  const [amendments, setAmendments] = useState<AmendmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    listAmendments()
      .then((result) => {
        if (active) {
          setAmendments(result);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Amendments could not be loaded.');
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
  }, [refreshKey]);

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Contract lifecycle</p>
        <h1 className="mp-page-title mt-2">Amendments</h1>
        <p className="mp-copy mt-3 max-w-2xl">
          Compare proposed changes with the immutable contract version they are based on. Every
          required party must approve before a new version is created.
        </p>
      </header>
      {error && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error}
          <Button type="button" variant="outline" className="ml-4" onClick={() => setRefreshKey((key) => key + 1)}>
            Retry
          </Button>
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading amendments…</p>
      ) : amendments.length === 0 ? (
        <div className="mp-empty-state flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <GitBranch size={26} className="text-mp-medium-grey" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">No amendments are available</h2>
          <p className="mp-copy mt-2 max-w-lg">Proposed changes from your contract parties will appear here.</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {amendments.map((amendment) => (
            <li key={`${amendment.contractId}/${amendment.id}`} className="border border-mp-warm-grey bg-mp-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-semibold">{amendment.contractTitle}</h2>
                    <span className="border border-mp-warm-grey px-2 py-1 text-xs font-semibold uppercase">
                      {amendment.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    Contract version {amendment.baseVersion} · proposed by {amendment.createdBy}
                    {amendment.createdAt ? ` · ${new Date(amendment.createdAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <Link
                  href={`/contracts/${encodeURIComponent(amendment.contractId)}`}
                  className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                >
                  Compare and review <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-4 grid gap-3 border-t border-mp-warm-grey pt-4 sm:grid-cols-2">
                <div>
                  <p className="mp-kicker">Current version {amendment.baseVersion}</p>
                  <p className="mt-1 font-semibold">{amendment.baseTerms.service.title}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {formatMinorAmount(amendment.baseTerms.amountMinor, amendment.baseTerms.currency)}
                  </p>
                </div>
                <div>
                  <p className="mp-kicker">Proposed</p>
                  <p className="mt-1 font-semibold">{amendment.proposedTerms.service.title}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {formatMinorAmount(amendment.proposedTerms.amountMinor, amendment.proposedTerms.currency)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-mp-medium-grey">
                {amendment.approvals.length} of {amendment.requiredApproverIds.length} approvals
                {amendment.rejectionReason ? ` · Rejected: ${amendment.rejectionReason}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-mp-medium-grey">
        Approval creates a new immutable version only after authorization is checked against both
        mandates. This record is not a digital signature or legal determination.
      </p>
    </section>
  );
}
