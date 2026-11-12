import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, type AiProvider } from '@/lib/ai/provider';
import { compareNegotiationOffers } from '@/lib/ai/offer-comparison';
import type { NegotiationOfferTerms } from '@/models/negotiation';

const terms: NegotiationOfferTerms = {
  title: 'Monthly reporting service',
  category: 'consulting',
  description: 'Provide monthly reporting and analytics for business operations.',
  amountMinor: 45_000,
  currency: 'USD',
  deliveryDays: 14,
};
const mandate = {
  authorizedAgentId: 'agent-a',
  status: 'active',
  startsAt: new Date('2025-01-01T00:00:00Z'),
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  allowedOperations: ['contract.amend'],
  currency: 'USD',
  spendingLimitMinor: 100_000,
  spentAmountMinor: 0,
  reservedAmountMinor: 0,
  executionConditions: {
    maximumOperationAmountMinor: 90_000,
    requiredDescriptionTerms: [],
  },
  approvalRequirements: { ownerApprovalOperations: [] },
};
const offers = [{
  sequence: 1,
  submittedByAgentId: 'agent-a',
  terms,
  mandate,
  agent: { supportedCurrencies: ['USD'], categories: ['consulting'] },
}];

describe('offer comparison', () => {
  it('returns deterministic metrics and labels unavailable model commentary honestly', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_NOT_CONFIGURED', 'Provider unavailable.'),
      ),
    };
    const result = await compareNegotiationOffers(provider, {
      offers,
      agentId: 'agent-a',
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.source).toBe('deterministic');
    expect(result.comparison).toBeNull();
    expect(result.offers[0]).toMatchObject({
      sequence: 1,
      perspective: 'you',
      amountMinor: 45_000,
      mandateAllowed: true,
    });
  });

  it('rejects model commentary that references nonexistent offers', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockResolvedValue({
        summary: 'The offers have different delivery windows.',
        tradeoffs: [{ offerSequence: 4, observation: 'Offer 4 has an earlier delivery date.' }],
        questions: [],
      }),
    };
    await expect(compareNegotiationOffers(provider, {
      offers,
      agentId: 'agent-a',
      now: new Date('2026-01-01T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });

  it('surfaces explicit owner approval requirements as deterministic metrics', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_NOT_CONFIGURED', 'Provider unavailable.'),
      ),
    };
    const result = await compareNegotiationOffers(provider, {
      offers: [{
        ...offers[0],
        mandate: {
          ...mandate,
          approvalRequirements: { ownerApprovalOperations: ['contract.amend'] },
        },
      }],
      agentId: 'agent-a',
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.offers[0]).toMatchObject({
      mandateAllowed: true,
      mandateApprovalRequired: true,
    });
  });
});
