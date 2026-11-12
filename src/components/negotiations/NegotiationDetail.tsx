'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, Clock3, MessagesSquare, Send, Sparkles, History, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { getMyAgentProfile } from '@/lib/agents/client';
import { listMandates } from '@/lib/mandates/client';
import { formatMinorAmount, parseMajorAmount } from '@/lib/mandates/money';
import { agentCategorySchema } from '@/models/agent';
import {
  decideNegotiation,
  decideNegotiationOwnerApproval,
  escalateNegotiationDispute,
  getNegotiation,
  getNegotiationReplay,
  requestNegotiationIntelligence,
  submitNegotiationOffer,
  type NegotiationDetail as NegotiationDetailData,
} from '@/lib/negotiations/client';
import type { NegotiationIntelligenceResponse } from '@/models/ai';
import type { AgentProfile } from '@/models/agent';
import type { MandateRecord } from '@/models/mandate';
import { negotiationOfferTermsSchema, type NegotiationStatus } from '@/models/negotiation';

const statusStyles: Record<NegotiationStatus, string> = {
  initiated: 'border-blue-700 bg-blue-50 text-blue-800',
  offer_submitted: 'border-amber-700 bg-amber-50 text-amber-900',
  counter_offered: 'border-violet-700 bg-violet-50 text-violet-800',
  pending_owner_approval: 'border-orange-700 bg-orange-50 text-orange-900',
  accepted: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-700 bg-red-50 text-red-800',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  cancelled: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
};

