'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, RotateCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  authorizePayment,
  cancelPayment,
  capturePayment,
  getPayment,
  getPaymentIdempotencyKey,
  getRefundIdempotencyKey,
  createPayment,
  refundPayment,
  type PaymentDetail as PaymentDetailData,
} from '@/lib/payments/client';
import { currencyFractionDigits, formatMinorAmount, parseMajorAmount } from '@/lib/mandates/money';
import type { PaymentStatus } from '@/models/payment';

const statusClassNames: Record<PaymentStatus, string> = {
  created: 'border-blue-700 bg-blue-50 text-blue-800',
  pending: 'border-amber-700 bg-amber-50 text-amber-900',
  authorized: 'border-violet-700 bg-violet-50 text-violet-800',
  processing: 'border-sky-700 bg-sky-50 text-sky-800',
  completed: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  partially_refunded: 'border-amber-700 bg-amber-50 text-amber-900',
  failed: 'border-red-700 bg-red-50 text-red-800',
  cancelled: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  refunded: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
};

const eventLabels: Record<string, string> = {
  'payment.created': 'Payment request created',
  'payment.order_created': 'Sandbox checkout order created',
  'payment.authorization_started': 'Authorization requested',
  'payment.authorized': 'Provider authorization confirmed',
  'payment.capture_started': 'Capture requested after fulfillment confirmation',
  'payment.cancel_started': 'Authorization cancellation requested',
  'payment.retry_started': 'Provider operation retry started',
  'payment.completed': 'Payment capture confirmed',
  'payment.cancelled': 'Payment authorization cancelled',
  'payment.refund_started': 'Refund requested',
  'payment.refund_pending': 'Provider is processing the refund',
  'payment.partially_refunded': 'Partial refund confirmed',
  'payment.refunded': 'Provider refund confirmed',
  'payment.failed': 'Provider operation failed',
  'payment.webhook_processed': 'Provider notification processed',
};

function isSafeApprovalUrl(value: string | null): value is string {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.sandbox.paypal.com');
  } catch {
    return false;
  }
}

