'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Ban, Check, Clock3, Copy, Pause, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  createMandateAuthorization,
  decideMandateRenewal,
  decideMandateAuthorization,
  decideMandateLimitIncrease,
  duplicateMandate,
  getMandate,
  listMandateAuthorizations,
  listMandateVersions,
  performMandateAction,
  requestMandateRenewal,
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
  type MandateVersionRecord,
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
    (mandate.spentAmountMinor + mandate.reservedAmountMinor + mandate.authorizationReservedAmountMinor)
      / mandate.spendingLimitMinor * 100,
  ));
}

function defaultRenewalDate(mandate: MandateRecord): string {
  const start = mandate.expiresAt ? new Date(mandate.expiresAt) : new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const localDate = new Date(start.getTime() - start.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function MandateDetail({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [mandate, setMandate] = useState<MandateRecord | null>(null);
  const [authorizations, setAuthorizations] = useState<MandateAuthorizationRecord[]>([]);
  const [versions, setVersions] = useState<MandateVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const authorizationIdempotencyKey = useRef<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const [nextMandate, nextAuthorizations, nextVersions] = await Promise.all([
        getMandate(mandateId),
        listMandateAuthorizations(mandateId),
        listMandateVersions(mandateId),
      ]);
      setMandate(nextMandate);
      setAuthorizations(nextAuthorizations);
      setVersions(nextVersions);
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
      listMandateVersions(mandateId),
    ])
      .then(([nextMandate, nextAuthorizations, nextVersions]) => {
        if (active) {
          setMandate(nextMandate);
          setAuthorizations(nextAuthorizations);
          setVersions(nextVersions);
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
        idempotencyKey: authorizationIdempotencyKey.current ??= crypto.randomUUID(),
      }),
      'Operation request submitted. The backend checked the mandate rules and budget.',
    );
    if (succeeded) {
      form.reset();
      authorizationIdempotencyKey.current = crypto.randomUUID();
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

  const handleRenewalRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mandate) {
      return;
    }
    const form = event.currentTarget;
    const formData = new FormData(form);
    let requestedExpiresAt: string;
    try {
      requestedExpiresAt = new Date(String(formData.get('requestedExpiresAt') ?? '')).toISOString();
    } catch {
      setError('Enter a valid future renewal date.');
      return;
    }
    const succeeded = await runAction(
      () => requestMandateRenewal(
        mandate.id,
        requestedExpiresAt,
        String(formData.get('reason') ?? ''),
      ),
      'Renewal request submitted for approval.',
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
  const isApprover = isOwner
    || (user?.uid !== undefined && mandate.approvalRequirements.approverIds?.includes(user.uid) === true);
  const progress = percentage(mandate);
  const pendingLimitRequest = mandate.pendingLimitRequest;
  const renewalRequest = mandate.renewalRequest;
  const mayRequestLimit =
    isAgent && mandate.status !== 'expired' && mandate.status !== 'revoked';
  const mayRequestRenewal =
    isAgent
    && mandate.durationType === 'temporary'
    && renewalRequest === null
    && ['active', 'paused', 'expired'].includes(mandate.status);

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
            {isOwner && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                async () => {
                  const copy = await duplicateMandate(mandate.id);
                  router.push(`/mandates/${encodeURIComponent(copy.id)}`);
                },
                'Mandate duplicated as a draft.',
              )}>
                <Copy size={16} aria-hidden="true" /> Duplicate
              </Button>
            )}
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
            {isOwner && mandate.status === 'active' && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => {
                const reason = window.prompt('Reason for emergency suspension?');
                if (reason?.trim()) {
                  void runAction(
                    () => performMandateAction(mandate.id, 'emergency_suspend', reason.trim()),
                    'Mandate emergency-suspended.',
                  );
                }
              }}>
                <Ban size={16} aria-hidden="true" /> Emergency suspend
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
              <p className="mt-1 text-sm text-mp-medium-grey">
                {formatMinorAmount(mandate.reservedAmountMinor, mandate.currency)} reserved by accepted negotiations
              </p>
              <p className="mt-1 text-sm text-mp-medium-grey">
                {formatMinorAmount(mandate.authorizationReservedAmountMinor, mandate.currency)} reserved for pending approvals
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
                Math.max(
                  0,
                  mandate.spendingLimitMinor
                    - mandate.spentAmountMinor
                    - mandate.reservedAmountMinor
                    - mandate.authorizationReservedAmountMinor,
                ),
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
              {mandate.expiresAt ? new Date(mandate.expiresAt).toLocaleString() : 'Permanent'}
            </p>
          </div>
          <div>
            <p className="mp-kicker">Mandate version</p>
            <p className="mt-1 text-sm">{mandate.version}</p>
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
              <li>
                Approval policy: {mandate.approvalRequirements.approvalMode === 'quorum'
                  ? `${mandate.approvalRequirements.approvalQuorum} of ${mandate.approvalRequirements.approverIds?.length ?? 1}`
                  : 'all listed approvers'}
              </li>
              {mandate.approvalRequirements.approverIds?.map((approverId) => (
                <li key={approverId} className="font-mono text-xs">Approver: {approverId}</li>
              ))}
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
            {mandate.executionConditions.dailyLimitMinor !== undefined && (
              <li>Daily (UTC) limit: {formatMinorAmount(mandate.executionConditions.dailyLimitMinor, mandate.currency)}</li>
            )}
            {mandate.executionConditions.weeklyLimitMinor !== undefined && (
              <li>Weekly (UTC) limit: {formatMinorAmount(mandate.executionConditions.weeklyLimitMinor, mandate.currency)}</li>
            )}
            {mandate.executionConditions.monthlyLimitMinor !== undefined && (
              <li>Monthly (UTC) limit: {formatMinorAmount(mandate.executionConditions.monthlyLimitMinor, mandate.currency)}</li>
            )}
            {mandate.executionConditions.recurringPeriod && mandate.executionConditions.recurringLimitMinor !== undefined && (
              <li>
                Recurring {mandate.executionConditions.recurringPeriod} (UTC):{' '}
                {formatMinorAmount(mandate.executionConditions.recurringLimitMinor, mandate.currency)}
              </li>
            )}
            {mandate.executionConditions.maximumTransactionCount !== undefined && (
              <li>Maximum transaction count: {mandate.executionConditions.maximumTransactionCount}</li>
            )}
            {mandate.executionConditions.agentSpendingLimitMinor !== undefined && (
              <li>Assigned-agent cap: {formatMinorAmount(mandate.executionConditions.agentSpendingLimitMinor, mandate.currency)}</li>
            )}
            {mandate.executionConditions.maximumContractDurationDays !== undefined && (
              <li>Maximum contract duration: {mandate.executionConditions.maximumContractDurationDays} days</li>
            )}
            {mandate.executionConditions.allowedVendorIds?.map((id) => <li key={`allow-${id}`}>Allowed vendor: {id}</li>)}
            {mandate.executionConditions.blockedVendorIds?.map((id) => <li key={`block-${id}`}>Blocked vendor: {id}</li>)}
            {mandate.executionConditions.allowedCategories?.map((category) => <li key={category}>Allowed category: {category}</li>)}
            {(mandate.executionConditions.allowedCountries?.length || mandate.executionConditions.blockedCountries?.length) ? (
              <li>Geographic policy requires trusted server-side location; authorization fails closed until available.</li>
            ) : null}
            {mandate.executionConditions.requiredDescriptionTerms.map((term) => (
              <li key={term}>Description must include “{term}”</li>
            ))}
            {mandate.executionConditions.maximumOperationAmountMinor === undefined
            && mandate.executionConditions.requiredDescriptionTerms.length === 0
            && mandate.executionConditions.dailyLimitMinor === undefined
            && mandate.executionConditions.weeklyLimitMinor === undefined
            && mandate.executionConditions.monthlyLimitMinor === undefined
            && mandate.executionConditions.recurringPeriod === undefined
            && mandate.executionConditions.maximumTransactionCount === undefined
            && mandate.executionConditions.agentSpendingLimitMinor === undefined
            && mandate.executionConditions.maximumContractDurationDays === undefined
            && !mandate.executionConditions.allowedVendorIds?.length
            && !mandate.executionConditions.blockedVendorIds?.length
            && !mandate.executionConditions.allowedCategories?.length && (
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

      {renewalRequest && (
        <section className="border-l-2 border-amber-700 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <Clock3 size={18} aria-hidden="true" />
            <h2 className="font-semibold">Mandate renewal request</h2>
          </div>
          <p className="mt-2 text-sm">
            Requested expiry: {new Date(renewalRequest.requestedExpiresAt).toLocaleString()}
          </p>
          <p className="mt-1 text-sm text-mp-medium-grey">{renewalRequest.reason}</p>
          {isOwner && (
            <div className="mt-4 flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void runAction(
                () => decideMandateRenewal(mandate.id, 'approve'),
                'Mandate renewal approved.',
              )}>Approve renewal</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => {
                const reason = window.prompt('Reason for rejecting renewal?');
                if (reason?.trim()) {
                  void runAction(
                    () => decideMandateRenewal(mandate.id, 'reject', reason.trim()),
                    'Mandate renewal rejected.',
                  );
                }
              }}>Reject renewal</Button>
            </div>
          )}
        </section>
      )}

      {mayRequestRenewal && (
        <form onSubmit={handleRenewalRequest} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <h2 className="text-lg font-semibold">Request mandate renewal</h2>
          <p className="mp-copy">
            The owner must approve a new expiration date. Renewal never changes spending or execution permissions.
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <label>
              <span className="mp-label">Requested expiry</span>
              <input
                name="requestedExpiresAt"
                type="datetime-local"
                required
                defaultValue={defaultRenewalDate(mandate)}
                className="mp-input mt-1"
              />
            </label>
            <label>
              <span className="mp-label">Reason</span>
              <input name="reason" required maxLength={1000} className="mp-input mt-1" />
            </label>
            <Button type="submit" disabled={busy} className="self-end">
              {busy ? 'Submitting…' : 'Request renewal'}
            </Button>
          </div>
        </form>
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
            <label>
              <span className="mp-label">Operation description</span>
              <input name="description" required maxLength={500} className="mp-input mt-1" />
            </label>
            {mandate.executionConditions.allowedCategories?.length
            || mandate.executionConditions.allowedVendorIds?.length
            || mandate.executionConditions.blockedVendorIds?.length
            || mandate.executionConditions.maximumContractDurationDays ? (
              <p className="sm:col-span-2 text-xs text-mp-medium-grey">
                Category, vendor, and contract-duration rules are enforced only when the server has trusted contract context.
                Standalone operation authorization is rejected when it cannot verify those conditions.
              </p>
            ) : null}
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
                {isApprover && authorization.status === 'pending_approval' && (
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
                {authorization.status === 'pending_approval' && (
                  <p className="text-xs text-mp-medium-grey">
                    {authorization.approvals?.length ?? 0} of {authorization.approvalQuorum ?? authorization.approvalApproverIds?.length ?? 1} approvals
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="mt-3 text-sm text-mp-medium-grey" role="status">Refreshing mandate…</p>}
      </section>

      <section className="border-t border-mp-warm-grey pt-6">
        <h2 className="text-lg font-semibold">Mandate version history</h2>
        {versions.length === 0 ? (
          <p className="mp-copy mt-3">No version snapshots are available for this mandate yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {versions.map((version) => (
              <li key={version.version} className="border-l-2 border-mp-warm-grey pl-4">
                <p className="text-sm font-semibold">Version {version.version}</p>
                <p className="mt-1 text-sm text-mp-medium-grey">{version.reason}</p>
                <p className="mt-1 font-mono text-xs text-mp-medium-grey">
                  {version.createdBy} · {version.createdAt ? new Date(version.createdAt).toLocaleString() : 'Time unavailable'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
