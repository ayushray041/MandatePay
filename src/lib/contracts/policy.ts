import { ContractError } from '@/lib/contracts/errors';
import { MandateError } from '@/lib/mandates/errors';
import {
  assertExecutionAllowed,
  parseMandateUsageWindowKeys,
  type MandateUsageWindowKeys,
} from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import type { ContractTerms } from '@/models/contract';

type StoredData = Record<string, unknown>;

export function contractReservationUsageWindowKeys(
  value: unknown,
): [
  Partial<MandateUsageWindowKeys> | undefined,
  Partial<MandateUsageWindowKeys> | undefined,
] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const keys: [
    Partial<MandateUsageWindowKeys> | undefined,
    Partial<MandateUsageWindowKeys> | undefined,
  ] = [
    parseMandateUsageWindowKeys(record.initiator),
    parseMandateUsageWindowKeys(record.recipient),
  ];
  return keys[0] || keys[1] ? keys : undefined;
}

export function assertContractParty(contract: StoredData, uid: string): void {
  if (!Array.isArray(contract.participantIds) || !contract.participantIds.includes(uid)) {
    throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
  }
}

export function assertRequiredApprover(contract: StoredData, uid: string): void {
  assertContractParty(contract, uid);
  if (!Array.isArray(contract.requiredApproverIds) || !contract.requiredApproverIds.includes(uid)) {
    throw new ContractError(403, 'FORBIDDEN', 'This account is not authorized to approve the contract.');
  }
}

function assertMandateOperation(
  mandate: StoredData,
  operation: 'contract.create' | 'contract.amend',
  description: string,
  amountMinor: number,
  now: Date,
  context: {
    serviceCategory: string;
    contractDurationDays: number;
    reservedAmountToReplace: number;
    reservedUsageWindowKeys?: Partial<MandateUsageWindowKeys>;
  },
): void {
  try {
    const reservedAmountMinor = Number(mandate.reservedAmountMinor ?? 0);
    if (
      !Number.isSafeInteger(reservedAmountMinor)
      || reservedAmountMinor < context.reservedAmountToReplace
    ) {
      throw new ContractError(409, 'INVALID_RESERVATION', 'The existing contract reservation is invalid.');
    }
    assertExecutionAllowed(
      {
        ...mandate,
        reservedAmountMinor: reservedAmountMinor - context.reservedAmountToReplace,
      },
      operation,
      amountMinor,
      description,
      now,
      {
        enforceVelocity: true,
        serviceCategory: context.serviceCategory,
        contractDurationDays: context.contractDurationDays,
        ...(context.reservedUsageWindowKeys
          ? {
            excludeVelocityReservationAmountMinor: context.reservedAmountToReplace,
            excludeVelocityUsageWindowKeys: context.reservedUsageWindowKeys,
          }
          : {}),
      },
    );
  } catch (error: unknown) {
    if (error instanceof ContractError) {
      throw error;
    }
    if (error instanceof MandateError) {
      throw new ContractError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export function assertContractTermsAuthorized(
  mandates: [StoredData, StoredData],
  agents: [StoredData, StoredData],
  agentIds: [string, string],
  terms: ContractTerms,
  previousAmountMinor: number,
  operation: 'contract.create' | 'contract.amend',
  now: Date,
  reservationUsageWindowKeys?: [
    Partial<MandateUsageWindowKeys> | undefined,
    Partial<MandateUsageWindowKeys> | undefined,
  ],
): void {
  const description = `${terms.service.title} ${terms.service.description}`;
  const expiresAt = Date.parse(terms.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new ContractError(409, 'CONTRACT_EXPIRED', 'Contract terms must expire in the future.');
  }
  const contractDurationDays = Math.max(
    1,
    Math.ceil((expiresAt - now.getTime()) / 86_400_000),
  );

  for (const index of [0, 1] as const) {
    const mandate = mandates[index];
    const agent = agents[index];
    if (mandate.authorizedAgentId !== agentIds[index]) {
      throw new ContractError(409, 'MANDATE_AGENT_MISMATCH', 'Contract mandate assignment changed.');
    }
    assertMandateOperation(mandate, operation, description, terms.amountMinor, now, {
      serviceCategory: terms.service.category,
      contractDurationDays,
      reservedAmountToReplace: previousAmountMinor,
      reservedUsageWindowKeys: reservationUsageWindowKeys?.[index],
    });

    const mandateExpiry = timestampToIso(mandate.expiresAt);
    if (
      !(mandate.durationType === 'permanent' && mandate.expiresAt == null)
      && (!mandateExpiry || expiresAt > Date.parse(mandateExpiry))
    ) {
      throw new ContractError(
        409,
        'CONTRACT_EXPIRY_EXCEEDS_MANDATE',
        'Contract expiry cannot exceed either participant mandate.',
      );
    }
    if (
      mandate.currency !== terms.currency
      || !Array.isArray(agent.supportedCurrencies)
      || !agent.supportedCurrencies.includes(terms.currency)
      || !Array.isArray(agent.categories)
      || !agent.categories.includes(terms.service.category)
    ) {
      throw new ContractError(
        403,
        'CONTRACT_OUTSIDE_AUTHORITY',
        'Contract currency or service category is outside a participant mandate or agent profile.',
      );
    }

    const limit = mandate.spendingLimitMinor;
    const spent = mandate.spentAmountMinor;
    const reserved = mandate.reservedAmountMinor ?? 0;
    const maximumOperationAmountMinor =
      typeof mandate.executionConditions === 'object'
      && mandate.executionConditions !== null
      && 'maximumOperationAmountMinor' in mandate.executionConditions
        ? mandate.executionConditions.maximumOperationAmountMinor
        : undefined;
    if (
      typeof limit !== 'number'
      || typeof spent !== 'number'
      || typeof reserved !== 'number'
      || !Number.isSafeInteger(limit)
      || !Number.isSafeInteger(spent)
      || !Number.isSafeInteger(reserved)
      || !Number.isSafeInteger(previousAmountMinor)
      || reserved < previousAmountMinor
      || terms.amountMinor > limit - spent - reserved + previousAmountMinor
      || (typeof maximumOperationAmountMinor === 'number'
        && terms.amountMinor > maximumOperationAmountMinor)
    ) {
      throw new ContractError(
        409,
        'SPENDING_LIMIT_EXCEEDED',
        'Contract terms exceed the remaining authorized mandate budget.',
      );
    }
  }
}

export function contractExpiryStatus(
  status: unknown,
  expiresAt: unknown,
  now = new Date(),
): string {
  const expiry = timestampToIso(expiresAt);
  return (status === 'active' || status === 'pending_review')
    && expiry !== null
    && Date.parse(expiry) <= now.getTime()
    ? 'expired'
    : String(status);
}
