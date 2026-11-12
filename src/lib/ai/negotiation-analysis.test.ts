import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, type AiProvider } from '@/lib/ai/provider';
import { analyzeNegotiation } from '@/lib/ai/negotiation-analysis';
import type { NegotiationOfferTerms, NegotiationStrategyProfile } from '@/models/negotiation';

const terms: NegotiationOfferTerms = {
  title: 'Monthly reporting service',
  category: 'consulting',
  description: 'Provide monthly reporting and analytics for business operations.',
  amountMinor: 45_000,
  currency: 'USD',
  deliveryDays: 14,
};
const strategy: NegotiationStrategyProfile = {
  posture: 'balanced',
  priorities: ['price', 'delivery', 'certainty'],
  concessionStepBasisPoints: 500,
};
const offers = [
  { sequence: 1, submittedByAgentId: 'agent-a', terms },
  { sequence: 2, submittedByAgentId: 'agent-b', terms: { ...terms, amountMinor: 50_000, deliveryDays: 10 } },
];

describe('negotiation analysis', () => {
  it('calculates price deltas and observed references without inventing market pricing', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_NOT_CONFIGURED', 'Not configured.'),
      ),
    };
    const result = await analyzeNegotiation(provider, {
      offers,
      agentId: 'agent-a',
      strategy,
    });

    expect(result.source).toBe('deterministic');
    expect(result.priceDifferences[1].deltaFromPreviousMinor).toBe(5_000);
    expect(result.coverage).toEqual({ includedOffers: 2, totalOffers: 2 });
    expect(result.observedPriceReference).toMatchObject({
      lowMinor: 45_000,
      medianMinor: 47_500,
      highMinor: 50_000,
      sampleSize: 2,
      disclaimer: 'Observed negotiation prices only; not an external market estimate.',
    });
  });

  it('rejects model findings that reference offers outside the input history', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockResolvedValue({
        unfavorableTerms: [{
          offerSequence: 4,
          term: 'Payment schedule',
          concern: 'Payment timing is unspecified.',
          severity: 'medium',
        }],
        strategies: [],
        outcomePrediction: { likelihood: 'uncertain', rationale: 'More discussion is needed.' },
      }),
    };
    await expect(analyzeNegotiation(provider, {
      offers,
      agentId: 'agent-a',
      strategy,
    })).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
});
