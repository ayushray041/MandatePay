import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, type AiProvider } from '@/lib/ai/provider';
import { recommendNegotiation } from '@/lib/ai/negotiation-recommendation';
import type { NegotiationOfferTerms } from '@/models/negotiation';

const terms: NegotiationOfferTerms = {
  title: 'Monthly analytics service',
  category: 'consulting',
  description: 'Provide monthly analytics and reporting for the business.',
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
  approvalRequirements: {
    ownerApprovalOperations: [],
    ownerApprovalAboveMinor: null,
  },
};
const agent = { supportedCurrencies: ['USD'], categories: ['consulting'] };
const input = {
  mandate,
  agent,
  agentId: 'agent-a',
  currentTerms: terms,
  offers: [{ sequence: 1, submittedByAgentId: 'agent-b', terms }],
  ownMandatePerspective: 'initiator' as const,
  now: new Date('2026-01-01T00:00:00Z'),
};

function providerWith(output: unknown): AiProvider {
  return { generateStructured: vi.fn().mockResolvedValue(output) };
}

describe('negotiation recommendations', () => {
  it('rejects a model counteroffer outside the authorized spending limit', async () => {
    const result = await recommendNegotiation(providerWith({
      summary: 'The current price is within range.',
      recommendations: [{ action: 'counter', rationale: 'Consider a lower price.' }],
      counteroffer: { ...terms, amountMinor: 150_000 },
      caveats: [],
    }), input);

    expect(result.source).toBe('gemini');
    expect(result.counterofferValidation).toBe('rejected');
    expect(result.counterofferRejectionReason).toContain('remaining mandate budget');
    expect(result.recommendation?.counteroffer).toBeNull();
  });

  it('never recommends acceptance when the current offer violates the mandate', async () => {
    const result = await recommendNegotiation(providerWith({
      summary: 'The offer appears acceptable.',
      recommendations: [{ action: 'accept', rationale: 'The price is attractive.' }],
      counteroffer: null,
      caveats: [],
    }), {
      ...input,
      currentTerms: { ...terms, amountMinor: 150_000 },
    });

    expect(result.mandateAssessment.allowed).toBe(false);
    expect(result.recommendation?.recommendations).toEqual([]);
  });

  it('reports provider outages without presenting invented model output', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_NOT_CONFIGURED', 'AI provider is not configured.'),
      ),
    };
    const result = await recommendNegotiation(provider, input);

    expect(result.source).toBe('deterministic');
    expect(result.recommendation).toBeNull();
    expect(result.notice).toMatch(/no model recommendation/i);
  });
});