function isSafeReceiptUrl(value: string | null): value is string {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Not recorded';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

type Props = { paymentId: string };

export function PaymentDetail({ paymentId }: Props) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<PaymentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fulfillmentConfirmed, setFulfillmentConfirmed] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
    }
    try {
      setDetail(await getPayment(paymentId));
      setError(null);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Payment details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    let active = true;
    getPayment(paymentId)
      .then((nextDetail) => {
        if (active) {
          setDetail(nextDetail);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Payment details could not be loaded.');
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
  }, [paymentId]);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (caughtError: unknown) {
      await load();
      setError(caughtError instanceof Error ? caughtError.message : 'Payment operation could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading payment details…</p>;
  }
  if (!detail) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <p className="border-l-2 border-red-700 bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error ?? 'Payment details are unavailable.'}
        </p>
        <Button type="button" variant="outline" onClick={() => void load(true)}>
          <RotateCw size={15} aria-hidden="true" /> Retry
        </Button>
      </section>
    );
  }

  const { payment, events, refunds } = detail;
  const isPayer = user?.uid === payment.payerId;
  const hasUnapprovedProviderOrder = Boolean(
    payment.providerOrderId
    && !payment.providerAuthorizationId
    && payment.failureCode !== 'PAYMENT_AUTHORIZATION_DENIED',
  );
  const canCancel = isPayer
    && !['completed', 'partially_refunded', 'refunded', 'cancelled'].includes(payment.status)
    && !hasUnapprovedProviderOrder
    && !(payment.status === 'processing' && payment.pendingOperation !== 'cancel');
  const canAuthorize = isPayer && Boolean(payment.providerOrderId) && (
    payment.status === 'pending'
    || (payment.status === 'processing' && payment.pendingOperation === 'authorize')
    || (
      payment.status === 'failed'
      && !payment.providerAuthorizationId
      && payment.failureCode !== 'PAYMENT_AUTHORIZATION_DENIED'
    )
  );
  const canCapture = isPayer && Boolean(payment.providerAuthorizationId) && (
    payment.status === 'authorized'
    || (payment.status === 'processing' && payment.pendingOperation === 'capture')
    || (payment.status === 'failed' && payment.failureCode === 'PAYMENT_CAPTURE_FAILED')
  );
  const canRetryOrder = isPayer
    && (payment.status === 'failed' || payment.status === 'created')
    && !payment.providerOrderId
    && Boolean(user);
  const canRefund = isPayer && (
    payment.status === 'completed'
    || payment.status === 'partially_refunded'
  );
  const refundInProgress = payment.status === 'processing' && payment.pendingOperation === 'refund';
  const pendingRefund = refunds.find((refund) => refund.status === 'processing' || refund.status === 'pending');
  const remainingRefundableMinor = Math.max(0, payment.amountMinor - payment.refundedAmountMinor);

  const startPaymentCycle = async (newCycle: boolean) => {
    if (!user) {
      throw new Error('Sign in before restarting a payment.');
    }
    const key = getPaymentIdempotencyKey(user.uid, payment.contractId, newCycle);
    await createPayment(payment.contractId, key);
    await load();
  };

  const submitCancellation = (formData: FormData) => {
    const reason = String(formData.get('cancelReason') ?? '').trim();
    if (!reason) {
      setError('Enter a cancellation reason.');
      return;
    }
    void runAction(() => cancelPayment(payment.id, reason), 'Cancellation was submitted; the server/provider state is shown below.');
  };

  const submitRefund = (formData: FormData) => {
    const reason = String(formData.get('refundReason') ?? '').trim();
    const amountValue = String(formData.get('refundAmount') ?? '').trim();
    if (!reason) {
      setError('Enter a refund reason.');
      return;
    }
    const parsedAmountMinor = amountValue ? parseMajorAmount(amountValue, payment.currency) : undefined;
    if (parsedAmountMinor === null) {
      setError(`Enter a valid amount in ${payment.currency}.`);
      return;
    }
    const amountMinor = parsedAmountMinor ?? undefined;
    if (!user) {
      setError('Sign in before requesting a refund.');
      return;
    }
    const idempotencyKey = getRefundIdempotencyKey(user.uid, payment.id, refundInProgress);
    void runAction(
      () => refundPayment(payment.id, reason, idempotencyKey, amountMinor),
      'Refund request submitted. The displayed state comes from the server/provider.',
    );
  };

  return (
    <section className="mp-page mx-auto w-full max-w-5xl space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-mp-warm-grey pb-6">
        <div>
          <Link href="/payments" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold underline decoration-mp-orange decoration-2 underline-offset-4">
            <ArrowLeft size={16} aria-hidden="true" /> All payments
          </Link>
          <p className="mp-kicker mt-4">Sandbox transaction</p>
          <h1 className="mp-page-title mt-2">{payment.serviceTitle}</h1>
          <p className="mp-copy mt-2">Contract {payment.contractId}</p>
        </div>
        <span className={`inline-flex border px-3 py-2 text-sm font-semibold uppercase ${statusClassNames[payment.status]}`}>
          {payment.status}
        </span>
      </header>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-red-700 bg-mp-surface px-4 py-3 text-sm" role="alert">
          <span>{error}</span>
          <Button type="button" variant="outline" onClick={() => void load(true)}>
            <RotateCw size={15} aria-hidden="true" /> Reload status
          </Button>
        </div>
      )}
      {notice && <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="status">{notice}</p>}

      <section className="grid gap-4 border border-mp-warm-grey bg-mp-surface p-5 sm:grid-cols-2">
        <div>
          <p className="mp-kicker">Approved amount</p>
          <p className="mt-2 text-2xl font-semibold">{formatMinorAmount(payment.amountMinor, payment.currency)}</p>
          <p className="mt-1 text-sm text-mp-medium-grey">{payment.currency} · Calculated from the approved contract</p>
        </div>
        <div className="sm:border-l sm:border-mp-warm-grey sm:pl-5">
          <p className="mp-kicker">Parties</p>
          <p className="mt-2 text-sm"><span className="font-semibold">Payer:</span> {payment.payerId}</p>
          <p className="mt-1 text-sm"><span className="font-semibold">Payee:</span> {payment.payeeId}</p>
          <p className="mt-2 text-xs text-mp-medium-grey">Owner approval recorded {formatDate(payment.mandateApproval.approvedAt)}</p>
        </div>
        <div className="border-t border-mp-warm-grey pt-4">
          <p className="mp-kicker">Authorization</p>
          <p className="mt-2 text-sm">{payment.providerAuthorizationId ? 'Authorized by PayPal sandbox' : 'Not authorized'}</p>
          {payment.authorizedAt && <p className="mt-1 text-xs text-mp-medium-grey">{formatDate(payment.authorizedAt)}</p>}
        </div>
        <div className="border-t border-mp-warm-grey pt-4 sm:border-l sm:pl-5">
          <p className="mp-kicker">Settlement</p>
          <p className="mt-2 text-sm">
            {['completed', 'partially_refunded', 'refunded'].includes(payment.status)
              ? 'Capture confirmed by PayPal sandbox'
              : 'No completed capture recorded'}
          </p>
          {payment.completedAt && <p className="mt-1 text-xs text-mp-medium-grey">{formatDate(payment.completedAt)}</p>}
          {payment.providerCaptureId && (
            <p className="mt-2 break-all text-xs text-mp-medium-grey">Capture reference: {payment.providerCaptureId}</p>
          )}
          {isSafeReceiptUrl(payment.receiptUrl) && (
            <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-semibold underline">
              View provider receipt <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      </section>

      {payment.providerCaptureId && ['completed', 'partially_refunded', 'refunded'].includes(payment.status) && (
        <section className="border border-mp-warm-grey bg-mp-surface p-5" aria-labelledby="payment-receipt-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="payment-receipt-heading" className="text-lg font-semibold">Payment receipt</h2>
              <p className="mp-copy mt-1 text-sm">
                Transaction record from the provider-confirmed capture; this is not a provider-hosted receipt.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Print receipt
            </Button>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Payment ID</dt><dd className="break-all">{payment.id}</dd></div>
            <div><dt className="font-semibold">Provider</dt><dd>PayPal sandbox</dd></div>
            <div><dt className="font-semibold">Captured amount</dt><dd>{formatMinorAmount(payment.amountMinor, payment.currency)}</dd></div>
            <div><dt className="font-semibold">Refunded amount</dt><dd>{formatMinorAmount(payment.refundedAmountMinor, payment.currency)}</dd></div>
            <div><dt className="font-semibold">Capture reference</dt><dd className="break-all">{payment.providerCaptureId}</dd></div>
            <div><dt className="font-semibold">Capture date</dt><dd>{formatDate(payment.completedAt)}</dd></div>
          </dl>
        </section>
      )}

      {(payment.status === 'pending' || payment.status === 'created') && isSafeApprovalUrl(payment.approvalUrl) && (
        <section className="border-l-2 border-mp-orange bg-mp-surface p-5">
          <h2 className="font-semibold">Continue to PayPal sandbox</h2>
          <p className="mp-copy mt-1 text-sm">Approval does not complete the payment. MandatePay verifies authorization and capture separately.</p>
          <a
            href={payment.approvalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-mp-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Open secure checkout <ExternalLink size={15} aria-hidden="true" />
          </a>
        </section>
      )}
      {hasUnapprovedProviderOrder && (
        <p className="border-l-2 border-amber-700 bg-mp-surface px-4 py-3 text-sm">
          This provider order is awaiting approval. MandatePay cannot safely release its reservation
          until the order is approved and its authorization can be voided, or the provider reports a
          denial.
        </p>
      )}

      <section aria-labelledby="payment-actions-heading" className="space-y-4 border-t border-mp-warm-grey pt-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={21} className="text-mp-orange" aria-hidden="true" />
          <h2 id="payment-actions-heading" className="text-xl font-semibold">Available actions</h2>
        </div>
        {!isPayer && <p className="mp-copy text-sm">Only the approved payer account can authorize, capture, cancel, or refund this payment.</p>}

        {refundInProgress && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-sky-700 bg-mp-surface px-4 py-3 text-sm" role="status">
            <span>A refund is awaiting provider confirmation. The mandate ledger will not change until the provider confirms it.</span>
            {isPayer && pendingRefund && user && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                () => refundPayment(
                  payment.id,
                  pendingRefund.reason,
                  getRefundIdempotencyKey(user.uid, payment.id, true),
                  pendingRefund.amountMinor,
                ),
                'Refund status was refreshed from the server/provider.',
              )}>
                Retry refund status
              </Button>
            )}
          </div>
        )}

        {canAuthorize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-mp-warm-grey bg-mp-surface p-4">
            <div>
              <p className="font-semibold">Confirm authorization</p>
              <p className="mp-copy mt-1 text-sm">The server will verify the provider order and amount.</p>
            </div>
            <Button
              type="button"
              onClick={() => void runAction(
                () => authorizePayment(payment.id),
                'Authorization status was refreshed from the server/provider.',
              )}
              disabled={busy}
            >
              {busy ? 'Checking…' : 'Confirm authorization'}
            </Button>
          </div>
        )}

        {canCapture && (
          <div
            className="border border-mp-warm-grey bg-mp-surface p-4"
          >
            <p className="font-semibold">Capture after fulfillment</p>
            <p className="mp-copy mt-1 text-sm">Confirm that the contracted service was delivered. This only requests capture; provider confirmation determines the final state.</p>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={fulfillmentConfirmed}
                onChange={(event) => setFulfillmentConfirmed(event.target.checked)}
                className="mt-1 accent-mp-orange"
              />
              The contracted service has been fulfilled.
            </label>
            <Button type="button" className="mt-4" disabled={busy || !fulfillmentConfirmed} onClick={() => void runAction(
              () => capturePayment(payment.id),
              'Capture request submitted. The payment remains pending until provider confirmation.',
            )}>
              {busy ? 'Submitting…' : 'Capture payment'}
            </Button>
          </div>
        )}

        {canRetryOrder && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-mp-warm-grey bg-mp-surface p-4">
            <div>
              <p className="font-semibold">Retry sandbox order setup</p>
              <p className="mp-copy mt-1 text-sm">The same idempotency key is reused for this order attempt.</p>
            </div>
            <Button type="button" disabled={busy} onClick={() => void runAction(
              () => startPaymentCycle(false),
              'A new sandbox payment cycle was started.',
            )}>
              Retry order
            </Button>
          </div>
        )}

        {canCancel && (
          <form
            className="border border-mp-warm-grey bg-mp-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitCancellation(new FormData(event.currentTarget));
            }}
          >
            <label className="block text-sm font-semibold" htmlFor="cancel-reason">Cancel payment</label>
            <p className="mp-copy mt-1 text-sm">Any active provider authorization is voided before reservations are released. Unapproved provider orders cannot be safely released.</p>
            <input
              id="cancel-reason"
              name="cancelReason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              maxLength={500}
              required
              className="mt-3 min-h-10 w-full rounded-md border border-mp-warm-grey bg-white px-3 text-sm"
              placeholder="Reason for cancellation"
            />
            <Button type="submit" className="mt-3" variant="outline" disabled={busy || !cancelReason.trim()}>
              Cancel payment
            </Button>
          </form>
        )}

        {canRefund && (
          <form
            className="border border-mp-warm-grey bg-mp-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRefund(new FormData(event.currentTarget));
            }}
          >
            <label className="block text-sm font-semibold" htmlFor="refund-amount">Refund amount (optional)</label>
            <p className="mp-copy mt-1 text-sm">
              Leave blank to refund the remaining {formatMinorAmount(remainingRefundableMinor, payment.currency)}.
              The mandate ledger changes only after provider confirmation.
            </p>
            <input
              id="refund-amount"
              name="refundAmount"
              type="number"
              inputMode="decimal"
              min={1 / (10 ** currencyFractionDigits(payment.currency))}
              max={remainingRefundableMinor / (10 ** currencyFractionDigits(payment.currency))}
              step={currencyFractionDigits(payment.currency) === 0
                ? '1'
                : (1 / (10 ** currencyFractionDigits(payment.currency))).toString()}
              value={refundAmount}
              onChange={(event) => setRefundAmount(event.target.value)}
              className="mt-3 min-h-10 w-full rounded-md border border-mp-warm-grey bg-white px-3 text-sm"
              placeholder={`Up to ${formatMinorAmount(remainingRefundableMinor, payment.currency)}`}
            />
            <label className="mt-3 block text-sm font-semibold" htmlFor="refund-reason">Refund reason</label>
            <input
              id="refund-reason"
              name="refundReason"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
              maxLength={500}
              required
              className="mt-3 min-h-10 w-full rounded-md border border-mp-warm-grey bg-white px-3 text-sm"
              placeholder="Reason for refund"
            />
            <Button type="submit" className="mt-3" variant="outline" disabled={busy || !refundReason.trim()}>
              Request refund
            </Button>
          </form>
        )}

        {payment.failureCode && (
          <p className="border-l-2 border-red-700 bg-mp-surface px-4 py-3 text-sm" role="alert">
            Payment needs attention: {payment.failureCode.replaceAll('_', ' ').toLowerCase()}.
          </p>
        )}
        {payment.status === 'cancelled' && (
          <div className="border border-mp-warm-grey bg-mp-surface p-4">
            <p className="font-semibold">Payment cancelled</p>
            <p className="mp-copy mt-1 text-sm">{payment.cancellationReason ?? 'The provider order was cancelled and reservations were released.'}</p>
            <Button type="button" className="mt-3" disabled={busy} onClick={() => void runAction(
              () => startPaymentCycle(true),
              'A new sandbox payment cycle was started.',
            )}>
              Start new payment cycle
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="payment-history-heading" className="border-t border-mp-warm-grey pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mp-kicker">Audit trail</p>
            <h2 id="payment-history-heading" className="mt-1 text-xl font-semibold">Payment and refund history</h2>
          </div>
          <Badge variant={['completed', 'partially_refunded', 'refunded'].includes(payment.status) ? 'success' : 'info'}>
            {events.length} events · {refunds.length} refunds
          </Badge>
        </div>
        {events.length === 0 && refunds.length === 0 ? (
          <p className="mp-empty-state mt-4 p-5 text-sm text-mp-medium-grey">No payment events have been recorded.</p>
        ) : (
          <ol className="mt-4 border-l border-mp-warm-grey">
            {refunds.map((refund) => (
              <li key={`refund-${refund.id}`} className="relative ml-5 border-b border-mp-warm-grey py-4 last:border-0">
                <span className="absolute -left-[1.55rem] top-5 h-2 w-2 rounded-full bg-mp-orange" aria-hidden="true" />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Refund {refund.status}</h3>
                    <p className="mp-copy mt-1 text-sm">{refund.reason}</p>
                    {refund.providerRefundId && (
                      <p className="mt-1 break-all text-xs text-mp-medium-grey">Provider refund: {refund.providerRefundId}</p>
                    )}
                    <p className="mt-1 text-xs text-mp-medium-grey">{formatDate(refund.createdAt)}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMinorAmount(refund.amountMinor, refund.currency)}</p>
                </div>
              </li>
            ))}
            {events.map((event) => (
              <li key={event.id} className="relative ml-5 border-b border-mp-warm-grey py-4 last:border-0">
                <span className="absolute -left-[1.55rem] top-5 h-2 w-2 rounded-full bg-mp-orange" aria-hidden="true" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{eventLabels[event.type] ?? event.type.replaceAll('.', ' ')}</h3>
                  <time className="text-xs text-mp-medium-grey" dateTime={event.createdAt ?? undefined}>
                    {formatDate(event.createdAt)}
                  </time>
                </div>
                {event.details && (
                  <p className="mp-copy mt-1 text-sm">
                    {typeof event.details.outcome === 'string'
                      ? event.details.outcome.replaceAll('_', ' ')
                      : typeof event.details.operation === 'string'
                        ? `${event.details.operation} operation`
                        : 'Payment state recorded by the server.'}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
