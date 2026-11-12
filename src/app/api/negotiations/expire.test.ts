import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  transaction: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));

import { POST } from '@/app/api/negotiations/expire/route';

function reference(kind: string, id: string) {
  return {
    kind,
    id,
    collection: (name: string) => ({
      doc: (nestedId?: string) => reference(`${kind}/${id}/${name}`, nestedId ?? `${name}-generated`),
    }),
  };
}

describe('scheduled negotiation expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-scheduler-secret';
    const negotiationRef = reference('negotiations', 'negotiation-1');
    const negotiation = {
      initiatorAgentId: 'agent-1',
      recipientAgentId: 'agent-2',
      status: 'pending_owner_approval',
      expiresAt: new Date(Date.now() - 1_000),
      currentOfferId: 'offer-1',
      currentOffer: { sequence: 1, terms: { amountMinor: 5_000, currency: 'USD' } },
      offerCount: 1,
      eventCount: 3,
      version: 3,
    };
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({
        size: 1,
        docs: [{ ref: negotiationRef }],
      })),
    };
    mocks.firestore.collection.mockReturnValue(query);
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => negotiation,
    });
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (transaction: typeof mocks.transaction) => Promise<unknown>,
    ) => callback(mocks.transaction));
  });

  it('fails closed without a scheduler credential', async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(new Request('https://example.test/api/negotiations/expire', {
      method: 'POST',
    }));

    expect(response.status).toBe(503);
    expect(mocks.firestore.collection).not.toHaveBeenCalled();
  });

  it('records expiry, a system-attributed event, and a version snapshot transactionally', async () => {
    const response = await POST(new Request('https://example.test/api/negotiations/expire', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-scheduler-secret' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { scanned: 1, expired: 1, limit: 100 },
    });
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations' }),
      expect.objectContaining({ status: 'expired', version: 4, eventCount: 4 }),
    );
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/events' }),
      expect.objectContaining({
        type: 'negotiation.expired',
        actorSystemId: 'negotiation-expiry-worker',
      }),
    );
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/versions' }),
      expect.objectContaining({ version: 4, status: 'expired' }),
    );
  });
});
