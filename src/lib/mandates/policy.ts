import {
  mandateOperationSchema,
  mandateStatusSchema,
  type MandateOperation,
  type MandateStatus,
  type MandateVelocityUsage,
} from '@/models/mandate';
import { MandateError } from '@/lib/mandates/errors';
import { timestampToIso } from '@/lib/mandates/format';

type MandateData = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export type MandateExecutionContext = {
  vendorId?: string;
  serviceCategory?: string;
  contractDurationDays?: number;
  countryCode?: string;
  enforceVelocity?: boolean;
  excludeAuthorizationReservationMinor?: number;
  excludeVelocityReservationAmountMinor?: number;
  excludeVelocityUsageWindowKeys?: Partial<MandateUsageWindowKeys>;
};

export type MandateUsageWindowKeys = {
  daily: string;
  weekly: string;
  monthly: string;
};

export function mandateStatus(data: MandateData): MandateStatus {
  return mandateStatusSchema.parse(data.status);
}

export function isMandateOwner(data: MandateData, uid: string): boolean {
  return data.ownerId === uid;
}

export function isAuthorizedAgent(data: MandateData, uid: string): boolean {
  return data.authorizedAgentId === uid;
}

export function isMandateApprover(data: MandateData, uid: string): boolean {
  return getMandateApprovers(data).includes(uid);
}

export function assertOwner(data: MandateData, uid: string): void {
  if (!isMandateOwner(data, uid)) {
    throw new MandateError(403, 'FORBIDDEN', 'Only the mandate owner can perform this action.');
  }
}

export function assertOwnerOrAgent(data: MandateData, uid: string): void {
  if (!isMandateOwner(data, uid) && !isAuthorizedAgent(data, uid)) {
    throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
  }
}

export function assertOwnerAgentOrApprover(data: MandateData, uid: string): void {
  if (!isMandateOwner(data, uid) && !isAuthorizedAgent(data, uid) && !isMandateApprover(data, uid)) {
    throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
  }
}

export function currentMandateVersion(data: MandateData): number {
  const version = data.version ?? 1;
  if (!Number.isSafeInteger(version) || Number(version) < 1) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate version is invalid.');
  }
  return Number(version);
}

export function getMandateApprovers(data: MandateData): string[] {
  const ownerId = data.ownerId;
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate owner data is invalid.');
  }
  const requirements = data.approvalRequirements;
  const configured = (
    typeof requirements === 'object'
    && requirements !== null
    && 'approverIds' in requirements
    && Array.isArray(requirements.approverIds)
  )
    ? requirements.approverIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const approverIds = configured.length > 0 ? configured : [ownerId];
  if (
    !approverIds.includes(ownerId)
    || new Set(approverIds).size !== approverIds.length
  ) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate approver data is invalid.');
  }
  return approverIds;
}

export function getMandateApprovalQuorum(data: MandateData): number {
  const approvers = getMandateApprovers(data);
  const requirements = data.approvalRequirements;
  if (typeof requirements !== 'object' || requirements === null) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate approval requirements are invalid.');
  }
  const mode = 'approvalMode' in requirements ? requirements.approvalMode : 'all';
  const quorum = 'approvalQuorum' in requirements ? requirements.approvalQuorum : undefined;
  if (mode === 'quorum') {
    if (
      typeof quorum !== 'number'
      || !Number.isSafeInteger(quorum)
      || quorum < 1
      || quorum > approvers.length
    ) {
      throw new MandateError(500, 'INVALID_MANDATE', 'Mandate approval quorum is invalid.');
    }
    return quorum;
  }
  return approvers.length;
}

