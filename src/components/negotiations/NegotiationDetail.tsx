'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, Clock3, MessagesSquare, Send, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { getMyAgentProfile } from '@/lib/agents/client';
import { listMandates } from '@/lib/mandates/client';
import { formatMinorAmount, parseMajorAmount } from '@/lib/mandates/money';
import { agentCategorySchema } from '@/models/agent';
import {
  decideNegotiation,
  getNegotiation,
  submitNegotiationOffer,
  type NegotiationDetail as NegotiationDetailData,
} from '@/lib/negotiations/client';
import type { AgentProfile } from '@/models/agent';
import type { MandateRecord } from '@/models/mandate';
import type { NegotiationStatus } from '@/models/negotiation';

const statusStyles: Record<NegotiationStatus, string> = {
  initiated: 'border-blue-700 bg-blue-50 text-blue-800',
  offer_submitted: 'border-amber-700 bg-amber-50 text-amber-900',
  counter_offered: 'border-violet-700 bg-violet-50 text-violet-800',
  accepted: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-700 bg-red-50 text-red-800',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  cancelled: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
};

const eventLabels: Record<string, string> = {
  'negotiation.created': 'Negotiation requested',
  'offer.submitted': 'Initial offer submitted',
  'offer.countered': 'Counteroffer submitted',
  'negotiation.accepted': 'Terms accepted',
  'negotiation.rejected': 'Negotiation rejected',
  'negotiation.cancelled': 'Negotiation cancelled',
  'negotiation.expired': 'Negotiation expired',
};

type Props = { negotiationId: string };