const eventLabels: Record<string, string> = {
  'negotiation.created': 'Negotiation requested',
  'offer.submitted': 'Initial offer submitted',
  'offer.countered': 'Counteroffer submitted',
  'negotiation.owner_approval_requested': 'Owner approval requested',
  'negotiation.owner_approved': 'Mandate owner approved',
  'negotiation.owner_rejected': 'Mandate owner rejected',
  'negotiation.accepted': 'Terms accepted',
  'negotiation.rejected': 'Negotiation rejected',
  'negotiation.cancelled': 'Negotiation cancelled',
  'negotiation.expired': 'Negotiation expired',
  'negotiation.dispute_escalated': 'Dispute escalated',
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
  const [intelligence, setIntelligence] = useState<NegotiationIntelligenceResponse | null>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [replay, setReplay] = useState<Awaited<ReturnType<typeof getNegotiationReplay>> | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);

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

  const runAction = async <T,>(
    action: () => Promise<T>,
    message: string | ((result: T) => string),
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(typeof message === 'function' ? message(result) : message);
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
    const enteredAmountMinor = parseMajorAmount(
      String(formData.get('amount') ?? ''),
      ownMandate.currency,
    );
    const category = agentCategorySchema.safeParse(formData.get('category'));
    if (!category.success) {
      setError('Choose a valid service category.');
      return;
    }
    const quantity = String(formData.get('quantity') ?? '').trim();
    const unitPrice = String(formData.get('unitPrice') ?? '').trim();
    const discountPercent = String(formData.get('discountPercent') ?? '').trim();
    let quantityPricing: {
      quantity: number;
      unitPriceMinor: number;
      volumeDiscounts: Array<{ minimumQuantity: number; discountBasisPoints: number }>;
    } | undefined;
    let totalAmountMinor = enteredAmountMinor;
    if (quantity || unitPrice || discountPercent) {
      const quantityValue = Number(quantity);
      const unitPriceMinor = parseMajorAmount(unitPrice, ownMandate.currency);
      const discountBasisPoints = Math.round(Number(discountPercent || 0) * 100);
      if (
        !Number.isSafeInteger(quantityValue)
        || quantityValue < 1
        || quantityValue > 1_000_000
        || unitPriceMinor === null
        || !Number.isFinite(discountBasisPoints)
        || discountBasisPoints < 0
        || discountBasisPoints > 5000
        || (discountBasisPoints > 0 && quantityValue < 2)
      ) {
        setError('Enter a valid quantity, unit price, and volume discount (0–50%).');
        return;
      }
      const undiscounted = quantityValue * unitPriceMinor;
      if (!Number.isSafeInteger(undiscounted)) {
        setError('Quantity pricing exceeds the supported total.');
        return;
      }
      const discountMultiplier = 10_000 - discountBasisPoints;
      totalAmountMinor = Math.floor(undiscounted / 10_000) * discountMultiplier
        + Math.round((undiscounted % 10_000) * discountMultiplier / 10_000);
      quantityPricing = {
        quantity: quantityValue,
        unitPriceMinor,
        volumeDiscounts: discountBasisPoints > 0
          ? [{ minimumQuantity: Math.min(quantityValue, 2), discountBasisPoints }]
          : [],
      };
    }
    if (totalAmountMinor === null) {
      setError('Enter a positive amount using the selected mandate currency precision.');
      return;
    }
    const responseTime = String(formData.get('responseTimeHours') ?? '').trim();
    const uptimePercent = String(formData.get('uptimePercent') ?? '').trim();
    const supportHours = String(formData.get('supportHoursPerWeek') ?? '').trim();
    const sla = responseTime || uptimePercent || supportHours
      ? {
          responseTimeHours: Number(responseTime),
          uptimeBasisPoints: Math.round(Number(uptimePercent) * 100),
          supportHoursPerWeek: Number(supportHours),
        }
      : undefined;
    const durationMonths = String(formData.get('durationMonths') ?? '').trim();
    const renewal = String(formData.get('renewal') ?? '').trim();
    const noticeDays = String(formData.get('terminationNoticeDays') ?? '').trim();
    const paymentSchedule = String(formData.get('paymentSchedule') ?? '').trim();
    const contractTerms = durationMonths || renewal || noticeDays || paymentSchedule
      ? {
          durationMonths: durationMonths ? Number(durationMonths) : null,
          renewal,
          terminationNoticeDays: Number(noticeDays),
          paymentSchedule,
        }
      : undefined;
    const conditionWhen = String(formData.get('conditionWhen') ?? '').trim();
    const conditionThen = String(formData.get('conditionThen') ?? '').trim();
    const conditions = conditionWhen || conditionThen
      ? [{ when: conditionWhen, then: conditionThen }]
      : undefined;
    const terms = {
      title: String(formData.get('title') ?? ''),
      category: category.data,
      description: String(formData.get('description') ?? ''),
      amountMinor: totalAmountMinor,
      currency: ownMandate.currency,
      deliveryDays: Number(formData.get('deliveryDays')),
      ...(quantityPricing ? { quantityPricing } : {}),
      ...(sla ? { sla } : {}),
      ...(contractTerms ? { contractTerms } : {}),
      ...(conditions ? { conditions } : {}),
    };
    const validatedTerms = negotiationOfferTermsSchema.safeParse(terms);
    if (!validatedTerms.success) {
      setError('Review the amount and optional commercial terms; one or more values are invalid.');
      return;
    }
    const form = event.currentTarget;
    const success = await runAction(
      () => submitNegotiationOffer(negotiation.id, {
        mandateId: ownMandate.id,
        expectedOfferId: negotiation.currentOfferId,
        terms: validatedTerms.data,
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
        expectedOfferId: negotiation.currentOfferId,
      }),
      (result) => decision === 'accept'
        ? result.status === 'pending_owner_approval'
          ? 'Acceptance requested. Required mandate owners must approve before either budget is reserved.'
          : 'Terms accepted and reserved against both mandates.'
        : decision === 'reject'
          ? 'Negotiation rejected.'
          : 'Negotiation cancelled.',
    );
  };

  const reviewOwnerApproval = async (
    decision: 'approve' | 'reject',
    reason?: string,
  ) => {
    if (!negotiation) {
      return;
    }
    await runAction(
      () => decideNegotiationOwnerApproval(negotiation.id, {
        decision,
        ...(reason ? { reason } : {}),
        expectedOfferId: negotiation.currentOfferId ?? '',
      }),
      (result) => result.status === 'accepted'
        ? 'All required owners approved. The negotiated amount is now reserved against both mandates.'
        : decision === 'approve'
          ? 'Approval recorded. The negotiation remains pending until every required owner approves; no budget is reserved yet.'
          : 'Negotiation rejected by a mandate owner. No budget was reserved.',
    );
  };

  const rejectAsOwner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('Provide a reason before rejecting.');
      return;
    }
    await reviewOwnerApproval('reject', reason);
  };

  const escalateDispute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!negotiation) {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const category = String(formData.get('category') ?? '');
    const reason = String(formData.get('reason') ?? '').trim();
    if (!['delivery', 'quality', 'payment', 'scope', 'other'].includes(category) || reason.length < 10) {
      setError('Choose a dispute category and provide at least 10 characters of detail.');
      return;
    }
    await runAction(
      () => escalateNegotiationDispute(negotiation.id, {
        category: category as 'delivery' | 'quality' | 'payment' | 'scope' | 'other',
        reason,
      }),
      'Dispute escalation recorded.',
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

  const accept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!reason) {
      setError('Provide an acceptance reason before accepting.');
      return;
    }
    await decide('accept', reason);
  };

  const runIntelligence = async (
    input:
      | { action: 'recommend' | 'compare' | 'summarize' | 'analyze' }
      | { action: 'explain_violation'; terms: NonNullable<typeof currentOffer>['terms'] },
  ) => {
    if (!negotiation) {
      return;
    }
    setIntelligenceBusy(true);
    setIntelligenceError(null);
    try {
      setIntelligence(await requestNegotiationIntelligence(negotiation.id, input));
    } catch (caughtError: unknown) {
      setIntelligenceError(
        caughtError instanceof Error ? caughtError.message : 'Negotiation intelligence could not be loaded.',
      );
      setIntelligence(null);
    } finally {
      setIntelligenceBusy(false);
    }
  };

  const loadReplay = async () => {
    setReplayBusy(true);
    setError(null);
    try {
      setReplay(await getNegotiationReplay(negotiationId));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation replay could not be loaded.');
    } finally {
      setReplayBusy(false);
    }
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
  const isRequiredOwner = Boolean(
    user
    && negotiation.status === 'pending_owner_approval'
    && negotiation.ownerApprovalRequiredForViewer,
  );
  const hasApprovedAsOwner = Boolean(
    user && negotiation.ownerApprovalRecordedForViewer,
  );
  const ownerMandatesForReview = isRequiredOwner
    ? mandates.filter((mandate) => (
        mandate.ownerId === user?.uid
        && [negotiation.initiatorMandateId, negotiation.recipientMandateId].includes(mandate.id)
      ))
    : [];

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
          {negotiation.acceptanceReason ? ` Acceptance reason: ${negotiation.acceptanceReason}` : ''}
        </p>
      )}
      {negotiation.status === 'pending_owner_approval' && (
        <p className="border border-orange-700 bg-orange-50 p-4 text-sm text-orange-950">
          Acceptance is pending explicit approval from every required mandate owner. No budget is
          reserved until all required owners approve.
        </p>
      )}
      {isRequiredOwner && hasApprovedAsOwner && (
        <p className="border border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-900">
          Your approval is recorded. The negotiation is waiting for the remaining required owner approvals.
        </p>
      )}
      {negotiation.status === 'rejected' && negotiation.rejectionReason && (
        <p className="border border-red-700 bg-red-50 p-4 text-sm">
          Rejection reason: {negotiation.rejectionReason}
        </p>
      )}
      {detail.dispute && (
        <p className="border border-red-700 bg-red-50 p-4 text-sm">
          Open {detail.dispute.category} dispute raised by {detail.dispute.raisedByAgentId === user?.uid ? 'you' : 'the other participant'}:
          {' '}{detail.dispute.reason}
        </p>
      )}
      {!detail.dispute && negotiation.status === 'accepted' && participantRole && (
        <form onSubmit={escalateDispute} className="grid gap-3 border border-mp-warm-grey bg-mp-surface p-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
          <label>
            <span className="mp-label">Dispute category</span>
            <select name="category" className="mp-input mt-1">
              <option value="delivery">Delivery</option>
              <option value="quality">Quality</option>
              <option value="payment">Payment</option>
              <option value="scope">Scope</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span className="mp-label">Escalation details</span>
            <input name="reason" required minLength={10} maxLength={2000} className="mp-input mt-1" />
          </label>
          <Button type="submit" variant="outline" disabled={busy}>Escalate dispute</Button>
        </form>
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

      {participantRole && (
      <section className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5 sm:p-7" aria-labelledby="ai-intelligence-heading">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-mp-orange" aria-hidden="true" />
          <h2 id="ai-intelligence-heading" className="text-lg font-semibold">Negotiation intelligence</h2>
        </div>
        <p className="text-sm text-mp-medium-grey">
          Suggestions are advisory only. Mandate checks are deterministic; nothing is submitted, approved, or executed for you.
        </p>
        <div className="flex flex-wrap gap-2">
          {!terminal && (
            <Button type="button" variant="outline" disabled={intelligenceBusy || !ownMandate} onClick={() => void runIntelligence({ action: 'recommend' })}>
              {intelligenceBusy ? 'Working…' : 'Get suggestions'}
            </Button>
          )}
          {detail.offers.length > 0 && (
            <Button type="button" variant="outline" disabled={intelligenceBusy} onClick={() => void runIntelligence({ action: 'compare' })}>
              Compare offers
            </Button>
          )}
          <Button type="button" variant="outline" disabled={intelligenceBusy} onClick={() => void runIntelligence({ action: 'summarize' })}>
            Summarize history
          </Button>
          {detail.offers.length > 0 && (
            <Button type="button" variant="outline" disabled={intelligenceBusy} onClick={() => void runIntelligence({ action: 'analyze' })}>
              Analyze terms and outcome
            </Button>
          )}
          {!terminal && currentOffer && ownMandate && (
            <Button
              type="button"
              variant="outline"
              disabled={intelligenceBusy}
              onClick={() => void runIntelligence({ action: 'explain_violation', terms: currentOffer.terms })}
            >
              Check mandate conditions
            </Button>
          )}
        </div>
        {intelligenceError && <p className="text-sm text-red-800" role="alert">{intelligenceError}</p>}
        {intelligence && (
          <div className="space-y-3 border-t border-mp-warm-grey pt-4" aria-live="polite">
            {intelligence.requiresHumanReview && (
              <p className="text-xs text-mp-medium-grey">
                Human review required. {intelligence.confidenceMethod === 'deterministic_rule'
                  ? 'Rule result is not a probability.'
                  : 'Model confidence is not calibrated.'}
              </p>
            )}
            {intelligence.action === 'recommend' && (
              <>
                <p className="mp-kicker">{intelligence.source === 'gemini' ? 'Model-assisted suggestion' : 'Deterministic status'}</p>
                {!intelligence.mandateAssessment.allowed && (
                  <p className="text-sm font-semibold text-red-800">Current offer does not satisfy this mandate.</p>
                )}
                {intelligence.mandateAssessment.requiresApproval && (
                  <p className="text-sm font-semibold text-amber-900">Owner approval is required; this recommendation cannot authorize acceptance.</p>
                )}
                {intelligence.mandateAssessment.reasons.map((reason) => (
                  <p key={reason.code} className="text-sm">{reason.explanation}</p>
                ))}
                {intelligence.notice && <p className="text-sm">{intelligence.notice}</p>}
                {intelligence.recommendation && (
                  <>
                    <p className="text-sm">{intelligence.recommendation.summary}</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {intelligence.recommendation.recommendations.map((item, index) => (
                        <li key={`${item.action}-${index}`}><strong>{item.action}:</strong> {item.rationale}</li>
                      ))}
                    </ul>
                    {intelligence.recommendation.counteroffer && (
                      <p className="border-l-2 border-mp-orange pl-3 text-sm">
                        Suggested counteroffer only: {formatMinorAmount(
                          intelligence.recommendation.counteroffer.amountMinor,
                          intelligence.recommendation.counteroffer.currency,
                        )} · {intelligence.recommendation.counteroffer.deliveryDays} delivery days.
                        {intelligence.counterofferValidation !== 'valid' && ` Not usable: ${intelligence.counterofferRejectionReason}`}
                      </p>
                    )}
                    {intelligence.recommendation.caveats.map((caveat) => (
                      <p key={caveat} className="text-xs text-mp-medium-grey">{caveat}</p>
                    ))}
                  </>
                )}
                {intelligence.counterofferValidation === 'rejected' && intelligence.counterofferRejectionReason && (
                  <p className="text-sm text-red-800">
                    Suggested counteroffer was withheld: {intelligence.counterofferRejectionReason}
                  </p>
                )}
              </>
            )}
            {intelligence.action === 'explain_violation' && (
              <>
                <p className="font-semibold">
                  {intelligence.mandateAssessment.allowed
                    ? intelligence.mandateAssessment.requiresApproval
                      ? 'Terms fit the mandate limits but require explicit owner approval.'
                      : 'Terms satisfy the checked mandate conditions.'
                    : 'Terms do not satisfy the checked mandate conditions.'}
                </p>
                {intelligence.mandateAssessment.reasons.map((reason) => (
                  <p key={reason.code} className="text-sm">{reason.explanation}</p>
                ))}
              </>
            )}
            {intelligence.action === 'compare' && (
              <>
                <p className="mp-kicker">{intelligence.source === 'gemini' ? 'Model-assisted comparison' : 'Deterministic comparison'}</p>
                {intelligence.notice && <p className="text-sm">{intelligence.notice}</p>}
                {intelligence.comparison && (
                  <>
                    <p className="text-sm">{intelligence.comparison.summary}</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {intelligence.comparison.tradeoffs.map((item) => (
                        <li key={item.offerSequence}>Offer #{item.offerSequence}: {item.observation}</li>
                      ))}
                    </ul>
                    {intelligence.comparison.questions.map((question) => <p key={question} className="text-sm">{question}</p>)}
                  </>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr><th className="py-2 pr-3">Offer</th><th className="py-2 pr-3">Price</th><th className="py-2 pr-3">Δ price</th><th className="py-2 pr-3">Delivery</th><th className="py-2">Mandate</th></tr></thead>
                    <tbody>{intelligence.offers.map((offer) => (
                      <tr key={offer.sequence} className="border-t border-mp-warm-grey">
                        <td className="py-2 pr-3">#{offer.sequence} · {offer.perspective === 'you' ? 'You' : 'Other party'}</td>
                        <td className="py-2 pr-3">{formatMinorAmount(offer.amountMinor, offer.currency)}</td>
                        <td className="py-2 pr-3">{offer.priceDeltaFromPreviousMinor === null ? '—' : formatMinorAmount(offer.priceDeltaFromPreviousMinor, offer.currency)}</td>
                        <td className="py-2 pr-3">{offer.deliveryDays} days</td>
                        <td className="py-2">
                          {offer.mandateAllowed
                            ? offer.mandateApprovalRequired ? 'Owner approval required' : 'Within checks'
                            : offer.mandateReasons.join(' ')}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
            {intelligence.action === 'summarize' && (
              <>
                <p className="mp-kicker">{intelligence.source === 'gemini' ? 'Model-generated history summary' : 'Summary unavailable'}</p>
                <p className="text-xs text-mp-medium-grey">
                  Coverage: {intelligence.coverage.includedOffers} of {intelligence.coverage.totalOffers} offers and {intelligence.coverage.includedEvents} of {intelligence.coverage.totalEvents} events.
                </p>
                {intelligence.notice && <p className="text-sm">{intelligence.notice}</p>}
                {intelligence.summary && (
                  <>
                    <p className="text-sm">{intelligence.summary.summary}</p>
                    {intelligence.summary.keyChanges.map((item) => <p key={item} className="text-sm">Change: {item}</p>)}
                    {intelligence.summary.unresolvedQuestions.map((item) => <p key={item} className="text-sm">Open question: {item}</p>)}
                  </>
                )}
              </>
            )}
            {intelligence.action === 'analyze' && (
                  <>
                    <p className="mp-kicker">{intelligence.source === 'gemini' ? 'Advisory analysis' : 'Deterministic price analysis'}</p>
                    <p className="text-xs text-mp-medium-grey">Price analysis includes {intelligence.coverage.includedOffers} of {intelligence.coverage.totalOffers} offers.</p>
                    {intelligence.notice && <p className="text-sm">{intelligence.notice}</p>}
                    {intelligence.observedPriceReference && (
                      <p className="text-sm">
                        Observed price range: {formatMinorAmount(intelligence.observedPriceReference.lowMinor, intelligence.observedPriceReference.currency)}
                        {' – '}{formatMinorAmount(intelligence.observedPriceReference.highMinor, intelligence.observedPriceReference.currency)}
                        {' · median '}{formatMinorAmount(intelligence.observedPriceReference.medianMinor, intelligence.observedPriceReference.currency)}
                        {' · '}{intelligence.observedPriceReference.sampleSize} offers. {intelligence.observedPriceReference.disclaimer}
                      </p>
                    )}
                    {intelligence.analysis && (
                      <>
                        <p className="text-sm font-semibold">Potentially unfavorable terms</p>
                        {intelligence.analysis.unfavorableTerms.map((item, index) => (
                          <p key={`${item.offerSequence}-${index}`} className="text-sm">
                            Offer #{item.offerSequence} · {item.severity}: {item.term} — {item.concern}
                          </p>
                        ))}
                        <p className="text-sm font-semibold">Suggested strategies</p>
                        {intelligence.analysis.strategies.map((item, index) => (
                          <p key={`${item.strategy}-${index}`} className="text-sm">{item.strategy}: {item.rationale}</p>
                        ))}
                        <p className="text-sm">
                          Outcome outlook ({intelligence.analysis.outcomePrediction.likelihood}): {intelligence.analysis.outcomePrediction.rationale}
                        </p>
                      </>
                    )}
                  </>
            )}
          </div>
        )}
      </section>
      )}

      {isRequiredOwner && !hasApprovedAsOwner && (
        <section className="space-y-4 border border-orange-700 bg-orange-50 p-5 sm:p-7">
          <div>
            <p className="mp-kicker">Mandate owner review</p>
            <h2 className="mt-1 text-lg font-semibold">Approve negotiated terms?</h2>
            <p className="mt-2 text-sm">
              Review the offer and your mandate information below. Approval only records the owner
              decision; the server will revalidate both mandates and reserve budget only after every
              required owner approves.
            </p>
          </div>
          <div className="border-t border-orange-200 pt-4">
            <h3 className="font-semibold">Your mandate capacity</h3>
            {ownerMandatesForReview.length === 0 ? (
              <p className="mt-2 text-sm" role="alert">
                Your mandate details are unavailable in this view. The server will still revalidate
                both mandates before recording the final approval.
              </p>
            ) : (
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                {ownerMandatesForReview.map((mandate) => (
                  <div key={mandate.id} className="border border-orange-200 bg-white p-3">
                    <dt className="font-semibold">{mandate.title}</dt>
                    <dd className="mt-1 text-mp-medium-grey">
                      Status: {mandate.status} · Agent: {mandate.authorizedAgentId}
                    </dd>
                    <dd className="mt-1 text-mp-medium-grey">
                      Limit: {formatMinorAmount(mandate.spendingLimitMinor, mandate.currency)}
                    </dd>
                    <dd className="mt-1 text-mp-medium-grey">
                      Available: {formatMinorAmount(
                        mandate.spendingLimitMinor - mandate.spentAmountMinor - mandate.reservedAmountMinor,
                        mandate.currency,
                      )}
                    </dd>
                    <dd className="mt-1 text-mp-medium-grey">
                      This offer: {currentOffer
                        ? formatMinorAmount(currentOffer.terms.amountMinor, currentOffer.terms.currency)
                        : 'No offer'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button type="button" disabled={busy} onClick={() => void reviewOwnerApproval('approve')}>
              <Check size={16} aria-hidden="true" /> {busy ? 'Recording…' : 'Approve terms'}
            </Button>
            <form onSubmit={rejectAsOwner} className="flex flex-wrap items-end gap-2">
              <label>
                <span className="mp-label">Rejection reason</span>
                <input name="reason" required maxLength={1000} className="mp-input mt-1 min-w-64" />
              </label>
              <Button type="submit" variant="outline" disabled={busy}>
                <X size={16} aria-hidden="true" /> Reject terms
              </Button>
            </form>
          </div>
        </section>
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
                <span className="mp-label">Total price ({ownMandate.currency})</span>
                <input name="amount" type="number" min="0" step="any" className="mp-input mt-1" />
                <span className="mt-1 block text-xs text-mp-medium-grey">Required unless quantity pricing is supplied.</span>
              </label>
              <label>
                <span className="mp-label">Delivery days</span>
                <input name="deliveryDays" type="number" min="1" max="3650" required defaultValue={14} className="mp-input mt-1" />
              </label>
              <fieldset className="grid gap-3 border border-mp-warm-grey p-3 sm:col-span-2 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">Quantity and volume pricing (optional)</legend>
                <label><span className="mp-label">Quantity</span><input name="quantity" type="number" min="1" max="1000000" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Unit price ({ownMandate.currency})</span><input name="unitPrice" type="number" min="0" step="any" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Volume discount (%)</span><input name="discountPercent" type="number" min="0" max="50" step="0.01" className="mp-input mt-1" /></label>
              </fieldset>
              <fieldset className="grid gap-3 border border-mp-warm-grey p-3 sm:col-span-2 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">Service-level agreement (optional)</legend>
                <label><span className="mp-label">Response time (hours)</span><input name="responseTimeHours" type="number" min="1" max="8760" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Uptime (%)</span><input name="uptimePercent" type="number" min="50" max="100" step="0.01" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Support hours/week</span><input name="supportHoursPerWeek" type="number" min="0" max="168" className="mp-input mt-1" /></label>
              </fieldset>
              <fieldset className="grid gap-3 border border-mp-warm-grey p-3 sm:col-span-2 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Contract terms (optional)</legend>
                <label><span className="mp-label">Duration (months)</span><input name="durationMonths" type="number" min="1" max="120" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Renewal</span><select name="renewal" defaultValue="" className="mp-input mt-1"><option value="">Not specified</option><option value="none">None</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
                <label><span className="mp-label">Termination notice (days)</span><input name="terminationNoticeDays" type="number" min="0" max="365" className="mp-input mt-1" /></label>
                <label><span className="mp-label">Payment schedule</span><select name="paymentSchedule" defaultValue="" className="mp-input mt-1"><option value="">Not specified</option><option value="upfront">Upfront</option><option value="milestone">Milestone</option><option value="completion">On completion</option></select></label>
              </fieldset>
              <fieldset className="grid gap-3 border border-mp-warm-grey p-3 sm:col-span-2 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Conditional offer (optional)</legend>
                <label><span className="mp-label">If</span><input name="conditionWhen" maxLength={300} className="mp-input mt-1" /></label>
                <label><span className="mp-label">Then</span><input name="conditionThen" maxLength={300} className="mp-input mt-1" /></label>
              </fieldset>
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
                <form onSubmit={accept} className="flex flex-wrap items-end gap-2">
                  <label>
                    <span className="mp-label">Acceptance reason</span>
                    <input name="reason" required maxLength={1000} className="mp-input mt-1 min-w-64" />
                  </label>
                  <Button type="submit" disabled={busy}>
                    <Check size={16} aria-hidden="true" /> Accept latest offer
                  </Button>
                </form>
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Activity timeline</h2>
            <Button type="button" variant="outline" disabled={replayBusy} onClick={() => void loadReplay()}>
              <History size={15} aria-hidden="true" /> {replayBusy ? 'Loading…' : 'Replay versions'}
            </Button>
          </div>
          {detail.events.length === 0 ? (
            <p className="mp-copy mt-3 text-sm">No activity has been recorded.</p>
          ) : (
            <ol className="mt-4 border-l border-mp-warm-grey pl-5">
              {detail.events.map((event) => (
                <li key={event.id} className="relative border-b border-mp-warm-grey pb-4 pt-1 last:border-0">
                  <span className="absolute -left-[1.65rem] top-2 h-2.5 w-2.5 rounded-full bg-mp-orange" aria-hidden="true" />
                  <p className="font-semibold">{eventLabels[event.type] ?? event.type}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {event.actorType === 'system'
                      ? 'MandatePay system'
                      : event.actorType === 'owner'
                      ? event.actorOwnerId === user?.uid ? 'You' : 'Mandate owner'
                      : event.actorAgentId
                        ? event.actorAgentId === user?.uid
                          ? 'You'
                          : event.actorAgentId === negotiation.initiatorAgentId
                            ? negotiation.initiatorDisplayName ?? negotiation.initiatorAgentId
                            : negotiation.recipientDisplayName ?? negotiation.recipientAgentId
                        : 'Mandate owner'}
                    {event.createdAt ? ` · ${new Date(event.createdAt).toLocaleString()}` : ''}
                  </p>
                  {typeof event.details?.reason === 'string' && (
                    <p className="mt-1 text-sm">{event.details.reason}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {replay && (
            <div className="mt-5 border-t border-mp-warm-grey pt-4">
              <p className="mp-kicker">Version replay · current version {replay.currentVersion}</p>
              <ol className="mt-3 space-y-2">
                {replay.snapshots.map((snapshot) => (
                  <li key={snapshot.version} className="border border-mp-warm-grey p-3 text-sm">
                    <p className="font-semibold">Version {snapshot.version} · {snapshot.status.replaceAll('_', ' ')}</p>
                    <p className="mt-1 text-mp-medium-grey">
                      {snapshot.currentOffer
                        ? `Offer #${snapshot.currentOffer.sequence} · ${formatMinorAmount(snapshot.currentOffer.terms.amountMinor, snapshot.currentOffer.terms.currency)}`
                        : 'No offer submitted'}
                      {' · '}{snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleString() : 'Time unavailable'}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