export function assertNotExpired(data: MandateData, now: Date): void {
  const durationType = data.durationType ?? 'temporary';
  if (durationType === 'permanent' && data.expiresAt == null) {
    return;
  }
  const expiresAt = timestampToIso(data.expiresAt);
  if (!expiresAt) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate expiry date is invalid.');
  }

  if (
    (mandateStatus(data) === 'active' || mandateStatus(data) === 'paused')
    && Date.parse(expiresAt) <= now.getTime()
  ) {
    throw new MandateError(410, 'MANDATE_EXPIRED', 'Mandate has expired.');
  }
}

function isoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getMandateUsageWindowKeys(now: Date): MandateUsageWindowKeys {
  const day = now.toISOString().slice(0, 10);
  return {
    daily: day,
    weekly: isoWeekKey(now),
    monthly: day.slice(0, 7),
  };
}

export function parseMandateUsageWindowKeys(
  value: unknown,
): Partial<MandateUsageWindowKeys> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const keys: Partial<MandateUsageWindowKeys> = {};
  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    if (typeof record[window] === 'string') {
      keys[window] = record[window] as string;
    }
  }
  return Object.keys(keys).length > 0 ? keys : undefined;
}

function usageForWindow(
  usage: MandateData,
  window: keyof MandateUsageWindowKeys,
  periodKey: string,
): { amountMinor: number; transactionCount: number } {
  const rawVelocityUsage = asRecord(usage.velocityUsage);
  const rawWindow = asRecord(rawVelocityUsage?.[window]);
  if (!rawWindow) {
    return { amountMinor: 0, transactionCount: 0 };
  }
  const existingPeriod = rawWindow.periodKey;
  if (existingPeriod !== periodKey) {
    return { amountMinor: 0, transactionCount: 0 };
  }
  const amountMinor = rawWindow.amountMinor;
  const transactionCount = rawWindow.transactionCount;
  if (
    typeof amountMinor !== 'number'
    || !Number.isSafeInteger(amountMinor)
    || amountMinor < 0
    || typeof transactionCount !== 'number'
    || !Number.isSafeInteger(transactionCount)
    || transactionCount < 0
  ) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate velocity usage is invalid.');
  }
  return { amountMinor, transactionCount };
}

export function addMandateVelocityUsage(
  mandate: MandateData,
  amountMinor: number,
  now: Date,
): { velocityUsage: MandateVelocityUsage; usageWindowKeys: MandateUsageWindowKeys } {
  if (!isNonnegativeSafeInteger(amountMinor)) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate velocity amount is invalid.');
  }
  const keys = getMandateUsageWindowKeys(now);
  const rawUsage = asRecord(mandate.velocityUsage) ?? {};
  const totalTransactionCount = rawUsage.totalTransactionCount ?? 0;
  if (
    typeof totalTransactionCount !== 'number'
    || !Number.isSafeInteger(totalTransactionCount)
    || totalTransactionCount < 0
    || !Number.isSafeInteger(totalTransactionCount + 1)
  ) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate transaction count is invalid.');
  }

  const next = {} as MandateVelocityUsage;
  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    const current = usageForWindow(mandate, window, keys[window]);
    const nextAmount = current.amountMinor + amountMinor;
    if (!Number.isSafeInteger(nextAmount)) {
      throw new MandateError(500, 'INVALID_MANDATE', 'Mandate velocity amount is invalid.');
    }
    next[window] = {
      periodKey: keys[window],
      amountMinor: nextAmount,
      transactionCount: current.transactionCount + 1,
    };
  }
  next.totalTransactionCount = totalTransactionCount + 1;
  return { velocityUsage: next, usageWindowKeys: keys };
}

