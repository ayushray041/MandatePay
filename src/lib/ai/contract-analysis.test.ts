import { describe, expect, it, vi } from 'vitest';
import type { ContractTerms } from '@/models/contract';
import { analyzeContractTerms } from '@/lib/ai/contract-analysis';
import { AiProviderError } from '@/lib/ai/provider';

const terms: ContractTerms = {
  parties: [
    {
      userId: 'private-user-id',
      displayName: 'Private User',
      role: 'client',
      agentId: 'private-agent-id',
      agentDisplayName: 'Private Agent',
      mandateId: 'private-mandate-id',
      mandateTitle: 'Private Mandate',
    },
    {
      userId: 'other-private-user-id',
      displayName: 'Other User',
      role: 'freelancer',
      agentId: 'other-private-agent-id',
      agentDisplayName: 'Other Agent',
      mandateId: 'other-private-mandate-id',
      mandateTitle: 'Other Mandate',
    },
  ],
  service: {
    title: 'Reporting service',
    category: 'consulting',
    description: 'Deliver monthly reporting to the client.',
    deliveryDays: 14,
  },
  amountMinor: 45_000,
  currency: 'USD',
  paymentConditions: 'Payment is due after monthly delivery.',
  deliveryConditions: 'Reports are delivered by the end of each month.',
  expiresAt: '2027-01-01T00:00:00.000Z',
  terminationConditions: 'Either party may terminate with written notice.',
};

describe('contract clause analysis', () => {
  it('limits model context to clause text and adds a fixed non-legal disclaimer', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      summary: 'The payment timing may need more detail.',
      clauses: [{
        field: 'paymentConditions',
        excerpt: 'Payment is due after monthly delivery.',
        concern: 'The term does not specify a payment deadline.',
        question: 'How many days after delivery is payment due?',
        severity: 'medium',
      }],
    });
    const result = await analyzeContractTerms({ generateStructured }, terms);

    expect(result.disclaimer).toContain('not legal advice');
    const context = JSON.stringify(generateStructured.mock.calls[0][0].untrustedContext);
    expect(context).not.toContain('private-user-id');
    expect(context).not.toContain('private-agent-id');
    expect(context).not.toContain('private-mandate-id');
  });

  it('rejects invented or mismatched clause excerpts', async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        summary: 'Review the payment term.',
        clauses: [{
          field: 'paymentConditions',
          excerpt: 'Payment is due in five days.',
          concern: 'The deadline could be unclear.',
          question: 'Is five days acceptable?',
          severity: 'low',
        }],
      }),
    };
    await expect(analyzeContractTerms(provider, terms)).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
  });

  it('returns an explicit non-fabricated review fallback when the provider is unavailable', async () => {
    const provider = {
      generateStructured: vi.fn().mockRejectedValue(
        new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'Unavailable'),
      ),
    };
    const result = await analyzeContractTerms(provider, terms);

    expect(result).toMatchObject({
      source: 'deterministic',
      analysis: null,
      notice: expect.stringContaining('no clause analysis'),
      disclaimer: expect.stringContaining('not legal advice'),
    });
  });
});
