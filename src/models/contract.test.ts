import { describe, expect, it } from 'vitest';
import {
  amendmentProposeSchema,
  contractApprovalSchema,
  contractGenerateSchema,
  contractTermsSchema,
} from '@/models/contract';

const terms = {
  parties: [
    {
      userId: 'owner-a',
      displayName: 'Owner A',
      agentId: 'agent-a',
      agentDisplayName: 'Agent A',
      mandateId: 'mandate-a',
      mandateTitle: 'Development mandate',
    },
    {
      userId: 'owner-b',
      displayName: 'Owner B',
      agentId: 'agent-b',
      agentDisplayName: 'Agent B',
      mandateId: 'mandate-b',
      mandateTitle: 'Design mandate',
    },
  ],
  service: {
    title: 'Website design',
    category: 'design',
    description: 'Design and deliver a responsive website.',
    deliveryDays: 30,
  },
  amountMinor: 125_000,
  currency: 'USD',
  paymentConditions: 'No payment is authorized by this record.',
  deliveryConditions: 'Delivery is expected within 30 days.',
  expiresAt: '2027-01-01T00:00:00.000Z',
  terminationConditions: 'No termination procedure is configured.',
};

describe('contract schemas', () => {
  it('accepts a complete generated contract term set', () => {
    expect(contractTermsSchema.safeParse(terms).success).toBe(true);
  });

  it('rejects invalid party references, currencies, and unexpected fields', () => {
    expect(contractTermsSchema.safeParse({
      ...terms,
      parties: [terms.parties[0], { ...terms.parties[1], mandateId: 'mandate-a' }],
    }).success).toBe(false);
    expect(contractTermsSchema.safeParse({ ...terms, currency: 'US' }).success).toBe(false);
    expect(contractTermsSchema.safeParse({ ...terms, signed: true }).success).toBe(false);
  });

  it('requires a valid negotiation id and an explicit rejection reason', () => {
    expect(contractGenerateSchema.safeParse({ negotiationId: 'neg-1' }).success).toBe(true);
    expect(contractGenerateSchema.safeParse({ negotiationId: 'bad/id' }).success).toBe(false);
    expect(contractApprovalSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(contractApprovalSchema.safeParse({
      decision: 'reject',
      reason: 'Terms need revision.',
    }).success).toBe(true);
  });

  it('requires an amendment to change at least one permitted term', () => {
    expect(amendmentProposeSchema.safeParse({}).success).toBe(false);
    expect(amendmentProposeSchema.safeParse({ amountMinor: 200_000 }).success).toBe(true);
    expect(amendmentProposeSchema.safeParse({ parties: terms.parties }).success).toBe(false);
  });
});