export function releaseMandateVelocityUsage(
  mandate: MandateData,
  amountMinor: number,
  usageWindowKeys: Partial<MandateUsageWindowKeys> | undefined,
): MandateVelocityUsage {
  const rawUsage = asRecord(mandate.velocityUsage) ?? {};
  const totalTransactionCount = rawUsage.totalTransactionCount ?? 0;
  const next = { ...rawUsage } as MandateVelocityUsage;
  const hasUsageWindowKey = Boolean(
    usageWindowKeys
    && Object.values(usageWindowKeys).some((key) => typeof key === 'string'),
  );
  if (!isNonnegativeSafeInteger(amountMinor) || !isNonnegativeSafeInteger(totalTransactionCount)) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate velocity usage is invalid.');
  }
  if (!hasUsageWindowKey) {
    return next;
  }
  if (totalTransactionCount < 1) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate transaction count cannot release a missing reservation.');
  }
  next.totalTransactionCount = totalTransactionCount - 1;
  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    const key = usageWindowKeys?.[window];
    if (typeof key !== 'string') {
      continue;
    }
    const storedWindow = asRecord(asRecord(mandate.velocityUsage)?.[window]);
    if (storedWindow?.periodKey !== key) {
      continue;
    }
    const current = usageForWindow(mandate, window, key);
    if (current.transactionCount === 0 || current.amountMinor < amountMinor) {
      throw new MandateError(500, 'INVALID_MANDATE', 'Mandate velocity reservation cannot be released.');
    }
    next[window] = {
      periodKey: key,
      amountMinor: current.amountMinor - amountMinor,
      transactionCount: current.transactionCount - 1,
    };
  }
  return next;
}

