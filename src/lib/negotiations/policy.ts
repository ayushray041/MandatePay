import { NegotiationError } from '@/lib/negotiations/errors';
import { MandateError } from '@/lib/mandates/errors';
import {
  assertExecutionAllowed,
  getMandateApprovalQuorum,
  getMandateApprovers,
} from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import type { NegotiationOfferTerms } from '@/models/negotiation';

type StoredData = Record<string, unknown>;

export function assertNegotiationParticipant(
  negotiation: StoredData,
  agentId: string,
): 'initiator' | 'recipient' {
  if (negotiation.initiatorAgentId === agentId) {
    return 'initiator';
  }
  if (negotiation.recipientAgentId === agentId) {
    return 'recipient';
  }
  throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
}

export function assertNegotiationViewer(
  negotiation: StoredData,
  uid: string,
): void {
  if (
    negotiation.initiatorAgentId === uid
    || negotiation.recipientAgentId === uid
    || (Array.isArray(negotiation.requiredOwnerApprovalIds)
      && negotiation.requiredOwnerApprovalIds.includes(uid))
  ) {
    return;
  }
  throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
}

export function assertMandateActive(
  mandate: StoredData,
  agentId: string,
  now: Date,
): void {
  if (mandate.authorizedAgentId !== agentId) {
    throw new NegotiationError(
      403,
      'MANDATE_AGENT_MISMATCH',
      'The selected mandate does not authorize this agent.',
    );
  }
  if (mandate.status !== 'active') {
    throw new NegotiationError(409, 'MANDATE_NOT_ACTIVE', 'An active mandate is required.');
  }

  const startsAt = timestampToIso(mandate.startsAt);
  const expiresAt = timestampToIso(mandate.expiresAt);
  const permanent = mandate.durationType === 'permanent' && mandate.expiresAt == null;
  if (!startsAt || (!expiresAt && !permanent)) {
    throw new NegotiationError(500, 'INVALID_MANDATE', 'Mandate dates are invalid.');
  }
  if (Date.parse(startsAt) > now.getTime()) {
    throw new NegotiationError(409, 'MANDATE_NOT_STARTED', 'The mandate is not yet active.');
  }
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
    throw new NegotiationError(410, 'MANDATE_EXPIRED', 'The mandate has expired.');
  }
  if (
    !Array.isArray(mandate.allowedOperations)
    || !mandate.allowedOperations.includes('contract.amend')
  ) {
    throw new NegotiationError(
      403,
      'NEGOTIATION_NOT_ALLOWED',
      'The mandate does not allow contract negotiation.',
    );
  }
}

export function assertOfferWithinMandate(
  mandate: StoredData,
  agent: StoredData,
  agentId: string,
  terms: NegotiationOfferTerms,
  now: Date,
): void {
  assertNegotiationAgentActive(agent);
  assertMandateActive(mandate, agentId, now);
  if (
    mandate.currency !== terms.currency
    || !Array.isArray(agent.supportedCurrencies)
    || !agent.supportedCurrencies.includes(terms.currency)
    || !Array.isArray(agent.categories)
    || !agent.categories.includes(terms.category)
  ) {
    throw new NegotiationError(
      403,
      'OFFER_OUTSIDE_CAPABILITIES',
      'The offer currency or service category is outside the agent profile.',
    );
  }

  assertTermsWithinMandate(mandate, terms, now);
}

export function assertNegotiationAgentActive(agent: StoredData): void {
  if (agent.status === 'suspended') {
    throw new NegotiationError(403, 'AGENT_SUSPENDED', 'A suspended agent cannot negotiate or accept terms.');
  }
}

export function assertTermsWithinMandate(
  mandate: StoredData,
  terms: NegotiationOfferTerms,
  now: Date,
): boolean {
  if (mandate.currency !== terms.currency) {
    throw new NegotiationError(
      409,
      'CURRENCY_MISMATCH',
      'Offer currency must match both participants’ mandate currencies.',
    );
  }
  try {
    return assertExecutionAllowed(
      mandate,
      'contract.amend',
      terms.amountMinor,
      `${terms.title} ${terms.description}`,
      now,
      {
        enforceVelocity: true,
        serviceCategory: terms.category,
        contractDurationDays: terms.deliveryDays,
      },
    );
  } catch (error: unknown) {
    if (error instanceof MandateError) {
      throw new NegotiationError(
        error.status,
        error.code,
        error.message,
      );
    }
    throw error;
  }
}

export function requiredOwnerApprovalIds(
  mandates: [StoredData, StoredData],
  terms: NegotiationOfferTerms,
  now: Date,
): string[] {
  return [...new Set(requiredOwnerApprovalGroups(mandates, terms, now)
    .flatMap((group) => group.approverIds))];
}

export function requiredOwnerApprovalGroups(
  mandates: [StoredData, StoredData],
  terms: NegotiationOfferTerms,
  now: Date,
): Array<{ approverIds: string[]; quorum: number }> {
  return mandates.flatMap((mandate) => {
    if (!assertTermsWithinMandate(mandate, terms, now)) {
      return [];
    }
    return [{
      approverIds: getMandateApprovers(mandate),
      quorum: getMandateApprovalQuorum(mandate),
    }];
  });
}

export function isNegotiationTerminal(status: unknown): boolean {
  return ['accepted', 'rejected', 'expired', 'cancelled'].includes(String(status));
}

export function isNegotiationExpired(negotiation: StoredData, now: Date): boolean {
  const expiresAt = timestampToIso(negotiation.expiresAt);
  if (!expiresAt) {
    throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Negotiation expiry is invalid.');
  }
  return Date.parse(expiresAt) <= now.getTime();
}
