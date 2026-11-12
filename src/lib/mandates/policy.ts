import {
  mandateOperationSchema,
  mandateStatusSchema,
  type MandateOperation,
  type MandateStatus,
} from '@/models/mandate';
import { MandateError } from '@/lib/mandates/errors';
import { timestampToIso } from '@/lib/mandates/format';

type MandateData = Record<string, unknown>;

export function mandateStatus(data: MandateData): MandateStatus {
  return mandateStatusSchema.parse(data.status);
}

export function isMandateOwner(data: MandateData, uid: string): boolean {
  return data.ownerId === uid;
}

export function isAuthorizedAgent(data: MandateData, uid: string): boolean {
  return data.authorizedAgentId === uid;
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

export function assertNotExpired(data: MandateData, now: Date): void {
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

export function assertExecutionAllowed(
  data: MandateData,
  operation: MandateOperation,
  amountMinor: number,
  description: string,
  now: Date,
): boolean {
  assertNotExpired(data, now);
  if (mandateStatus(data) !== 'active') {
    throw new MandateError(409, 'MANDATE_NOT_ACTIVE', 'Mandate is not active.');
  }

  const startsAt = timestampToIso(data.startsAt);
  if (!startsAt || Date.parse(startsAt) > now.getTime()) {
    throw new MandateError(409, 'MANDATE_NOT_STARTED', 'Mandate is not within its execution window.');
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
  if (
    typeof spendingLimitMinor !== 'number'
    || typeof spentAmountMinor !== 'number'
    || amountMinor > spendingLimitMinor - spentAmountMinor
  ) {
    throw new MandateError(409, 'SPENDING_LIMIT_EXCEEDED', 'Operation exceeds the remaining mandate budget.');
  }

  const conditions = data.executionConditions;
  if (typeof conditions !== 'object' || conditions === null) {
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