export function assertExecutionAllowed(
  data: MandateData,
  operation: MandateOperation,
  amountMinor: number,
  description: string,
  now: Date,
  context: MandateExecutionContext = {},
): boolean {
  assertNotExpired(data, now);
  if (mandateStatus(data) !== 'active') {
    throw new MandateError(409, 'MANDATE_NOT_ACTIVE', 'Mandate is not active.');
  }

  const startsAt = timestampToIso(data.startsAt);
  if (!startsAt || Date.parse(startsAt) > now.getTime()) {
    throw new MandateError(409, 'MANDATE_NOT_STARTED', 'Mandate is not within its execution window.');
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new MandateError(400, 'INVALID_AMOUNT', 'Operation amount is invalid.');
  }

  const allowedOperations = data.allowedOperations;
  if (
    !Array.isArray(allowedOperations)
    || !allowedOperations.some((value) => mandateOperationSchema.safeParse(value).success && value === operation)
  ) {
    throw new MandateError(403, 'OPERATION_NOT_ALLOWED', 'This operation is not allowed by the mandate.');
  }

  const spendingLimitMinor = data.spendingLimitMinor;
  const spentAmountMinor = data.spentAmountMinor;
  const reservedAmountMinor = data.reservedAmountMinor ?? 0;
  const authorizationReservedAmountMinor = data.authorizationReservedAmountMinor ?? 0;
  const excludedAuthorizationReservation = context.excludeAuthorizationReservationMinor ?? 0;
  if (
    !isNonnegativeSafeInteger(spendingLimitMinor)
    || !isNonnegativeSafeInteger(spentAmountMinor)
    || !isNonnegativeSafeInteger(reservedAmountMinor)
    || !isNonnegativeSafeInteger(authorizationReservedAmountMinor)
    || !isNonnegativeSafeInteger(excludedAuthorizationReservation)
    || excludedAuthorizationReservation > authorizationReservedAmountMinor
  ) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate budget data is invalid.');
  }

  if (
    spendingLimitMinor - spentAmountMinor - reservedAmountMinor
      - authorizationReservedAmountMinor + excludedAuthorizationReservation < amountMinor
  ) {
    throw new MandateError(
      409,
      'SPENDING_LIMIT_EXCEEDED',
      'Operation exceeds the remaining mandate budget after committed and reserved terms.',
    );
  }

  const conditions = asRecord(data.executionConditions);
  if (!conditions) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate execution conditions are invalid.');
  }

  const maximumOperationAmountMinor =
    'maximumOperationAmountMinor' in conditions
      ? conditions.maximumOperationAmountMinor
      : undefined;
  if (
    typeof maximumOperationAmountMinor === 'number'
    && amountMinor > maximumOperationAmountMinor
  ) {
    throw new MandateError(403, 'EXECUTION_CONDITION_FAILED', 'Operation exceeds the per-operation spending condition.');
  }

  const agentSpendingLimitMinor =
    'agentSpendingLimitMinor' in conditions
      ? conditions.agentSpendingLimitMinor
      : undefined;
  if (
    typeof agentSpendingLimitMinor === 'number'
    && spentAmountMinor + reservedAmountMinor + authorizationReservedAmountMinor
      - excludedAuthorizationReservation + amountMinor > agentSpendingLimitMinor
  ) {
    throw new MandateError(409, 'AGENT_SPENDING_LIMIT_EXCEEDED', 'Operation exceeds this agent’s spending limit.');
  }

  const allowedVendorIds =
    'allowedVendorIds' in conditions && Array.isArray(conditions.allowedVendorIds)
      ? conditions.allowedVendorIds
      : [];
  const blockedVendorIds =
    'blockedVendorIds' in conditions && Array.isArray(conditions.blockedVendorIds)
      ? conditions.blockedVendorIds
      : [];
  if (
    (allowedVendorIds.length > 0 || blockedVendorIds.length > 0)
    && !context.vendorId
  ) {
    throw new MandateError(
      503,
      'VENDOR_CONTEXT_UNAVAILABLE',
      'A trusted server-side vendor identity is required by this mandate.',
    );
  }
  if (allowedVendorIds.length > 0 && !allowedVendorIds.includes(context.vendorId ?? '')) {
    throw new MandateError(403, 'VENDOR_NOT_ALLOWED', 'The operation vendor is not approved by this mandate.');
  }
  if (context.vendorId && blockedVendorIds.includes(context.vendorId)) {
    throw new MandateError(403, 'VENDOR_BLOCKED', 'The operation vendor is blocked by this mandate.');
  }

  const allowedCategories =
    'allowedCategories' in conditions && Array.isArray(conditions.allowedCategories)
      ? conditions.allowedCategories
      : [];
  if (
    allowedCategories.length > 0
    && (!context.serviceCategory || !allowedCategories.includes(context.serviceCategory))
  ) {
    throw new MandateError(403, 'SERVICE_CATEGORY_NOT_ALLOWED', 'The service category is not approved by this mandate.');
  }

  const maximumContractDurationDays =
    'maximumContractDurationDays' in conditions
      ? conditions.maximumContractDurationDays
      : undefined;
  if (
    typeof maximumContractDurationDays === 'number'
    && (
      context.contractDurationDays === undefined
      || context.contractDurationDays > maximumContractDurationDays
    )
  ) {
    throw new MandateError(403, 'CONTRACT_DURATION_NOT_ALLOWED', 'Contract duration exceeds this mandate’s limit.');
  }

  const allowedCountries =
    'allowedCountries' in conditions && Array.isArray(conditions.allowedCountries)
      ? conditions.allowedCountries
      : [];
  const blockedCountries =
    'blockedCountries' in conditions && Array.isArray(conditions.blockedCountries)
      ? conditions.blockedCountries
      : [];
  if (
    allowedCountries.length > 0
    || blockedCountries.length > 0
  ) {
    if (!context.countryCode) {
      throw new MandateError(
        503,
        'LOCATION_UNAVAILABLE',
        'A trusted server-side location is required by this mandate.',
      );
    }
    if (
      (allowedCountries.length > 0 && !allowedCountries.includes(context.countryCode))
      || blockedCountries.includes(context.countryCode)
    ) {
      throw new MandateError(403, 'GEOGRAPHY_NOT_ALLOWED', 'The operation location is not allowed by this mandate.');
    }
  }

  const requiredTerms =
    'requiredDescriptionTerms' in conditions
      ? conditions.requiredDescriptionTerms
      : undefined;
  if (
    Array.isArray(requiredTerms)
    && !requiredTerms.every(
      (term) => typeof term === 'string' && description.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
    )
  ) {
    throw new MandateError(403, 'EXECUTION_CONDITION_FAILED', 'Operation description does not meet the mandate conditions.');
  }

  if (context.enforceVelocity) {
    const usageKeys = getMandateUsageWindowKeys(now);
    const velocityLimits = [
      ['daily', 'dailyLimitMinor'],
      ['weekly', 'weeklyLimitMinor'],
      ['monthly', 'monthlyLimitMinor'],
    ] as const;
    for (const [window, limitField] of velocityLimits) {
      const limit = limitField in conditions ? conditions[limitField] : undefined;
      if (typeof limit === 'number') {
        const usage = usageForWindow(data, window, usageKeys[window]);
        const excludedAmount =
          context.excludeVelocityReservationAmountMinor
          && context.excludeVelocityUsageWindowKeys?.[window] === usageKeys[window]
            ? context.excludeVelocityReservationAmountMinor
            : 0;
        if (usage.amountMinor - excludedAmount + amountMinor > limit) {
          throw new MandateError(
            409,
            `${window.toUpperCase()}_LIMIT_EXCEEDED`,
            `Operation exceeds the mandate’s ${window} spending limit.`,
          );
        }
      }
    }
    const recurringPeriod =
      'recurringPeriod' in conditions
        ? conditions.recurringPeriod
        : undefined;
    const recurringLimit =
      'recurringLimitMinor' in conditions
        ? conditions.recurringLimitMinor
        : undefined;
    if (
      (recurringPeriod === 'daily' || recurringPeriod === 'weekly' || recurringPeriod === 'monthly')
      && typeof recurringLimit === 'number'
    ) {
      const usage = usageForWindow(data, recurringPeriod, usageKeys[recurringPeriod]);
      const excludedAmount =
        context.excludeVelocityReservationAmountMinor
        && context.excludeVelocityUsageWindowKeys?.[recurringPeriod] === usageKeys[recurringPeriod]
          ? context.excludeVelocityReservationAmountMinor
          : 0;
      if (usage.amountMinor - excludedAmount + amountMinor > recurringLimit) {
        throw new MandateError(
          409,
          'RECURRING_LIMIT_EXCEEDED',
          `Operation exceeds the mandate’s recurring ${recurringPeriod} spending limit.`,
        );
      }
    }
    const maximumTransactionCount =
      'maximumTransactionCount' in conditions
        ? conditions.maximumTransactionCount
        : undefined;
    const rawUsage = asRecord(data.velocityUsage);
    const transactionCount = rawUsage?.totalTransactionCount ?? 0;
    const hasReservedTransaction = Boolean(
      context.excludeVelocityReservationAmountMinor
      && Object.values(context.excludeVelocityUsageWindowKeys ?? {})
        .some((key) => typeof key === 'string'),
    );
    const excludedTransactionCount = hasReservedTransaction ? 1 : 0;
    if (
      typeof maximumTransactionCount === 'number'
      && typeof transactionCount === 'number'
      && transactionCount - excludedTransactionCount + 1 > maximumTransactionCount
    ) {
      throw new MandateError(409, 'TRANSACTION_COUNT_EXCEEDED', 'Mandate transaction count limit has been reached.');
    }
  }

  const requirements = data.approvalRequirements;
  if (typeof requirements !== 'object' || requirements === null) {
    throw new MandateError(500, 'INVALID_MANDATE', 'Mandate approval requirements are invalid.');
  }

  const operationsRequiringApproval =
    'ownerApprovalOperations' in requirements
      ? requirements.ownerApprovalOperations
      : undefined;
  const approvalThreshold =
    'ownerApprovalAboveMinor' in requirements
      ? requirements.ownerApprovalAboveMinor
      : undefined;

  return (
    (Array.isArray(operationsRequiringApproval)
      && operationsRequiringApproval.includes(operation))
    || (typeof approvalThreshold === 'number' && amountMinor > approvalThreshold)
  );
}
