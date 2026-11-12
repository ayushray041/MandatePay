'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleDollarSign, ExternalLink, RotateCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { listContracts } from '@/lib/contracts/client';
import {
  authorizePayment,
  createPayment,
  getPaymentIdempotencyKey,
  listPayments,
} from '@/lib/payments/client';
import { formatMinorAmount } from '@/lib/mandates/money';
import type { ContractRecord } from '@/models/contract';
import type { PaymentRecord, PaymentStatus } from '@/models/payment';

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

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex border px-2 py-1 text-xs font-semibold uppercase ${statusClassNames[status]}`}>
      {status}
    </span>
  );
}

export function PaymentWorkspace() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const processedReturn = useRef<string | null>(null);
  const queryPaymentId = searchParams.get('paymentId');
  const queryAction = searchParams.get('action');

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setRefreshing(true);
    }
    try {
      const [nextPayments, nextContracts] = await Promise.all([listPayments(), listContracts()]);
      setPayments(nextPayments);
      setContracts(nextContracts);
      setError(null);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Payment workspace could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([listPayments(), listContracts()])
      .then(([nextPayments, nextContracts]) => {
        if (active) {
          setPayments(nextPayments);
          setContracts(nextContracts);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Payment workspace could not be loaded.');
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

  useEffect(() => {
    if (
      queryAction !== 'authorize'
      || !queryPaymentId
      || processedReturn.current === queryPaymentId
    ) {
      return;
    }
    processedReturn.current = queryPaymentId;
    void Promise.resolve()
      .then(() => {
        setAuthorizing(true);
        setError(null);
        return authorizePayment(queryPaymentId);
      })
      .then(() => {
        setNotice('PayPal returned from checkout. The server confirmed the authorization state.');
        return load();
      })
      .catch((caughtError: unknown) => {
        setError(caughtError instanceof Error
          ? caughtError.message
          : 'Payment authorization could not be confirmed.');
      })
      .finally(() => {
        setAuthorizing(false);
        router.replace('/payments');
      });
  }, [load, queryAction, queryPaymentId, router]);
  const paymentsByContract = new Map(payments.map((payment) => [payment.contractId, payment]));
  const payableContracts = contracts.filter((contract) => {
    const payment = paymentsByContract.get(contract.id);
    return contract.status === 'active' && (!payment || payment.status === 'cancelled');
  });

  const startPayment = async (contract: ContractRecord) => {
    if (!user) {
      setError('Sign in before starting a payment.');
      return;
    }
    setCreatingId(contract.id);
    setError(null);
    setNotice(null);
    try {
      const existing = paymentsByContract.get(contract.id);
      const key = getPaymentIdempotencyKey(user.uid, contract.id, existing?.status === 'cancelled');
      const payment = await createPayment(contract.id, key);
      setNotice('Sandbox payment order created. Continue to PayPal to authorize it.');
      router.push(`/payments/${encodeURIComponent(payment.id)}`);
      await load();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Payment could not be started.');
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Financial operations</p>
          <h1 className="mp-page-title mt-2">Payments</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Track sandbox authorization, capture, cancellation, and refund activity for approved contracts.
          </p>
        </div>
        <Badge variant="warning">PayPal sandbox only</Badge>
      </header>

      {queryAction === 'cancelled' && queryPaymentId && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="status">
          Sandbox checkout was closed. No payment is reported as completed.
        </p>
      )}
      {authorizing && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="status">
          Confirming the PayPal authorization with the server…
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-red-700 bg-mp-surface px-4 py-3 text-sm" role="alert">
          <span>{error}</span>
          <Button type="button" variant="outline" onClick={() => void load(true)}>
            <RotateCw size={15} aria-hidden="true" /> Retry
          </Button>
        </div>
      )}
      {notice && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="status">
          {notice}
        </p>
      )}

      <section aria-labelledby="transaction-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mp-kicker">Transaction register</p>
            <h2 id="transaction-heading" className="mt-1 text-xl font-semibold">Payment activity</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-mp-medium-grey">{payments.length} transactions</span>
            <Button type="button" variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RotateCw size={15} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading payment history…</p>
        ) : payments.length === 0 ? (
          <div className="mp-empty-state px-6 py-10 text-center">
            <CircleDollarSign size={25} className="mx-auto text-mp-medium-grey" aria-hidden="true" />
            <h3 className="mt-3 font-semibold">No payment activity yet</h3>
            <p className="mp-copy mt-1">Start a sandbox payment from an active, approved contract below.</p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-4 border border-mp-warm-grey bg-mp-surface p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-semibold">{payment.serviceTitle}</h3>
                    <PaymentStatusBadge status={payment.status} />
                  </div>
                  <p className="mt-2 text-sm text-mp-medium-grey">
                    Contract {payment.contractId} · {formatMinorAmount(payment.amountMinor, payment.currency)}
                  </p>
                  {payment.failureCode && (
                    <p className="mt-1 text-sm text-red-800">Attention: {payment.failureCode.replaceAll('_', ' ').toLowerCase()}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {payment.status === 'pending' && isSafeApprovalUrl(payment.approvalUrl) && (
                    <a
                      href={payment.approvalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                    >
                      Open PayPal <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  )}
                  <Link
                    href={`/payments/${encodeURIComponent(payment.id)}`}
                    className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                  >
                    Details <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="start-payment-heading" className="border-t border-mp-warm-grey pt-8">
        <div className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-mp-orange" aria-hidden="true" />
          <div>
            <p className="mp-kicker">Approved contracts</p>
            <h2 id="start-payment-heading" className="mt-1 text-xl font-semibold">Start a sandbox payment</h2>
          </div>
        </div>
        <p className="mp-copy mt-2 max-w-3xl text-sm">
          The server calculates the amount from the approved contract and checks both mandate reservations.
          Never enter or send a payment amount from the browser.
        </p>
        {loading ? (
          <p className="py-8 text-sm text-mp-medium-grey" role="status">Loading eligible contracts…</p>
        ) : payableContracts.length === 0 ? (
          <p className="mt-4 border border-mp-warm-grey bg-mp-surface p-5 text-sm text-mp-medium-grey">
            No active contracts are currently available for a new payment.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {payableContracts.map((contract) => (
              <li key={contract.id} className="flex items-center justify-between gap-4 border border-mp-warm-grey bg-mp-surface p-4">
                <div>
                  <p className="font-semibold">Contract {contract.negotiationId}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {paymentsByContract.get(contract.id)?.status === 'cancelled'
                      ? 'Start a new sandbox payment cycle'
                      : 'Approved and active'}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => void startPayment(contract)}
                  disabled={creatingId !== null}
                >
                  {creatingId === contract.id ? 'Starting…' : 'Start payment'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