export function NegotiationDetail({ negotiationId }: Props) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<NegotiationDetailData | null>(null);
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [selectedMandateId, setSelectedMandateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const [nextDetail, nextMandates, nextAgent] = await Promise.all([
        getNegotiation(negotiationId),
        listMandates(),
        getMyAgentProfile(),
      ]);
      if (!nextAgent) {
        throw new Error('Register as an agent before participating in negotiations.');
      }
      setDetail(nextDetail);
      setMandates(nextMandates);
      setAgent(nextAgent);
      setSelectedMandateId((selected) => selected || nextMandates[0]?.id || '');
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation details could not be loaded.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [negotiationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getNegotiation(negotiationId),
      listMandates(),
      getMyAgentProfile(),
    ])
      .then(([nextDetail, nextMandates, nextAgent]) => {
        if (!active) {
          return;
        }
        if (!nextAgent) {
          throw new Error('Register as an agent before participating in negotiations.');
        }
        setDetail(nextDetail);
        setMandates(nextMandates);
        setAgent(nextAgent);
        setSelectedMandateId(nextMandates[0]?.id ?? '');
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Negotiation details could not be loaded.');
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
  }, [negotiationId]);

  const participantRole = detail?.negotiation.initiatorAgentId === user?.uid
    ? 'initiator'
    : detail?.negotiation.recipientAgentId === user?.uid
      ? 'recipient'
      : null;
  const ownMandateId = participantRole === 'initiator'
    ? detail?.negotiation.initiatorMandateId
    : detail?.negotiation.recipientMandateId ?? selectedMandateId;
  const activeMandates = mandates.filter((mandate) => (
    mandate.authorizedAgentId === user?.uid
    && mandate.status === 'active'
    && (!detail?.negotiation.currentOffer
      || mandate.currency === detail.negotiation.currentOffer.terms.currency)
    && agent?.supportedCurrencies.includes(mandate.currency)
  ));
  const ownMandate = activeMandates.find((mandate) => mandate.id === ownMandateId);
  const negotiation = detail?.negotiation;
  const currentOffer = negotiation?.currentOffer;
  const terminal = negotiation
    ? ['accepted', 'rejected', 'expired', 'cancelled'].includes(negotiation.status)
    : false;
  const canSubmitFirstOffer = participantRole === 'initiator'
    && negotiation?.status === 'initiated'
    && !terminal;
  const canRespond = Boolean(
    participantRole
    && currentOffer
    && ['offer_submitted', 'counter_offered'].includes(negotiation?.status ?? '')
    && currentOffer.submittedByAgentId !== user?.uid
    && !terminal,
  );
  const canCounter = canSubmitFirstOffer || canRespond;
  const previousOffer = detail && detail.offers.length > 1
    ? detail.offers[detail.offers.length - 2]
    : null;

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load(false);
      return true;
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitOffer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!negotiation || !ownMandate) {
      setError('Select an active mandate assigned to your agent profile.');
      return;
    }
    const formData = new FormData(event.currentTarget);
    const amountMinor = parseMajorAmount(
      String(formData.get('amount') ?? ''),
      ownMandate.currency,
    );
    if (amountMinor === null) {
      setError('Enter a positive amount using the selected mandate currency precision.');
      return;
    }
    const category = agentCategorySchema.safeParse(formData.get('category'));
    if (!category.success) {
      setError('Choose a valid service category.');
      return;
    }
    const terms = {
      title: String(formData.get('title') ?? ''),
      category: category.data,
      description: String(formData.get('description') ?? ''),
      amountMinor,
      currency: ownMandate.currency,
      deliveryDays: Number(formData.get('deliveryDays')),
    };
    const form = event.currentTarget;
    const success = await runAction(
      () => submitNegotiationOffer(negotiation.id, {
        mandateId: ownMandate.id,
        terms,
      }),
      'Offer submitted. It is recorded in the negotiation history.',
    );
    if (success) {
      form.reset();
    }
  };

  const decide = async (
    decision: 'accept' | 'reject' | 'cancel',
    reason?: string,
  ) => {
    if (!negotiation) {
      return;
    }
    await runAction(
      () => decideNegotiation(negotiation.id, {
        decision,
        ...(decision === 'accept' && ownMandate ? { mandateId: ownMandate.id } : {}),
        ...(reason ? { reason } : {}),
      }),
      decision === 'accept'
        ? 'Terms accepted and reserved against both mandates.'
        : decision === 'reject'
          ? 'Negotiation rejected.'
          : 'Negotiation cancelled.',
    );
  };

  const reject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('Provide a reason before rejecting.');
      return;
    }
    await decide('reject', reason);
  };

  if (loading) {
    return <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading negotiation…</p>;
  }
  if (!detail || !negotiation) {
    return (
      <section className="mx-auto max-w-3xl space-y-4 py-8">
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error ?? 'Negotiation could not be loaded.'}
        </p>
        <Button type="button" onClick={() => void load()}>Try again</Button>
        <Link href="/negotiations" className="ml-4 text-sm underline">Back to inbox</Link>
      </section>
    );
  }

  const isInitiator = participantRole === 'initiator';
  const mayCancel = isInitiator && !terminal;
  const needsMandate = participantRole === 'recipient'
    && !negotiation.recipientMandateId
    && !terminal;
  const ownCapabilities = agent?.capabilities ?? [];

  return (
    <section className="mp-page mx-auto w-full max-w-6xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <Link href="/negotiations" className="inline-flex items-center gap-2 text-sm font-semibold text-mp-medium-grey">
          <ArrowLeft size={16} aria-hidden="true" /> Back to inbox
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="mp-kicker">Negotiation detail</p>
          <span className={`border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${statusStyles[negotiation.status]}`}>
            {negotiation.status.replaceAll('_', ' ')}
          </span>
        </div>
        <h1 className="mp-page-title mt-2">{negotiation.title}</h1>
        <p className="mp-copy mt-2">
          {negotiation.initiatorDisplayName ?? negotiation.initiatorAgentId}
          {' and '}
          {negotiation.recipientDisplayName ?? negotiation.recipientAgentId}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-mp-medium-grey">
          <Clock3 size={15} aria-hidden="true" />
          {negotiation.status === 'expired' ? 'Expired' : 'Expires'}{' '}
          {new Date(negotiation.expiresAt).toLocaleString()}
        </p>
      </header>

      {(error || notice) && (
        <p className={`border-l-2 px-4 py-3 text-sm ${error ? 'border-mp-orange bg-mp-surface' : 'border-emerald-700 bg-emerald-50'}`} role={error ? 'alert' : 'status'}>
          {error ?? notice}
        </p>
      )}

      {negotiation.status === 'accepted' && (
        <p className="border border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-900">
          Accepted terms are reserved against both mandates. This records agreement only; it does not
          execute a service, contract, or payment.
        </p>
      )}
      {negotiation.status === 'rejected' && negotiation.rejectionReason && (
        <p className="border border-red-700 bg-red-50 p-4 text-sm">
          Rejection reason: {negotiation.rejectionReason}
        </p>
      )}

      {currentOffer ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessagesSquare size={19} className="text-mp-orange" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Offer comparison</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {previousOffer && (
                <article className="border border-mp-warm-grey bg-mp-surface p-5">
                  <p className="mp-kicker">Previous · #{previousOffer.sequence}</p>
                  <h3 className="mt-2 font-semibold">{previousOffer.terms.title}</h3>
                  <p className="mt-3 text-2xl font-bold">
                    {formatMinorAmount(previousOffer.terms.amountMinor, previousOffer.terms.currency)}
                  </p>
                  <p className="mt-1 text-sm text-mp-medium-grey">{previousOffer.terms.deliveryDays} delivery days</p>
                </article>
              )}
              <article className="border-2 border-mp-orange bg-mp-surface p-5">
                <p className="mp-kicker">Latest offer · #{currentOffer.sequence}</p>
                <h3 className="mt-2 font-semibold">{currentOffer.terms.title}</h3>
                <p className="mt-3 text-2xl font-bold">
                  {formatMinorAmount(currentOffer.terms.amountMinor, currentOffer.terms.currency)}
                </p>
                <p className="mt-1 text-sm text-mp-medium-grey">{currentOffer.terms.deliveryDays} delivery days</p>
                <p className="mt-3 text-sm">{currentOffer.terms.description}</p>
                <p className="mt-2 text-xs text-mp-medium-grey">
                  Submitted by {currentOffer.submittedByAgentId === user?.uid ? 'you' : currentOffer.submittedByAgentId}
                </p>
              </article>
            </div>
          </div>
          <aside className="border-l-2 border-mp-orange pl-5">
            <p className="mp-kicker">Current service terms</p>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="text-mp-medium-grey">Service category</dt><dd className="font-semibold">{currentOffer.terms.category}</dd></div>
              <div><dt className="text-mp-medium-grey">Delivery window</dt><dd className="font-semibold">{currentOffer.terms.deliveryDays} days</dd></div>
              <div><dt className="text-mp-medium-grey">Offer history</dt><dd className="font-semibold">{detail.offers.length} immutable offers</dd></div>
              <div><dt className="text-mp-medium-grey">Authorized by</dt><dd className="break-all font-mono text-xs">{currentOffer.mandateId}</dd></div>
            </dl>
          </aside>
        </section>
      ) : (
        <div className="border border-mp-warm-grey bg-mp-surface p-5">
          <h2 className="font-semibold">Awaiting the initial offer</h2>
          <p className="mp-copy mt-1 text-sm">The initiator can submit service and commercial terms below.</p>
        </div>
      )}

      {canCounter && (
        <section className="border border-mp-warm-grey bg-mp-surface p-5 sm:p-7">
          <h2 className="text-lg font-semibold">
            {canSubmitFirstOffer ? 'Submit initial offer' : 'Make a counteroffer'}
          </h2>
          {needsMandate && (
            <label className="mt-4 block max-w-xl">
              <span className="mp-label">Your active agent mandate</span>
              <select
                value={selectedMandateId}
                onChange={(event) => setSelectedMandateId(event.target.value)}
                className="mp-input mt-1"
              >
                <option value="">Select a mandate</option>
                {activeMandates.map((mandate) => (
                  <option key={mandate.id} value={mandate.id}>{mandate.title} · {mandate.currency}</option>
                ))}
              </select>
            </label>
          )}
          {!ownMandate ? (
            <p className="mt-4 border-l-2 border-mp-orange px-4 py-2 text-sm" role="alert">
              {needsMandate
                ? 'Select an active mandate assigned to you to submit or accept terms.'
                : 'The mandate attached to this negotiation is no longer active.'}
            </p>
          ) : (
            <form onSubmit={submitOffer} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mp-label">Offer title</span>
                <input name="title" required minLength={3} maxLength={120} className="mp-input mt-1" />
              </label>
              <label>
                <span className="mp-label">Service category</span>
                <select name="category" required className="mp-input mt-1">
                  {ownCapabilities.map((capability) => (
                    <option key={capability.category} value={capability.category}>
                      {capability.category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mp-label">Scope and deliverables</span>
                <textarea name="description" required minLength={10} maxLength={3000} rows={4} className="mp-input mt-1" />
              </label>
              <label>
                <span className="mp-label">Price ({ownMandate.currency})</span>
                <input name="amount" type="number" min="0" step="any" required className="mp-input mt-1" />
              </label>
              <label>
                <span className="mp-label">Delivery days</span>
                <input name="deliveryDays" type="number" min="1" max="3650" required defaultValue={14} className="mp-input mt-1" />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy || (needsMandate && !ownMandate)}>
                  <Send size={16} aria-hidden="true" /> {busy ? 'Submitting…' : 'Submit offer'}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {(canRespond || mayCancel || (participantRole === 'recipient' && negotiation.status === 'initiated')) && (
        <section className="flex flex-wrap items-start gap-3 border-t border-mp-warm-grey pt-5">
          {canRespond && (
            <>
              {ownMandate ? (
                <Button type="button" disabled={busy} onClick={() => void decide('accept')}>
                  <Check size={16} aria-hidden="true" /> Accept latest offer
                </Button>
              ) : (
                <p className="w-full text-sm text-mp-medium-grey">
                  Select an active mandate above before accepting.
                </p>
              )}
              <form onSubmit={reject} className="flex flex-wrap items-end gap-2">
                <label>
                  <span className="mp-label">Rejection reason</span>
                  <input name="reason" required maxLength={1000} className="mp-input mt-1 min-w-64" />
                </label>
                <Button type="submit" variant="outline" disabled={busy}>
                  <X size={16} aria-hidden="true" /> Reject
                </Button>
              </form>
            </>
          )}
          {participantRole === 'recipient' && negotiation.status === 'initiated' && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void decide('reject', 'Request declined by recipient.')}>
              <X size={16} aria-hidden="true" /> Decline request
            </Button>
          )}
          {mayCancel && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void decide('cancel')}>
              <Ban size={16} aria-hidden="true" /> Cancel negotiation
            </Button>
          )}
        </section>
      )}

      <section className="grid gap-8 border-t border-mp-warm-grey pt-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Offer history</h2>
          {detail.offers.length === 0 ? (
            <p className="mp-copy mt-3 text-sm">No offers have been submitted.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {detail.offers.map((offer) => (
                <li key={offer.id} className="border border-mp-warm-grey bg-mp-surface p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">Offer #{offer.sequence}: {offer.terms.title}</p>
                    <span className="text-sm font-semibold">
                      {formatMinorAmount(offer.terms.amountMinor, offer.terms.currency)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {offer.submittedByAgentId === user?.uid
                      ? 'You'
                      : offer.submittedByAgentId === negotiation.initiatorAgentId
                        ? negotiation.initiatorDisplayName ?? negotiation.initiatorAgentId
                        : negotiation.recipientDisplayName ?? negotiation.recipientAgentId}
                    {' · '}{offer.terms.deliveryDays} days · {offer.terms.category}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{offer.terms.description}</p>
                  <p className="mt-2 text-xs text-mp-medium-grey">
                    {offer.createdAt ? new Date(offer.createdAt).toLocaleString() : 'Time unavailable'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold">Activity timeline</h2>
          {detail.events.length === 0 ? (
            <p className="mp-copy mt-3 text-sm">No activity has been recorded.</p>
          ) : (
            <ol className="mt-4 border-l border-mp-warm-grey pl-5">
              {detail.events.map((event) => (
                <li key={event.id} className="relative border-b border-mp-warm-grey pb-4 pt-1 last:border-0">
                  <span className="absolute -left-[1.65rem] top-2 h-2.5 w-2.5 rounded-full bg-mp-orange" aria-hidden="true" />
                  <p className="font-semibold">{eventLabels[event.type] ?? event.type}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {event.actorAgentId === user?.uid
                      ? 'You'
                      : event.actorAgentId === negotiation.initiatorAgentId
                        ? negotiation.initiatorDisplayName ?? negotiation.initiatorAgentId
                        : negotiation.recipientDisplayName ?? negotiation.recipientAgentId}
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
