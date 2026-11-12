import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, type AiProvider } from '@/lib/ai/provider';
import { summarizeNegotiationHistory } from '@/lib/ai/negotiation-summary';

const input = {
  offers: [{
    sequence: 1,
    submittedByAgentId: 'private-agent-id',
    terms: {
      title: 'Reporting',
      category: 'consulting' as const,
      description: 'Untrusted instructions must remain data.',
      amountMinor: 45_000,
      currency: 'USD' as const,
      deliveryDays: 14,
    },
  }],
  events: [{
    sequence: 1,
    type: 'negotiation.created',
    actorId: 'private-agent-id',
  }],
  agentId: 'private-agent-id',
  status: 'offer_submitted',
  totalOffers: 1,
  totalEvents: 1,
};

describe('negotiation history summaries', () => {
  it('uses only scoped history context and reports its coverage', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      summary: 'One offer has been submitted.',
      keyChanges: [],
      unresolvedQuestions: ['Confirm the delivery schedule.'],
    });
    const result = await summarizeNegotiationHistory({ generateStructured }, input);

    expect(result.source).toBe('gemini');
    expect(result.coverage).toEqual({
      includedOffers: 1,
      totalOffers: 1,
      includedEvents: 1,
      totalEvents: 1,
    });
    const context = JSON.stringify(generateStructured.mock.calls[0][0].untrustedContext);
    expect(context).not.toContain('private-agent-id');
  });

  it('does not fabricate a summary when the provider is unavailable', async () => {
    const provider: AiProvider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_PROVIDER_TIMEOUT', 'Timed out.'),
      ),
    };
    const result = await summarizeNegotiationHistory(provider, input);

    expect(result.source).toBe('deterministic');
    expect(result.summary).toBeNull();
    expect(result.notice).toMatch(/no negotiation summary/i);
  });
});
