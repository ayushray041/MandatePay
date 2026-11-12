'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  createMandate,
  updateMandate,
} from '@/lib/mandates/client';
import {
  currencyFractionDigits,
  formatMinorAmount,
  parseMajorAmount,
} from '@/lib/mandates/money';
import {
  mandateCreateSchema,
  mandateOperations,
  type MandateOperation,
  type MandateRecord,
} from '@/models/mandate';

function localDateTimeValue(value: string | null | undefined, defaultDate: Date): string {
  const date = value ? new Date(value) : defaultDate;
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function minorAmountInput(amountMinor: number, currency: string): string {
  const digits = currencyFractionDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}

const operationLabels: Record<MandateOperation, string> = {
  'contract.create': 'Create a contract',
  'contract.amend': 'Propose a contract amendment',
  'payment.authorize': 'Authorize a payment',
};

function amountFromForm(value: FormDataEntryValue | null, currency: string): number | undefined | null {
  const text = String(value ?? '').trim();
  return text === '' ? undefined : parseMajorAmount(text, currency);
}

export function MandateForm({ initialMandate }: { initialMandate?: MandateRecord }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(initialMandate?.currency ?? 'USD');
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const spendingLimitMinor = amountFromForm(formData.get('spendingLimit'), currency);
    const ownerApprovalAboveMinor = amountFromForm(
      formData.get('ownerApprovalAbove'),
      currency,
    );
    const maximumOperationAmountMinor = amountFromForm(
      formData.get('maximumOperationAmount'),
      currency,
    );

    if (
      spendingLimitMinor === null
      || spendingLimitMinor === undefined
      || ownerApprovalAboveMinor === null
      || maximumOperationAmountMinor === null
    ) {
      setError('Enter valid positive amounts using the selected currency precision.');
      return;
    }

    let startsAt: string;
    let expiresAt: string;
    try {
      startsAt = new Date(String(formData.get('startsAt') ?? '')).toISOString();
      expiresAt = new Date(String(formData.get('expiresAt') ?? '')).toISOString();
    } catch {
      setError('Enter valid start and expiry dates.');
      return;
    }

    const payload = {
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      authorizedAgentId: String(formData.get('authorizedAgentId') ?? ''),
      spendingLimitMinor,
      currency,
      startsAt,
      expiresAt,
      allowedOperations: formData.getAll('allowedOperations').map(String),
      approvalRequirements: {
        ownerApprovalOperations: formData.getAll('ownerApprovalOperations').map(String),
        ...(ownerApprovalAboveMinor === undefined
          ? {}
          : { ownerApprovalAboveMinor }),
      },
      executionConditions: {
        ...(maximumOperationAmountMinor === undefined
          ? {}
          : { maximumOperationAmountMinor }),
        requiredDescriptionTerms: String(formData.get('requiredDescriptionTerms') ?? '')
          .split(',')
          .map((term) => term.trim())
          .filter(Boolean),
      },
    };

    const parsed = mandateCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review the mandate details and try again.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const mandate = initialMandate
        ? await updateMandate(initialMandate.id, parsed.data)
        : await createMandate(parsed.data);
      router.push(`/mandates/${encodeURIComponent(mandate.id)}`);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Mandate could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mp-page mx-auto w-full max-w-4xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <Link
          href={initialMandate ? `/mandates/${initialMandate.id}` : '/mandates'}
          className="inline-flex items-center gap-2 text-sm font-semibold text-mp-medium-grey hover:text-mp-ink"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {initialMandate ? 'Back to mandate' : 'All mandates'}
        </Link>
        <p className="mp-kicker mt-6">Delegated authority</p>
        <h1 className="mp-page-title mt-2">
          {initialMandate ? 'Edit draft mandate' : 'Create a mandate'}
        </h1>
        <p className="mp-copy mt-3 max-w-2xl">
          New mandates start as drafts. Spending-limit increases after creation require an
          authorized-agent request and separate owner approval.
        </p>
      </header>

      {error && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <fieldset disabled={loading} className="space-y-6">
          <legend className="text-xl font-semibold">Mandate details</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mp-label">Title</span>
              <input
                name="title"
                required
                maxLength={120}
                defaultValue={initialMandate?.title}
                className="mp-input mt-1"
                autoComplete="off"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mp-label">Description</span>
              <textarea
                name="description"
                required
                maxLength={4000}
                rows={4}
                defaultValue={initialMandate?.description}
                className="mp-input mt-1 min-h-28"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mp-label">Authorized agent Firebase UID</span>
              <input
                name="authorizedAgentId"
                required
                maxLength={128}
                defaultValue={initialMandate?.authorizedAgentId}
                className="mp-input mt-1 font-mono"
                autoComplete="off"
                aria-describedby="agent-help"
              />
              <span id="agent-help" className="mt-1 block text-xs text-mp-medium-grey">
                Use the agent’s registered account UID. The server verifies that its profile exists.
              </span>
            </label>
            <label>
              <span className="mp-label">Currency (ISO 4217)</span>
              <input
                name="currency"
                required
                minLength={3}
                maxLength={3}
                pattern="[A-Z]{3}"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                className="mp-input mt-1 uppercase"
                aria-describedby="currency-help"
              />
              <span id="currency-help" className="mt-1 block text-xs text-mp-medium-grey">
                Amount precision follows the selected currency.
              </span>
            </label>
            <label>
              <span className="mp-label">Spending limit</span>
              <div className="mt-1 flex">
                <span className="inline-flex items-center border border-r-0 border-mp-warm-grey bg-mp-app-bg px-3 text-sm text-mp-medium-grey">
                  {currency}
                </span>
                <input
                  name="spendingLimit"
                  type="number"
                  required
                  min="0"
                  step={1 / 10 ** currencyFractionDigits(currency)}
                  defaultValue={initialMandate
                    ? minorAmountInput(initialMandate.spendingLimitMinor, initialMandate.currency)
                    : undefined}
                  className="mp-input min-w-0 flex-1"
                />
              </div>
              {initialMandate && (
                <span className="mt-1 block text-xs text-mp-medium-grey">
                  Current limit: {formatMinorAmount(initialMandate.spendingLimitMinor, currency)}.
                  Increases require approval.
                </span>
              )}
            </label>
            <label>
              <span className="mp-label">Starts at</span>
              <input
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={localDateTimeValue(initialMandate?.startsAt, now)}
                className="mp-input mt-1"
              />
            </label>
            <label>
              <span className="mp-label">Expires at</span>
              <input
                name="expiresAt"
                type="datetime-local"
                required
                defaultValue={localDateTimeValue(initialMandate?.expiresAt, thirtyDaysFromNow)}
                className="mp-input mt-1"
              />
            </label>
          </div>
        </fieldset>

        <fieldset disabled={loading} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <legend className="text-xl font-semibold">Allowed operations</legend>
          <p className="mp-copy">The backend rejects operations not selected here.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {mandateOperations.map((operation) => (
              <label
                key={operation}
                className="flex items-center gap-3 border border-mp-warm-grey bg-mp-surface px-4 py-3"
              >
                <input
                  type="checkbox"
                  name="allowedOperations"
                  value={operation}
                  defaultChecked={initialMandate?.allowedOperations.includes(operation)}
                  className="accent-mp-orange"
                />
                <span className="text-sm font-medium">{operationLabels[operation]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={loading} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <legend className="text-xl font-semibold">Approval requirements</legend>
          <p className="mp-copy">
            Selected operations and amounts above the threshold wait for the owner’s approval.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {mandateOperations.map((operation) => (
              <label
                key={operation}
                className="flex items-center gap-3 border border-mp-warm-grey bg-mp-surface px-4 py-3"
              >
                <input
                  type="checkbox"
                  name="ownerApprovalOperations"
                  value={operation}
                  defaultChecked={initialMandate?.approvalRequirements.ownerApprovalOperations.includes(operation)}
                  className="accent-mp-orange"
                />
                <span className="text-sm">Require owner approval: {operationLabels[operation]}</span>
              </label>
            ))}
          </div>
          <label className="block max-w-md">
            <span className="mp-label">Require approval above (optional)</span>
            <div className="mt-1 flex">
              <span className="inline-flex items-center border border-r-0 border-mp-warm-grey bg-mp-app-bg px-3 text-sm text-mp-medium-grey">
                {currency}
              </span>
              <input
                name="ownerApprovalAbove"
                type="number"
                min="0"
                step={1 / 10 ** currencyFractionDigits(currency)}
                defaultValue={initialMandate?.approvalRequirements.ownerApprovalAboveMinor === undefined
                  ? undefined
                  : minorAmountInput(initialMandate.approvalRequirements.ownerApprovalAboveMinor, initialMandate.currency)}
                className="mp-input min-w-0 flex-1"
              />
            </div>
          </label>
        </fieldset>

        <fieldset disabled={loading} className="space-y-4 border-t border-mp-warm-grey pt-6">
          <legend className="text-xl font-semibold">Execution conditions</legend>
          <p className="mp-copy">
            These conditions are checked by the server before authorizing an operation.
          </p>
          <label className="block max-w-md">
            <span className="mp-label">Maximum amount per operation (optional)</span>
            <div className="mt-1 flex">
              <span className="inline-flex items-center border border-r-0 border-mp-warm-grey bg-mp-app-bg px-3 text-sm text-mp-medium-grey">
                {currency}
              </span>
              <input
                name="maximumOperationAmount"
                type="number"
                min="0"
                step={1 / 10 ** currencyFractionDigits(currency)}
                defaultValue={initialMandate?.executionConditions.maximumOperationAmountMinor === undefined
                  ? undefined
                  : minorAmountInput(initialMandate.executionConditions.maximumOperationAmountMinor, initialMandate.currency)}
                className="mp-input min-w-0 flex-1"
              />
            </div>
          </label>
          <label className="block">
            <span className="mp-label">Required operation description terms (optional)</span>
            <input
              name="requiredDescriptionTerms"
              maxLength={830}
              defaultValue={initialMandate?.executionConditions.requiredDescriptionTerms.join(', ')}
              className="mp-input mt-1"
              aria-describedby="terms-help"
            />
            <span id="terms-help" className="mt-1 block text-xs text-mp-medium-grey">
              Separate terms with commas. Every term must appear in an operation description.
            </span>
          </label>
        </fieldset>

        <div className="flex flex-col-reverse gap-3 border-t border-mp-warm-grey pt-6 sm:flex-row sm:justify-end">
          <Link
            href={initialMandate ? `/mandates/${initialMandate.id}` : '/mandates'}
            className="inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold text-mp-medium-grey"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={loading} className="min-h-11">
            {loading ? 'Saving…' : initialMandate ? 'Save mandate changes' : 'Create draft mandate'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </section>
  );
}
