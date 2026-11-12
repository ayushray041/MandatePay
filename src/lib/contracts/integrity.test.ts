import { describe, expect, it } from 'vitest';
import { contractVersionHash, isContractVersionHashValid } from '@/lib/contracts/integrity';

const version = {
  contractId: 'neg-1',
  version: 1,
  previousVersionId: null,
  negotiationId: 'neg-1',
  amendmentId: null,
  createdBy: 'owner-a',
  terms: {
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
    expiresAt: '2027-01-01T00:00:00.000Z',
    terminationConditions: 'No termination procedure is configured.',
  },
};

describe('contract version integrity', () => {
  it('hashes canonical version content regardless of object key order', () => {
    const reordered = {
      terms: {
        ...version.terms,
        service: {
          description: version.terms.service.description,
          title: version.terms.service.title,
          category: version.terms.service.category,
          deliveryDays: version.terms.service.deliveryDays,
        },
      },
      createdBy: version.createdBy,
      amendmentId: version.amendmentId,
      negotiationId: version.negotiationId,
      previousVersionId: version.previousVersionId,
      version: version.version,
      contractId: version.contractId,
    };

    expect(contractVersionHash(version)).toBe(contractVersionHash(reordered));
  });

  it('detects changed terms and rejects malformed stored hashes', () => {
    const hash = contractVersionHash(version);
    expect(isContractVersionHashValid(version, hash)).toBe(true);
    expect(isContractVersionHashValid({
      ...version,
      terms: { ...version.terms, amountMinor: 11_000 },
    }, hash)).toBe(false);
    expect(isContractVersionHashValid(version, 'not-a-hash')).toBe(false);
  });
});
