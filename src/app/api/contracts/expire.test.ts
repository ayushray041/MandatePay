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

import { POST } from '@/app/api/contracts/expire/route';

function reference(kind: string, id: string) {
  return {
    kind,
    id,
    path: `${kind}/${id}`,
    collection: (name: string) => ({
      doc: (nestedId?: string) => reference(`${kind}/${id}/${name}`, nestedId ?? `${name}-generated`),
    }),
  };
}

describe('scheduled contract expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-scheduler-secret';
    const contractRef = reference('contracts', 'contract-1');
    const contract = {
      status: 'active',
      expiresAt: new Date(Date.now() - 1_000),
      eventCount: 3,
    };
    const documents = new Map<string, Record<string, unknown>>([
      ['contracts/contract-1', contract],
      ['payments/contract-1', { status: 'pending' }],
    ]);
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({
        size: 1,
        docs: [{ ref: contractRef }],
      })),
    };
    mocks.firestore.collection.mockImplementation((name: string) => (
      name === 'contracts' ? query : { doc: (id: string) => reference(name, id) }
    ));
    mocks.transaction.get.mockImplementation(async (ref: { path: string }) => {
      const data = documents.get(ref.path);
      return { exists: data !== undefined, data: () => data };
    });
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (transaction: typeof mocks.transaction) => Promise<unknown>,
    ) => callback(mocks.transaction));
  });

  it('fails closed without a scheduler credential', async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(new Request('https://example.test/api/contracts/expire', {
      method: 'POST',
    }));

    expect(response.status).toBe(503);
    expect(mocks.firestore.collection).not.toHaveBeenCalled();
  });

  it('marks due contracts expired and appends a system event transactionally', async () => {
    const response = await POST(new Request('https://example.test/api/contracts/expire', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-scheduler-secret' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { scanned: 1, expired: 1, limit: 100 },
    });
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'contracts' }),
      expect.objectContaining({ status: 'expired', eventCount: 4 }),
    );
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'contracts/contract-1/events' }),
      expect.objectContaining({
        type: 'contract.expired',
        actorId: 'system:contract-expiry',
        details: { source: 'scheduled_expiry' },
      }),
    );
  });

  it('releases pending-review reservations when a contract expires', async () => {
    const expiresAt = new Date(Date.now() - 1_000);
    const party = (userId: string, agentId: string, mandateId: string) => ({
      userId,
      displayName: userId,
      role: userId === 'owner-a' ? 'client' : 'freelancer',
      agentId,
      agentDisplayName: agentId,
      mandateId,
      mandateTitle: mandateId,
    });
    const terms = {
      parties: [
        party('owner-a', 'agent-a', 'mandate-a'),
        party('owner-b', 'agent-b', 'mandate-b'),
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
      expiresAt: expiresAt.toISOString(),
      terminationConditions: 'No termination procedure is configured.',
    };
    const contractRef = reference('contracts', 'contract-1');
    const contract = {
      status: 'pending_review',
      expiresAt,
      eventCount: 3,
      currentVersionId: 'v1',
      currentVersion: 1,
      mandateIds: ['mandate-a', 'mandate-b'],
    };
    const docs = new Map<string, Record<string, unknown>>([
      [contractRef.path, contract],
      [`${contractRef.path}/versions/v1`, {
        contractId: 'contract-1',
        version: 1,
        previousVersionId: null,
        negotiationId: 'neg-1',
        amendmentId: null,
        createdBy: 'agent-a',
        terms,
      }],
      ['mandates/mandate-a', { ownerId: 'owner-a', reservedAmountMinor: 10_000 }],
      ['mandates/mandate-b', { ownerId: 'owner-b', reservedAmountMinor: 10_000 }],
    ]);
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({ size: 1, docs: [{ ref: contractRef }] })),
    };
    mocks.firestore.collection.mockImplementation((name: string) => (
      name === 'contracts' ? query : { doc: (id: string) => reference(name, id) }
    ));
    mocks.transaction.get.mockImplementation(async (ref: { path: string }) => {
      const data = docs.get(ref.path);
      return { exists: data !== undefined, data: () => data };
    });

    const response = await POST(new Request('https://example.test/api/contracts/expire', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-scheduler-secret' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-a' }),
      expect.objectContaining({ reservedAmountMinor: 0 }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-b' }),
      expect.objectContaining({ reservedAmountMinor: 0 }),
    );
  });
});
