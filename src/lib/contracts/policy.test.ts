import { describe, expect, it } from 'vitest';
import {
  assertContractParty,
  assertContractTermsAuthorized,
} from '@/lib/contracts/policy';
import { ContractError } from '@/lib/contracts/errors';
import type { ContractTerms } from '@/models/contract';

const now = new Date();
const expiry = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
const terms: ContractTerms = {
  parties: [
    {
      userId: 'owner-a',
      displayName: 'Owner A',
      role: 'client',
      agentId: 'agent-a',
      agentDisplayName: 'Agent A',
      mandateId: 'mandate-a',
      mandateTitle: 'A mandate',
    },
    {
      userId: 'owner-b',
      displayName: 'Owner B',
      role: 'freelancer',
      agentId: 'agent-b',
      agentDisplayName: 'Agent B',
      mandateId: 'mandate-b',
      mandateTitle: 'B mandate',
    },
  ],
  service: {
    title: 'Build website',
    category: 'software',
    description: 'Build and document a responsive website.',
    deliveryDays: 20,
  },
  amountMinor: 10_000,
  currency: 'USD',
  paymentConditions: 'No payment is authorized.',
  deliveryConditions: 'Deliver within 20 days.',
  expiresAt: expiry.toISOString(),
  terminationConditions: 'No termination procedure is configured.',
};

function mandate(agentId: string, reservedAmountMinor = 10_000) {
  return {
    authorizedAgentId: agentId,
    status: 'active',
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    allowedOperations: ['contract.create', 'contract.amend'],
    spendingLimitMinor: 20_000,
    spentAmountMinor: 0,
    reservedAmountMinor,
    currency: 'USD',
    executionConditions: {
      maximumOperationAmountMinor: 15_000,
      requiredDescriptionTerms: [],
    },
    approvalRequirements: { ownerApprovalOperations: [] },
  };
}

function agent() {
  return { categories: ['software'], supportedCurrencies: ['USD'] };
}

describe('contract authorization policy', () => {
  it('accepts terms covered by both active mandates and existing reservations', () => {
    expect(() => assertContractTermsAuthorized(
      [mandate('agent-a'), mandate('agent-b')],
      [agent(), agent()],
      ['agent-a', 'agent-b'],
      terms,
      terms.amountMinor,
      'contract.create',
      now,
    )).not.toThrow();
  });

  it('rejects amount increases beyond either mandate capacity', () => {
    expect(() => assertContractTermsAuthorized(
      [mandate('agent-a'), mandate('agent-b', 19_000)],
      [agent(), agent()],
      ['agent-a', 'agent-b'],
      { ...terms, amountMinor: 12_000 },
      terms.amountMinor,
      'contract.amend',
      now,
    )).toThrowError(ContractError);
  });

  it('rejects missing operation permissions, mandate expiry, and unsupported service category', () => {
    expect(() => assertContractTermsAuthorized(
      [{ ...mandate('agent-a'), allowedOperations: ['contract.amend'] }, mandate('agent-b')],
      [agent(), agent()],
      ['agent-a', 'agent-b'],
      terms,
      terms.amountMinor,
      'contract.create',
      now,
    )).toThrowError(ContractError);
    expect(() => assertContractTermsAuthorized(
      [mandate('agent-a'), { ...mandate('agent-b'), expiresAt: now }],
      [agent(), agent()],
      ['agent-a', 'agent-b'],
      terms,
      terms.amountMinor,
      'contract.create',
      now,
    )).toThrowError(ContractError);
    expect(() => assertContractTermsAuthorized(
      [mandate('agent-a'), mandate('agent-b')],
      [agent(), { categories: ['design'], supportedCurrencies: ['USD'] }],
      ['agent-a', 'agent-b'],
      terms,
      terms.amountMinor,
      'contract.create',
      now,
    )).toThrowError(ContractError);
  });

  it('limits contract access to listed parties', () => {
    expect(() => assertContractParty({ participantIds: ['owner-a'] }, 'owner-a')).not.toThrow();
    expect(() => assertContractParty({ participantIds: ['owner-a'] }, 'outsider')).toThrowError(ContractError);
  });
});
