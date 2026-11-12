'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/components/providers/AuthProvider';
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
  mandateCurrencySchema,
  mandateCreateSchema,
  mandateOperations,
  type MandateExecutionConditions,
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

function commaSeparated(value: FormDataEntryValue | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const templates: Record<string, { label: string; conditions: MandateExecutionConditions }> = {
  basic: {
    label: 'General purchasing',
    conditions: { requiredDescriptionTerms: [] },
  },
  project: {
    label: 'Time-boxed project',
    conditions: {
      maximumContractDurationDays: 30,
      allowedCategories: ['software'],
      requiredDescriptionTerms: ['project'],
    },
  },
  recurring: {
    label: 'Recurring monthly services',
    conditions: {
      recurringPeriod: 'monthly',
      recurringLimitMinor: 50_000,
      monthlyLimitMinor: 50_000,
      requiredDescriptionTerms: [],
    },
  },
};

const serviceCategories = [
  'software',
  'design',
  'writing',
  'marketing',
  'consulting',
  'finance',
  'legal',
  'other',
] as const;

export function MandateForm({ initialMandate }: { initialMandate?: MandateRecord }) {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(initialMandate?.currency ?? 'USD');
  const [durationType, setDurationType] = useState(initialMandate?.durationType ?? 'temporary');
  const [templateKey, setTemplateKey] = useState('');
  const supportedCurrency = mandateCurrencySchema.safeParse(currency).success;
  const amountStep = supportedCurrency
    ? 1 / 10 ** currencyFractionDigits(currency)
    : 1;
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (!supportedCurrency) {
      setError('Enter a supported three-letter ISO 4217 currency code.');
      return;
    }

    const spendingLimitMinor = amountFromForm(formData.get('spendingLimit'), currency);
    const optionalAmount = (name: string, fallback?: number) => {
      const value = amountFromForm(formData.get(name), currency);
      return value === undefined ? fallback : value;
    };
    const ownerApprovalAboveMinor = optionalAmount(
      'ownerApprovalAbove',
      initialMandate?.approvalRequirements.ownerApprovalAboveMinor,
    );
    const maximumOperationAmountMinor = optionalAmount(
      'maximumOperationAmount',
      templates[templateKey]?.conditions.maximumOperationAmountMinor
        ?? initialMandate?.executionConditions.maximumOperationAmountMinor,
    );
    const dailyLimitMinor = optionalAmount(
      'dailyLimit',
      templates[templateKey]?.conditions.dailyLimitMinor
        ?? initialMandate?.executionConditions.dailyLimitMinor,
    );
    const weeklyLimitMinor = optionalAmount(
      'weeklyLimit',
      initialMandate?.executionConditions.weeklyLimitMinor,
    );
    const monthlyLimitMinor = optionalAmount(
      'monthlyLimit',
      templates[templateKey]?.conditions.monthlyLimitMinor
        ?? initialMandate?.executionConditions.monthlyLimitMinor,
    );
    const recurringLimitMinor = optionalAmount(
      'recurringLimit',
      templates[templateKey]?.conditions.recurringLimitMinor
        ?? initialMandate?.executionConditions.recurringLimitMinor,
    );
    const agentSpendingLimitMinor = optionalAmount(
      'agentSpendingLimit',
      initialMandate?.executionConditions.agentSpendingLimitMinor,
    );
    if (
      spendingLimitMinor === null || spendingLimitMinor === undefined
      || ownerApprovalAboveMinor === null || maximumOperationAmountMinor === null
      || dailyLimitMinor === null || weeklyLimitMinor === null || monthlyLimitMinor === null
      || recurringLimitMinor === null || agentSpendingLimitMinor === null
    ) {
      setError('Enter valid positive amounts using the selected currency precision.');
      return;
    }

    let startsAt: string;
    let expiresAt: string | null = null;
    try {
      startsAt = new Date(String(formData.get('startsAt') ?? '')).toISOString();
      if (durationType === 'temporary') {
        expiresAt = new Date(String(formData.get('expiresAt') ?? '')).toISOString();
      }
    } catch {
      setError('Enter valid mandate dates.');
      return;
    }
    const templateConditions = templates[templateKey]?.conditions;
    const recurringPeriod =
      String(formData.get('recurringPeriod') ?? '')
      || templateConditions?.recurringPeriod
      || initialMandate?.executionConditions.recurringPeriod;
    const configuredApproverIds = commaSeparated(formData.get('approverIds'));
    const approverIds = user?.uid
      ? [...new Set([user.uid, ...configuredApproverIds])]
      : configuredApproverIds;
    const descriptionTerms = commaSeparated(formData.get('requiredDescriptionTerms'));

    const payload = {
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      authorizedAgentId: String(formData.get('authorizedAgentId') ?? ''),
      spendingLimitMinor,
      currency,
      durationType,
      startsAt,
      expiresAt,
      allowedOperations: formData.getAll('allowedOperations').map(String),
      approvalRequirements: {
        ownerApprovalOperations: formData.getAll('ownerApprovalOperations').map(String),
        ...(ownerApprovalAboveMinor === undefined
          ? {}
          : { ownerApprovalAboveMinor }),
        ...(approverIds.length > 0 ? { approverIds } : {}),
        approvalMode: String(formData.get('approvalMode') ?? 'all'),
        ...(String(formData.get('approvalMode') ?? 'all') === 'quorum'
          ? { approvalQuorum: Number(formData.get('approvalQuorum')) }
          : {}),
      },
      executionConditions: {
        ...(maximumOperationAmountMinor === undefined
          ? {}
          : { maximumOperationAmountMinor }),
        ...(dailyLimitMinor === undefined ? {} : { dailyLimitMinor }),
        ...(weeklyLimitMinor === undefined ? {} : { weeklyLimitMinor }),
        ...(monthlyLimitMinor === undefined ? {} : { monthlyLimitMinor }),
        ...(recurringPeriod && recurringLimitMinor !== undefined
          ? { recurringPeriod, recurringLimitMinor }
          : {}),
        ...(agentSpendingLimitMinor === undefined ? {} : { agentSpendingLimitMinor }),
        maximumTransactionCount: String(formData.get('maximumTransactionCount') ?? '').trim()
          ? Number(formData.get('maximumTransactionCount'))
          : initialMandate?.executionConditions.maximumTransactionCount,
        allowedVendorIds: commaSeparated(formData.get('allowedVendorIds'))
          .length > 0
          ? commaSeparated(formData.get('allowedVendorIds'))
          : templateConditions?.allowedVendorIds
            ?? initialMandate?.executionConditions.allowedVendorIds,
        blockedVendorIds: commaSeparated(formData.get('blockedVendorIds')),
        allowedCategories: formData.getAll('allowedCategories').length > 0
          ? formData.getAll('allowedCategories').map(String)
          : templateConditions?.allowedCategories
            ?? initialMandate?.executionConditions.allowedCategories,
        allowedCountries: commaSeparated(formData.get('allowedCountries')),
        blockedCountries: commaSeparated(formData.get('blockedCountries')),
        maximumContractDurationDays: String(formData.get('maximumContractDurationDays') ?? '').trim()
          ? Number(formData.get('maximumContractDurationDays'))
          : templateConditions?.maximumContractDurationDays
            ?? initialMandate?.executionConditions.maximumContractDurationDays,
        requiredDescriptionTerms: descriptionTerms.length > 0
          ? descriptionTerms
          : templateConditions?.requiredDescriptionTerms
            ?? initialMandate?.executionConditions.requiredDescriptionTerms
            ?? [],
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
          {!initialMandate && (
            <label className="block max-w-md">
              <span className="mp-label">Start from a template</span>
              <select
                name="template"
                value={templateKey}
                onChange={(event) => setTemplateKey(event.target.value)}
                className="mp-input mt-1"
              >
                <option value="">Custom mandate</option>
                {Object.entries(templates).map(([key, template]) => (
                  <option key={key} value={key}>{template.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-mp-medium-grey">
                Templates prefill policy defaults; the server validates every submitted rule.
              </span>
            </label>
          )}
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
                  step={amountStep}
                  defaultValue={initialMandate
                    ? minorAmountInput(initialMandate.spendingLimitMinor, initialMandate.currency)
                    : undefined}
                  className="mp-input min-w-0 flex-1"
                />
              </div>
              {initialMandate && (
                <span className="mt-1 block text-xs text-mp-medium-grey">
                  Current limit: {formatMinorAmount(initialMandate.spendingLimitMinor, initialMandate.currency)}.
                  Increases require approval.
                </span>
              )}
            </label>
            <label>
              <span className="mp-label">Mandate duration</span>
              <select
                name="durationType"
                value={durationType}
                onChange={(event) => setDurationType(event.target.value as 'temporary' | 'permanent')}
                className="mp-input mt-1"
              >
                <option value="temporary">Temporary</option>
                <option value="permanent">Permanent</option>
              </select>
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
                required={durationType === 'temporary'}
                disabled={durationType === 'permanent'}
                defaultValue={localDateTimeValue(initialMandate?.expiresAt, thirtyDaysFromNow)}
                className="mp-input mt-1"
              />
              {durationType === 'permanent' && (
                <span className="mt-1 block text-xs text-mp-medium-grey">
                  Permanent mandates do not expire automatically.
                </span>
              )}
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
                step={amountStep}
                defaultValue={initialMandate?.approvalRequirements.ownerApprovalAboveMinor === undefined
                  ? undefined
                  : minorAmountInput(initialMandate.approvalRequirements.ownerApprovalAboveMinor, initialMandate.currency)}
                className="mp-input min-w-0 flex-1"
              />
            </div>
          </label>
          <label className="block max-w-md">
            <span className="mp-label">Approver Firebase UIDs (comma-separated)</span>
            <input
              name="approverIds"
              maxLength={2600}
              defaultValue={initialMandate?.approvalRequirements.approverIds
                ?.filter((approverId) => approverId !== user?.uid)
                .join(', ')}
              className="mp-input mt-1 font-mono"
              aria-describedby="approvers-help"
            />
            <span id="approvers-help" className="mt-1 block text-xs text-mp-medium-grey">
              The signed-in owner is included automatically. The assigned agent cannot approve their own operations.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mp-label">Approval policy</span>
              <select
                name="approvalMode"
                defaultValue={initialMandate?.approvalRequirements.approvalMode ?? 'all'}
                className="mp-input mt-1"
              >
                <option value="all">All listed approvers</option>
                <option value="quorum">Configured quorum</option>
              </select>
            </label>
            <label>
              <span className="mp-label">Quorum (when selected)</span>
              <input
                name="approvalQuorum"
                type="number"
                min="1"
                max="20"
                defaultValue={initialMandate?.approvalRequirements.approvalQuorum}
                className="mp-input mt-1"
              />
            </label>
          </div>
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
                step={amountStep}
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
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['dailyLimit', 'Daily spending limit', initialMandate?.executionConditions.dailyLimitMinor ?? templates[templateKey]?.conditions.dailyLimitMinor],
              ['weeklyLimit', 'Weekly spending limit', initialMandate?.executionConditions.weeklyLimitMinor],
              ['monthlyLimit', 'Monthly spending limit', initialMandate?.executionConditions.monthlyLimitMinor ?? templates[templateKey]?.conditions.monthlyLimitMinor],
              ['agentSpendingLimit', 'Assigned-agent lifetime cap', initialMandate?.executionConditions.agentSpendingLimitMinor],
              ['recurringLimit', 'Recurring cycle limit', initialMandate?.executionConditions.recurringLimitMinor ?? templates[templateKey]?.conditions.recurringLimitMinor],
            ] as const).map(([name, label, amount]) => (
              <label key={name}>
                <span className="mp-label">{label} (optional)</span>
                <div className="mt-1 flex">
                  <span className="inline-flex items-center border border-r-0 border-mp-warm-grey bg-mp-app-bg px-3 text-sm text-mp-medium-grey">
                    {currency}
                  </span>
                  <input
                    name={name}
                    type="number"
                    min="0"
                    step={amountStep}
                    defaultValue={amount === undefined ? undefined : minorAmountInput(amount, initialMandate?.currency ?? currency)}
                    className="mp-input min-w-0 flex-1"
                  />
                </div>
              </label>
            ))}
            <label>
              <span className="mp-label">Recurring cycle</span>
              <select
                name="recurringPeriod"
                defaultValue={initialMandate?.executionConditions.recurringPeriod ?? templates[templateKey]?.conditions.recurringPeriod ?? ''}
                className="mp-input mt-1"
              >
                <option value="">Not recurring</option>
                <option value="daily">Daily (UTC)</option>
                <option value="weekly">Weekly (UTC)</option>
                <option value="monthly">Monthly (UTC)</option>
              </select>
            </label>
            <label>
              <span className="mp-label">Maximum transaction count</span>
              <input
                name="maximumTransactionCount"
                type="number"
                min="1"
                defaultValue={initialMandate?.executionConditions.maximumTransactionCount}
                className="mp-input mt-1"
              />
            </label>
            <label>
              <span className="mp-label">Maximum contract duration (days)</span>
              <input
                name="maximumContractDurationDays"
                type="number"
                min="1"
                defaultValue={initialMandate?.executionConditions.maximumContractDurationDays ?? templates[templateKey]?.conditions.maximumContractDurationDays}
                className="mp-input mt-1"
              />
            </label>
          </div>
          <div>
            <p className="mp-label">Allowed service categories</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {serviceCategories.map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm capitalize">
                  <input
                    type="checkbox"
                    name="allowedCategories"
                    value={category}
                    defaultChecked={
                      initialMandate?.executionConditions.allowedCategories?.includes(category)
                      ?? templates[templateKey]?.conditions.allowedCategories?.includes(category)
                    }
                    className="accent-mp-orange"
                  />
                  {category}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mp-label">Allowed vendor UIDs (comma-separated)</span>
              <input
                name="allowedVendorIds"
                defaultValue={initialMandate?.executionConditions.allowedVendorIds?.join(', ')}
                className="mp-input mt-1 font-mono"
              />
            </label>
            <label>
              <span className="mp-label">Blocked vendor UIDs (comma-separated)</span>
              <input
                name="blockedVendorIds"
                defaultValue={initialMandate?.executionConditions.blockedVendorIds?.join(', ')}
                className="mp-input mt-1 font-mono"
              />
            </label>
            <label>
              <span className="mp-label">Allowed countries (ISO 3166-1 alpha-2)</span>
              <input
                name="allowedCountries"
                defaultValue={initialMandate?.executionConditions.allowedCountries?.join(', ')}
                className="mp-input mt-1 uppercase"
                aria-describedby="geography-help"
              />
            </label>
            <label>
              <span className="mp-label">Blocked countries (ISO 3166-1 alpha-2)</span>
              <input
                name="blockedCountries"
                defaultValue={initialMandate?.executionConditions.blockedCountries?.join(', ')}
                className="mp-input mt-1 uppercase"
                aria-describedby="geography-help"
              />
            </label>
          </div>
          <p id="geography-help" className="text-xs text-mp-medium-grey">
            Geography rules fail closed until trusted server-side location is available; client-supplied location is never used.
          </p>
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
