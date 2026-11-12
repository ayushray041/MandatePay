import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  firestore: { collection: vi.fn() },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: mocks.firestore,
}));
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

import { GET } from '@/app/api/negotiations/[negotiationId]/route';

const context = { params: Promise.resolve({ negotiationId: 'negotiation-1' }) };
const negotiation = {
  initiatorAgentId: 'agent-1',
  recipientAgentId: 'agent-2',
  initiatorMandateId: 'private-mandate-1',
  recipientMandateId: 'private-mandate-2',
  title: 'Billing integration',
  status: 'counter_offered',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  currentOfferId: 'offer-2',
  currentOffer: {
    sequence: 2,
    submittedByAgentId: 'agent-2',
    mandateId: 'private-mandate-2',
    terms: {
      title: 'API integration',
      category: 'software',
      description: 'Build and document the billing service integration.',
      amountMinor: 10_000,
      currency: 'USD',
      deliveryDays: 14,
    },
    createdAt: new Date(),
  },
  offerCount: 2,
  eventCount: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
  acceptedAt: null,
  resolvedByAgentId: null,
  rejectionReason: null,
};

function reference(kind: string, id: string) {
  return {
    kind,
    id,
    get: async () => ({
      id,
      exists: true,
      data: () => kind === 'negotiations' ? negotiation : { displayName: `Display ${id}` },
    }),
    collection: (name: string) => ({
      orderBy: () => ({
        get: async () => ({
          docs: name === 'offers'
            ? [
                { id: 'offer-1', data: () => ({ sequence: 1, createdAt: new Date() }) },
                { id: 'offer-2', data: () => ({ sequence: 2, createdAt: new Date() }) },
              ]
            : [
                { id: 'event-1', data: () => ({ sequence: 1, type: 'negotiation.created' }) },
                { id: 'event-2', data: () => ({ sequence: 2, type: 'offer.submitted' }) },
                { id: 'event-3', data: () => ({ sequence: 3, type: 'offer.countered' }) },
              ],
        }),
      }),
    }),
  };
}

describe('negotiation history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });
    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id: string) => reference(name, id),
    }));
  });

  it('returns the complete immutable offer and activity history to a participant', async () => {
    const response = await GET(
      new Request('https://example.test/api/negotiations/negotiation-1'),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        negotiation: {
          id: 'negotiation-1',
          initiatorDisplayName: 'Display agent-1',
          recipientDisplayName: 'Display agent-2',
          currentOfferId: 'offer-2',
        },
        offers: [{ id: 'offer-1' }, { id: 'offer-2' }],
        events: [
          { id: 'event-1', type: 'negotiation.created' },
          { id: 'event-2', type: 'offer.submitted' },
          { id: 'event-3', type: 'offer.countered' },
        ],
      },
    });
  });

  it('does not disclose history to a nonparticipant', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'stranger' },
    });
    const response = await GET(
      new Request('https://example.test/api/negotiations/negotiation-1'),
      context,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NEGOTIATION_NOT_FOUND' },
    });
  });
});
