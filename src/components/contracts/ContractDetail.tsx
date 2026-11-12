'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clock3, FileText, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { decideContract, getContract, type ContractDetail as ContractDetailData } from '@/lib/contracts/client';
import { formatMinorAmount } from '@/lib/mandates/money';

const eventLabels: Record<string, string> = {
  'contract.generated': 'Contract generated',
  'contract.approved': 'Party approved this version',
  'contract.rejected': 'Contract review rejected',
  'contract.activated': 'All parties approved; record activated',
  'contract.expired': 'Contract record expired',
  'amendment.proposed': 'Amendment proposed',
  'amendment.approved': 'Amendment approved',
  'amendment.rejected': 'Amendment rejected',
  'contract.version_created': 'New version created',
};

export function ContractDetail({ contractId }: { contractId: string }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<ContractDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getContract(contractId)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Contract could not be loaded.');
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
  }, [contractId, refreshKey]);

  const decide = async (
    decision: 'approve' | 'reject',
    reason?: string,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideContract(contractId, { decision, ...(reason ? { reason } : {}) });
      setNotice(decision === 'approve' ? 'Your approval has been recorded.' : 'Your rejection has been recorded.');
      setRefreshKey((key) => key + 1);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Contract review could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('Provide a reason before rejecting this contract.');
      return;
    }
    await decide('reject', reason);
  };

  if (loading) {
    return <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading contract…</p>;
  }
  if (!detail) {
    return (
      <section className="mp-page mx-auto max-w-4xl space-y-4">
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error ?? 'Contract could not be loaded.'}
        </p>
        <Button type="button" onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }}>
          Try again
        </Button>
        <Link href="/contracts" className="ml-4 text-sm underline">Back to contracts</Link>
      </section>
    );
  }

  const { contract, versions, events } = detail;
  const version = versions.find((item) => item.id === contract.currentVersionId);
  const terms = version?.terms;
  const canReview = contract.status === 'pending_review'
    && Boolean(user?.uid)
    && contract.requiredApproverIds.includes(user?.uid ?? '')
    && !contract.approvals.includes(user?.uid ?? '');

  return (
    <section className="mp-page mx-auto w-full max-w-6xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <Link href="/contracts" className="inline-flex items-center gap-2 text-sm font-semibold text-mp-medium-grey">
          <ArrowLeft size={16} aria-hidden="true" /> Back to contracts
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="mp-kicker">Contract document · version {contract.currentVersion}</p>
          <span className="border border-mp-warm-grey bg-mp-surface px-2.5 py-1 text-xs font-semibold uppercase">
            {contract.status.replaceAll('_', ' ')}
          </span>
        </div>
        <h1 className="mp-page-title mt-2">{terms?.service.title ?? 'Contract record'}</h1>
        <p className="mp-copy mt-2">Generated from accepted negotiation {contract.negotiationId}</p>
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-mp-medium-grey">
          <Clock3 size={15} aria-hidden="true" />
          Expires {new Date(contract.expiresAt).toLocaleString()}
        </p>
      </header>

      {(error || notice) && (
        <p className={`border-l-2 px-4 py-3 text-sm ${error ? 'border-mp-orange bg-mp-surface' : 'border-emerald-700 bg-emerald-50'}`} role={error ? 'alert' : 'status'}>
          {error ?? notice}
        </p>
      )}
      <p className="border border-mp-warm-grey bg-mp-surface p-4 text-sm text-mp-medium-grey">
        This is an administrative record of negotiated terms, not legal advice or a digitally signed
        agreement. MandatePay does not execute payments or monitor service delivery.
      </p>

      {terms ? (
        <article className="space-y-8 border border-mp-warm-grey bg-white p-6 shadow-sm sm:p-10">
          <header className="border-b border-mp-warm-grey pb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-mp-medium-grey">Service agreement record</p>
            <h2 className="mt-2 text-2xl font-bold">{terms.service.title}</h2>
            <p className="mt-2 text-sm text-mp-medium-grey">
              Version {version.version} · Generated {version.createdAt ? new Date(version.createdAt).toLocaleString() : 'time unavailable'}
            </p>
          </header>

          <section aria-labelledby="contract-parties-heading">
            <h3 id="contract-parties-heading" className="text-lg font-semibold">Parties and agent identities</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {terms.parties.map((party) => (
                <div key={party.mandateId} className="border border-mp-warm-grey p-4">
                  <p className="font-semibold">{party.displayName} <span className="text-sm font-normal text-mp-medium-grey">({party.role})</span></p>
                  <p className="mt-2 text-sm">Authorized agent: {party.agentDisplayName}</p>
                  <p className="mt-1 break-all font-mono text-xs text-mp-medium-grey">Agent UID: {party.agentId}</p>
                  <p className="mt-1 text-sm">Mandate: {party.mandateTitle}</p>
                  <p className="mt-1 break-all font-mono text-xs text-mp-medium-grey">Reference: {party.mandateId}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="contract-service-heading" className="border-t border-mp-warm-grey pt-5">
            <h3 id="contract-service-heading" className="text-lg font-semibold">Agreed services</h3>
            <p className="mt-2 text-sm font-medium">{terms.service.category} · {terms.service.deliveryDays} delivery days</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{terms.service.description}</p>
          </section>

          <section className="grid gap-6 border-t border-mp-warm-grey pt-5 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold">Price and currency</h3>
              <p className="mt-2 text-2xl font-bold">{formatMinorAmount(terms.amountMinor, terms.currency)}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Payment conditions</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{terms.paymentConditions}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Delivery conditions</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{terms.deliveryConditions}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Expiry and termination conditions</h3>
              <p className="mt-2 text-sm">Record expiry: {new Date(terms.expiresAt).toLocaleString()}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{terms.terminationConditions}</p>
            </div>
          </section>
        </article>
      ) : (
        <p className="border-l-2 border-mp-orange px-4 py-3 text-sm" role="alert">
          The current immutable contract version is unavailable.
        </p>
      )}

      {contract.status === 'pending_review' && (
        <section className="border-l-2 border-mp-orange bg-mp-surface p-5">
          <div className="flex items-center gap-2">
            <FileText size={18} aria-hidden="true" />
            <h2 className="text-lg font-semibold">Review and approval</h2>
          </div>
          <p className="mt-2 text-sm text-mp-medium-grey">
            {contract.approvals.length} of {contract.requiredApproverIds.length} required parties have approved.
            Each owner and authorized agent must review this record before it becomes active.
          </p>
          {!canReview && (
            <p className="mt-3 text-sm text-mp-medium-grey">
              {contract.approvals.includes(user?.uid ?? '')
                ? 'Your review is recorded.'
                : 'Your account is not an outstanding reviewer.'}
            </p>
          )}
          {canReview && (
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <Button type="button" disabled={busy} onClick={() => void decide('approve')}>
                <Check size={16} aria-hidden="true" /> {busy ? 'Recording…' : 'Approve this version'}
              </Button>
              <form onSubmit={reject} className="flex flex-wrap items-end gap-2">
                <label>
                  <span className="mp-label">Reason for rejection</span>
                  <input name="reason" required maxLength={1000} className="mp-input mt-1 min-w-64" />
                </label>
                <Button type="submit" variant="outline" disabled={busy}>
                  <X size={16} aria-hidden="true" /> Reject
                </Button>
              </form>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-8 border-t border-mp-warm-grey pt-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Immutable version history</h2>
          <ol className="mt-4 space-y-3">
            {versions.map((item) => (
              <li key={item.id} className="border border-mp-warm-grey bg-mp-surface p-4">
                <p className="font-semibold">Version {item.version}{item.id === contract.currentVersionId ? ' · current' : ''}</p>
                <p className="mt-1 text-sm">{item.terms.service.title}</p>
                <p className="mt-1 text-sm text-mp-medium-grey">
                  {formatMinorAmount(item.terms.amountMinor, item.terms.currency)}
                  {' · '}{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Time unavailable'}
                </p>
                {item.amendmentId && <p className="mt-1 font-mono text-xs text-mp-medium-grey">Amendment {item.amendmentId}</p>}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Audit history</h2>
          {events.length === 0 ? (
            <p className="mp-copy mt-3 text-sm">No contract events have been recorded.</p>
          ) : (
            <ol className="mt-4 border-l border-mp-warm-grey pl-5">
              {events.map((event) => (
                <li key={event.id} className="border-b border-mp-warm-grey pb-4 pt-1 last:border-0">
                  <p className="font-semibold">{eventLabels[event.type] ?? event.type}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {event.actorId === user?.uid ? 'You' : event.actorId}
                    {event.createdAt ? ` · ${new Date(event.createdAt).toLocaleString()}` : ''}
                  </p>
                  {typeof event.details?.reason === 'string' && (
                    <p className="mt-1 text-sm">{event.details.reason}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </section>
  );
}
