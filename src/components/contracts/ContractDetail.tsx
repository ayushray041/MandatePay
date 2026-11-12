'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clock3, FileText, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import {
  decideContract,
  decideContractAmendment,
  analyzeContract,
  getContract,
  proposeContractAmendment,
  type ContractDetail as ContractDetailData,
} from '@/lib/contracts/client';
import { currencyFractionDigits, formatMinorAmount, parseMajorAmount } from '@/lib/mandates/money';
import { agentCategories, agentCategorySchema } from '@/models/agent';
import { amendmentProposeSchema } from '@/models/contract';
import type { ContractAnalysisResponse } from '@/models/ai';

function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

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
  const [analysis, setAnalysis] = useState<ContractAnalysisResponse | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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

  const runAnalysis = async () => {
    setAnalysisBusy(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      setAnalysis(await analyzeContract(contractId));
    } catch (caughtError: unknown) {
      setAnalysisError(caughtError instanceof Error ? caughtError.message : 'Contract analysis could not be completed.');
    } finally {
      setAnalysisBusy(false);
    }
  };

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

  const proposeAmendment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!terms || contract.status !== 'active') {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const amountMinor = parseMajorAmount(
      String(formData.get('amount') ?? ''),
      terms.currency,
    );
    const category = agentCategorySchema.safeParse(formData.get('category'));
    const expiresAt = new Date(String(formData.get('expiresAt') ?? ''));
    if (amountMinor === null || !category.success) {
      setError('Enter an amount using the contract currency precision and choose a valid category.');
      return;
    }
    if (Number.isNaN(expiresAt.getTime())) {
      setError('Choose a valid contract expiry date.');
      return;
    }
    const parsed = amendmentProposeSchema.safeParse({
      amountMinor,
      service: {
        title: String(formData.get('serviceTitle') ?? ''),
        category: category.data,
        description: String(formData.get('serviceDescription') ?? ''),
        deliveryDays: Number(formData.get('deliveryDays')),
      },
      paymentConditions: String(formData.get('paymentConditions') ?? ''),
      deliveryConditions: String(formData.get('deliveryConditions') ?? ''),
      expiresAt: expiresAt.toISOString(),
      terminationConditions: String(formData.get('terminationConditions') ?? ''),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review the proposed amendment details.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await proposeContractAmendment(contractId, parsed.data);
      setNotice('Amendment proposed. The current contract version remains unchanged until all parties approve.');
      setRefreshKey((key) => key + 1);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Amendment could not be proposed.');
    } finally {
      setBusy(false);
    }
  };

  const decideAmendment = async (
    amendmentId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideContractAmendment(contractId, amendmentId, {
        decision,
        ...(reason ? { reason } : {}),
      });
      setNotice(decision === 'approve' ? 'Amendment approval recorded.' : 'Amendment rejected.');
      setRefreshKey((key) => key + 1);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Amendment decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const rejectAmendment = async (
    event: React.FormEvent<HTMLFormElement>,
    amendmentId: string,
  ) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('Provide a reason before rejecting this amendment.');
      return;
    }
    await decideAmendment(amendmentId, 'reject', reason);
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

  const { contract, versions, events, amendments } = detail;
  const version = versions.find((item) => item.id === contract.currentVersionId);
  const terms = version?.terms;
  const canReview = contract.status === 'pending_review'
    && Boolean(user?.uid)
    && contract.requiredApproverIds.includes(user?.uid ?? '')
    && !contract.approvals.includes(user?.uid ?? '');
  const canProposeAmendment = contract.status === 'active'
    && !contract.activeAmendmentId
    && Boolean(terms);

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

      {terms && (
        <section className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5 sm:p-7" aria-labelledby="contract-analysis-heading">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-mp-orange" aria-hidden="true" />
            <h2 id="contract-analysis-heading" className="text-lg font-semibold">AI clause review</h2>
          </div>
          <p className="text-sm text-mp-medium-grey">
            Optional review aid for the current immutable version. It does not change the contract or replace professional advice.
          </p>
          <Button type="button" variant="outline" disabled={analysisBusy} onClick={() => void runAnalysis()}>
            {analysisBusy ? 'Reviewing…' : 'Review clauses'}
          </Button>
          {analysisError && <p className="text-sm text-red-800" role="alert">{analysisError}</p>}
          {analysis && (
            <div className="space-y-3 border-t border-mp-warm-grey pt-4" aria-live="polite">
              <p className="text-sm">{analysis.analysis.summary}</p>
              {analysis.analysis.clauses.length === 0 && (
                <p className="text-sm text-mp-medium-grey">No specific clause observations were returned.</p>
              )}
              {analysis.analysis.clauses.map((clause, index) => (
                <article key={`${clause.field}-${index}`} className="border-l-2 border-mp-orange pl-4">
                  <p className="mp-kicker">{clause.severity} · {clause.field}</p>
                  <blockquote className="mt-1 text-sm italic">“{clause.excerpt}”</blockquote>
                  <p className="mt-1 text-sm">{clause.concern}</p>
                  <p className="mt-1 text-sm font-medium">Question for review: {clause.question}</p>
                </article>
              ))}
              <p className="border-t border-mp-warm-grey pt-3 text-xs text-mp-medium-grey">{analysis.disclaimer}</p>
            </div>
          )}
        </section>
      )}

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

          <section className="space-y-5 border-t border-mp-warm-grey pt-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mp-kicker">Version changes</p>
                <h2 className="mt-1 text-lg font-semibold">Amendments</h2>
              </div>
              <Link href="/amendments" className="text-sm font-semibold underline decoration-mp-orange decoration-2 underline-offset-4">
                Open amendment register
              </Link>
            </div>
            {contract.activeAmendmentId && (() => {
              const amendment = amendments.find((item) => item.id === contract.activeAmendmentId);
              if (!amendment) {
                return <p className="border-l-2 border-mp-orange px-4 py-3 text-sm" role="alert">The pending amendment record is unavailable.</p>;
              }
              const baseVersion = versions.find((item) => item.version === amendment.baseVersion);
              const mayReview = amendment.status === 'pending_review'
                && amendment.requiredApproverIds.includes(user?.uid ?? '')
                && !amendment.approvals.includes(user?.uid ?? '');
              return (
                <article className="border border-mp-warm-grey bg-mp-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold">Proposed from version {amendment.baseVersion}</h3>
                    <span className="border border-mp-warm-grey px-2 py-1 text-xs font-semibold uppercase">
                      {amendment.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mp-kicker">Current</p>
                      <p className="mt-1 font-semibold">{baseVersion?.terms.service.title ?? 'Unavailable'}</p>
                      {baseVersion && <p className="mt-1 text-sm">{baseVersion.terms.service.description}</p>}
                      {baseVersion && <p className="mt-1 text-sm text-mp-medium-grey">{formatMinorAmount(baseVersion.terms.amountMinor, baseVersion.terms.currency)}</p>}
                    </div>
                    <div>
                      <p className="mp-kicker">Proposed</p>
                      <p className="mt-1 font-semibold">{amendment.proposedTerms.service.title}</p>
                      <p className="mt-1 text-sm">{amendment.proposedTerms.service.description}</p>
                      <p className="mt-1 text-sm text-mp-medium-grey">{formatMinorAmount(amendment.proposedTerms.amountMinor, amendment.proposedTerms.currency)}</p>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-mp-warm-grey pt-4 sm:grid-cols-2">
                    <div><dt className="mp-kicker">Payment terms</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{amendment.proposedTerms.paymentConditions}</dd></div>
                    <div><dt className="mp-kicker">Delivery terms</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{amendment.proposedTerms.deliveryConditions}</dd></div>
                    <div><dt className="mp-kicker">Expiry</dt><dd className="mt-1 text-sm">{new Date(amendment.proposedTerms.expiresAt).toLocaleString()}</dd></div>
                    <div><dt className="mp-kicker">Termination terms</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{amendment.proposedTerms.terminationConditions}</dd></div>
                  </dl>
                  <p className="mt-3 text-sm text-mp-medium-grey">
                    {amendment.approvals.length} of {amendment.requiredApproverIds.length} approvals recorded.
                  </p>
                  {mayReview && (
                    <div className="mt-4 flex flex-wrap items-end gap-4">
                      <Button type="button" disabled={busy} onClick={() => void decideAmendment(amendment.id, 'approve')}>
                        <Check size={16} aria-hidden="true" /> Approve amendment
                      </Button>
                      <form onSubmit={(event) => void rejectAmendment(event, amendment.id)} className="flex flex-wrap items-end gap-2">
                        <label>
                          <span className="mp-label">Reason for rejection</span>
                          <input name="reason" required maxLength={1000} className="mp-input mt-1 min-w-64" />
                        </label>
                        <Button type="submit" variant="outline" disabled={busy}>
                          <X size={16} aria-hidden="true" /> Reject amendment
                        </Button>
                      </form>
                    </div>
                  )}
                </article>
              );
            })()}

            {canProposeAmendment && terms && (
              <details className="border border-mp-warm-grey bg-mp-surface p-5">
                <summary className="cursor-pointer font-semibold">Propose an amendment</summary>
                <p className="mp-copy mt-2 text-sm">
                  All required parties must approve. Price or scope changes are checked against both active mandates before a new version can be created.
                </p>
                <form onSubmit={(event) => void proposeAmendment(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mp-label">Service title</span>
                    <input name="serviceTitle" required minLength={3} maxLength={120} defaultValue={terms.service.title} className="mp-input mt-1" />
                  </label>
                  <label>
                    <span className="mp-label">Category</span>
                    <select name="category" defaultValue={terms.service.category} className="mp-input mt-1">
                      {agentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mp-label">Service scope</span>
                    <textarea name="serviceDescription" required minLength={10} maxLength={3000} rows={3} defaultValue={terms.service.description} className="mp-input mt-1" />
                  </label>
                  <label>
                    <span className="mp-label">Price ({terms.currency})</span>
                    <input
                      name="amount"
                      type="number"
                      min="0"
                      step={1 / (10 ** currencyFractionDigits(terms.currency))}
                      required
                      defaultValue={(terms.amountMinor / 10 ** currencyFractionDigits(terms.currency)).toFixed(currencyFractionDigits(terms.currency))}
                      className="mp-input mt-1"
                    />
                  </label>
                  <label>
                    <span className="mp-label">Delivery days</span>
                    <input name="deliveryDays" type="number" min="1" max="3650" required defaultValue={terms.service.deliveryDays} className="mp-input mt-1" />
                  </label>
                  <label>
                    <span className="mp-label">Payment conditions</span>
                    <textarea name="paymentConditions" required minLength={1} maxLength={2000} rows={3} defaultValue={terms.paymentConditions} className="mp-input mt-1" />
                  </label>
                  <label>
                    <span className="mp-label">Delivery conditions</span>
                    <textarea name="deliveryConditions" required minLength={1} maxLength={2000} rows={3} defaultValue={terms.deliveryConditions} className="mp-input mt-1" />
                  </label>
                  <label>
                    <span className="mp-label">Contract record expiry</span>
                    <input name="expiresAt" type="datetime-local" required defaultValue={dateTimeLocalValue(terms.expiresAt)} className="mp-input mt-1" />
                    <span className="mt-1 block text-xs text-mp-medium-grey">Cannot extend beyond either party’s active mandate.</span>
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mp-label">Expiry and termination conditions</span>
                    <textarea name="terminationConditions" required minLength={1} maxLength={2000} rows={3} defaultValue={terms.terminationConditions} className="mp-input mt-1" />
                  </label>
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={busy}>
                      {busy ? 'Proposing…' : 'Submit amendment for review'}
                    </Button>
                  </div>
                </form>
              </details>
            )}
          </section>
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
