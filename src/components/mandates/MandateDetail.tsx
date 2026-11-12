'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, Clock3, Pause, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  createMandateAuthorization,
  decideMandateAuthorization,
  decideMandateLimitIncrease,
  getMandate,
  listMandateAuthorizations,
  performMandateAction,
  requestMandateLimitIncrease,
} from '@/lib/mandates/client';
import {
  currencyFractionDigits,
  formatMinorAmount,
  parseMajorAmount,
} from '@/lib/mandates/money';
import {
  type MandateAuthorizationRecord,
  type MandateOperation,
  type MandateRecord,
  type MandateStatus,
} from '@/models/mandate';

const operationLabels: Record<MandateOperation, string> = {
  'contract.create': 'Create a contract',
  'contract.amend': 'Propose a contract amendment',
  'payment.authorize': 'Authorize a payment',
};

const statusStyles: Record<MandateStatus, string> = {
  draft: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  active: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  paused: 'border-amber-700 bg-amber-50 text-amber-900',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  revoked: 'border-red-700 bg-red-50 text-red-800',
};

function percentage(mandate: MandateRecord): number {
  return Math.min(100, Math.round(
    mandate.spentAmountMinor / mandate.spendingLimitMinor * 100,
  ));
}

export function MandateDetail({ mandateId }: { mandateId: string }) {
  const { user } = useAuth();
  const [mandate, setMandate] = useState<MandateRecord | null>(null);
  const [authorizations, setAuthorizations] = useState<MandateAuthorizationRecord[]>([]);
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
      const [nextMandate, nextAuthorizations] = await Promise.all([
        getMandate(mandateId),
        listMandateAuthorizations(mandateId),
      ]);
      setMandate(nextMandate);
      setAuthorizations(nextAuthorizations);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Mandate details could not be loaded.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [mandateId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getMandate(mandateId),
      listMandateAuthorizations(mandateId),
    ])
      .then(([nextMandate, nextAuthorizations]) => {
        if (active) {
          setMandate(nextMandate);
          setAuthorizations(nextAuthorizations);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Mandate details could not be loaded.');
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
  }, [mandateId]);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load(false);
      return true;
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'The mandate action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleOperationRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mandate) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const amountMinor = parseMajorAmount(
      String(formData.get('amount') ?? ''),
      mandate.currency,
    );
    if (amountMinor === null) {
      setError('Enter a valid positive operation amount.');
      return;
    }

    const succeeded = await runAction(
      () => createMandateAuthorization(mandate.id, {
        operation: String(formData.get('operation') ?? ''),
        amountMinor,
        description: String(formData.get('description') ?? ''),
      }),
      'Operation request submitted. The backend checked the mandate rules and budget.',
    );
    if (succeeded) {
      form.reset();
    }
  };

  const handleLimitRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mandate) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const requestedLimitMinor = parseMajorAmount(
      String(formData.get('requestedLimit') ?? ''),
      mandate.currency,
    );
    if (requestedLimitMinor === null) {
      setError('Enter a valid positive requested limit.');
      return;
    }

    const succeeded = await runAction(
      () => requestMandateLimitIncrease(
        mandate.id,
        requestedLimitMinor,
        String(formData.get('reason') ?? ''),
      ),
      'Spending-limit increase request submitted for owner approval.',
    );
    if (succeeded) {
      form.reset();
    }
  };

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
        Loading mandate…
      </p>
    );
  }

  if (error && !mandate) {
    return (
      <section className="mx-auto max-w-3xl space-y-4 py-8">
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error}
        </p>
        <Button type="button" onClick={() => void load()}>Try again</Button>
        <Link href="/mandates" className="ml-4 text-sm underline">Back to mandates</Link>
      </section>
    );
  }

  if (!mandate) {
    return null;
  }

  const isOwner = mandate.ownerId === user?.uid;
  const isAgent = mandate.authorizedAgentId === user?.uid;
  const progress = percentage(mandate);
  const pendingLimitRequest = mandate.pendingLimitRequest;
  const mayRequestLimit =
    isAgent && mandate.status !== 'expired' && mandate.status !== 'revoked';

  return (
    <section className="mp-page mx-auto w-full max-w-6xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <Link href="/mandates" className="inline-flex items-center gap-2 text-sm font-semibold text-mp-medium-grey">
          <ArrowLeft size={16} aria-hidden="true" />
          All mandates
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="mp-kicker">Mandate details</p>
          <span className={`border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${statusStyles[mandate.status]}`}>
            {mandate.status}
          </span>
        </div>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="mp-page-title">{mandate.title}</h1>
            <p className="mp-copy mt-3 max-w-3xl">{mandate.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwner && mandate.status === 'draft' && (
              <Link
                href={`/mandates/${encodeURIComponent(mandate.id)}/edit`}
                className="inline-flex min-h-10 items-center border border-mp-warm-grey bg-mp-surface px-4 text-sm font-semibold"
              >
                Edit draft
              </Link>
            )}
            {isOwner && mandate.status === 'draft' && (
              <Button type="button" disabled={busy} onClick={() => void runAction(
                () => performMandateAction(mandate.id, 'activate'),
                'Mandate activated.',
              )}>
                <Play size={16} aria-hidden="true" /> Activate
              </Button>
            )}
            {isOwner && mandate.status === 'active' && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                () => performMandateAction(mandate.id, 'pause'),
                'Mandate paused.',
              )}>
                <Pause size={16} aria-hidden="true" /> Pause
              </Button>
            )}
            {isOwner && mandate.status === 'paused' && (
              <Button type="button" disabled={busy} onClick={() => void runAction(
                () => performMandateAction(mandate.id, 'resume'),
                'Mandate resumed.',
              )}>
                <Play size={16} aria-hidden="true" /> Resume
              </Button>
            )}
            {isOwner && ['draft', 'active', 'paused'].includes(mandate.status) && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => {
                if (window.confirm('Revoke this mandate? This cannot be undone.')) {
                  void runAction(
                    () => performMandateAction(mandate.id, 'revoke'),
                    'Mandate revoked.',
                  );
                }
              }}>
                <Ban size={16} aria-hidden="true" /> Revoke
              </Button>
            )}
          </div>
        </div>
      </header>

      {(error || notice) && (
        <p
          className={`border-l-2 px-4 py-3 text-sm ${error ? 'border-mp-orange bg-mp-surface' : 'border-emerald-700 bg-emerald-50'}`}
          role={error ? 'alert' : 'status'}
        >
          {error ?? notice}
        </p>
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)]">
        <div className="border border-mp-warm-grey bg-mp-surface p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mp-kicker">Spending authority</p>
              <p className="mt-2 text-3xl font-bold tracking-tight">
                {formatMinorAmount(mandate.spendingLimitMinor, mandate.currency)}
              </p>
              <p className="mt-1 text-sm text-mp-medium-grey">
                {formatMinorAmount(mandate.spentAmountMinor, mandate.currency)} committed
              </p>
            </div>
            <ShieldCheck className="text-mp-orange" size={24} aria-hidden="true" />
          </div>
          <div className="mt-6" aria-label={`${progress}% of budget committed`}>
            <div className="mb-2 flex justify-between text-sm">
              <span>Budget committed</span>
              <span className="font-semibold">{progress}%</span>
            </div>
            <div className="h-3 overflow-hidden bg-mp-app-bg">
              <div className="h-full bg-mp-orange" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-sm text-mp-medium-grey">
              {formatMinorAmount(
                Math.max(0, mandate.spendingLimitMinor - mandate.spentAmountMinor),
                mandate.currency,
              )} remaining
            </p>
          </div>
        </div>

        <div className="grid gap-4 border border-mp-warm-grey bg-mp-surface p-5 sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <p className="mp-kicker">Owner</p>
            <p className="mt-1 truncate font-mono text-sm">{mandate.ownerId}</p>
          </div>
          <div>
            <p className="mp-kicker">Authorized agent</p>
            <p className="mt-1 truncate font-mono text-sm">{mandate.authorizedAgentId}</p>
          </div>
          <div>
            <p className="mp-kicker">Execution window</p>
            <p className="mt-1 text-sm">
              {mandate.startsAt ? new Date(mandate.startsAt).toLocaleString() : 'Unavailable'}
              {' – '}
              {mandate.expiresAt ? new Date(mandate.expiresAt).toLocaleString() : 'Unavailable'}
            </p>
          </div>
          <div>
            <p className="mp-kicker">Currency</p>
            <p className="mt-1 text-sm">{mandate.currency}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="border-t border-mp-warm-grey pt-5">
          <h2 className="text-lg font-semibold">Allowed operations</h2>
          <ul className="mt-3 space-y-2">
            {mandate.allowedOperations.map((operation) => (
              <li key={operation} className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-emerald-700" aria-hidden="true" />
                {operationLabels[operation]}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-mp-warm-grey pt-5">
          <h2 className="text-lg font-semibold">Approval requirements</h2>
          {mandate.approvalRequirements.ownerApprovalOperations.length === 0
          && mandate.approvalRequirements.ownerApprovalAboveMinor === undefined ? (
            <p className="mp-copy mt-3">No additional owner approval is required for allowed operations.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {mandate.approvalRequirements.ownerApprovalOperations.map((operation) => (
                <li key={operation}>Owner approval: {operationLabels[operation]}</li>
              ))}
              {mandate.approvalRequirements.ownerApprovalAboveMinor !== undefined && (
                <li>
                  Owner approval above{' '}
                  {formatMinorAmount(mandate.approvalRequirements.ownerApprovalAboveMinor, mandate.currency)}
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="border-t border-mp-warm-grey pt-5 md:col-span-2">
          <h2 className="text-lg font-semibold">Execution conditions</h2>
          <ul className="mt-3 space-y-2 text-sm text-mp-medium-grey">
            {mandate.executionConditions.maximumOperationAmountMinor !== undefined && (
              <li>
                Maximum per operation:{' '}
                {formatMinorAmount(mandate.executionConditions.maximumOperationAmountMinor, mandate.currency)}
              </li>
            )}
            {mandate.executionConditions.requiredDescriptionTerms.map((term) => (
              <li key={term}>Description must include “{term}”</li>
            ))}
            {mandate.executionConditions.maximumOperationAmountMinor === undefined
            && mandate.executionConditions.requiredDescriptionTerms.length === 0 && (
              <li>No custom execution conditions.</li>
            )}
          </ul>
        </div>
      </section>

      {pendingLimitRequest && (
        <section className="border-l-2 border-amber-700 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <Clock3 size={18} aria-hidden="true" />
            <h2 className="font-semibold">Spending-limit increase request</h2>
          </div>
          <p className="mt-2 text-sm">
            {formatMinorAmount(pendingLimitRequest.previousLimitMinor, mandate.currency)} →{' '}
            {formatMinorAmount(pendingLimitRequest.requestedLimitMinor, mandate.currency)}
          </p>
          <p className="mt-1 text-sm text-mp-medium-grey">{pendingLimitRequest.reason}</p>
          {isOwner && (
            <div className="mt-4 flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void runAction(
                () => decideMandateLimitIncrease(mandate.id, 'approve'),
                'Spending-limit increase approved.',
              )}>Approve request</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                () => decideMandateLimitIncrease(mandate.id, 'reject'),
                'Spending-limit increase rejected.',
              )}>Reject</Button>
            </div>
          )}
        </section>
      )}

      {mayRequestLimit && !pendingLimitRequest && (
        <form onSubmit={handleLimitRequest} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <h2 className="text-lg font-semibold">Request a higher spending limit</h2>
          <p className="mp-copy">
            The current limit cannot be changed directly. The mandate owner must approve a
            separate request.
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <label>
              <span className="mp-label">Requested limit ({mandate.currency})</span>
              <input name="requestedLimit" required type="number" min="0" step={1 / 10 ** currencyFractionDigits(mandate.currency)} className="mp-input mt-1" />
            </label>
            <label>
              <span className="mp-label">Reason</span>
              <input name="reason" required maxLength={1000} className="mp-input mt-1" />
            </label>
            <Button type="submit" disabled={busy} className="self-end">
              {busy ? 'Submitting…' : 'Request increase'}
            </Button>
          </div>
        </form>
      )}

      {isAgent && mandate.status === 'active' && (
        <form onSubmit={handleOperationRequest} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <h2 className="text-lg font-semibold">Request an operation</h2>
          <p className="mp-copy">
            The server checks status, operation permissions, conditions, approvals, and remaining
            budget before recording an authorization.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mp-label">Operation</span>
              <select name="operation" required className="mp-input mt-1">
                {mandate.allowedOperations.map((operation) => (
                  <option key={operation} value={operation}>{operationLabels[operation]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mp-label">Amount ({mandate.currency})</span>
              <input name="amount" required type="number" min="0" step={1 / 10 ** currencyFractionDigits(mandate.currency)} className="mp-input mt-1" />
            </label>
            <label className="sm:col-span-2">
              <span className="mp-label">Operation description</span>
              <input name="description" required maxLength={500} className="mp-input mt-1" />
            </label>
          </div>
          <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Request operation'}</Button>
        </form>
      )}

      <section className="border-t border-mp-warm-grey pt-6">
        <h2 className="text-lg font-semibold">Operation authorizations</h2>
        {authorizations.length === 0 ? (
          <p className="mp-copy mt-3">No operation authorizations have been requested.</p>
        ) : (
          <ul className="mt-4 divide-y divide-mp-warm-grey border-y border-mp-warm-grey">
            {authorizations.map((authorization) => (
              <li key={authorization.id} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-semibold">{operationLabels[authorization.operation]}</p>
                  <p className="mt-1 text-sm text-mp-medium-grey">
                    {formatMinorAmount(authorization.amountMinor, authorization.currency)} · {authorization.description}
                  </p>
                  <span className="mt-1 inline-block text-xs font-semibold uppercase tracking-wide">
                    {authorization.status.replace('_', ' ')}
                  </span>
                </div>
                {isOwner && authorization.status === 'pending_approval' && (
                  <div className="flex gap-2">
                    <Button type="button" disabled={busy} onClick={() => void runAction(
                      () => decideMandateAuthorization(mandate.id, authorization.id, 'approve'),
                      'Operation authorization approved.',
                    )}>Approve</Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                      () => decideMandateAuthorization(mandate.id, authorization.id, 'reject'),
                      'Operation authorization rejected.',
                    )}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="mt-3 text-sm text-mp-medium-grey" role="status">Refreshing mandate…</p>}
      </section>
    </section>
  );
}
