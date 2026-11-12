import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  documents: new Map<string, Record<string, unknown>>(),
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  writeAgentActivity: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));
vi.mock('@/lib/firebase/firestore', () => ({ getServerTimestamp: () => new Date() }));
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock('@/lib/agents/audit', () => ({ writeAgentActivity: mocks.writeAgentActivity }));

import { POST } from '@/app/api/marketplace/reviews/route';

const agentId = `agt_${'A'.repeat(32)}`;
const paymentId = 'payment-complete-1';
const reviewId = createHash('sha256').update(paymentId).digest('hex');
const paymentPath = `payments/${paymentId}`;
const reviewPath = `marketplaceReviews/${reviewId}`;

function reference(path: string) {
  const [collectionName, documentId] = path.split('/');
  return {
    id: documentId,
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    subcollection: collectionName,
  };
}

function collection(path: string) {
  return {
    doc: (id: string) => reference(`${path}/${id}`),
  };
}

function request() {
  return new Request('https://mandatepay.test/api/marketplace/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      paymentId,
      rating: 5,
      comment: 'The service was delivered exactly as agreed.',
    }),
  });
}

function setupTransaction() {
  const transaction = {
    get: vi.fn(async (ref: { path: string }) => {
      const data = mocks.documents.get(ref.path);
      return { exists: data !== undefined, data: () => data };
    }),
    create: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      if (mocks.documents.has(ref.path)) {
        throw new Error('Document already exists.');
      }
      mocks.documents.set(ref.path, value);
    }),
    set: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      mocks.documents.set(ref.path, { ...mocks.documents.get(ref.path), ...value });
    }),
  };
  mocks.firestore.runTransaction.mockImplementation(
    async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  );
}

describe('marketplace review submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'verified-payer' },
    });
    mocks.firestore.collection.mockImplementation((name: string) => collection(name));
    mocks.documents.set(paymentPath, {
      status: 'completed',
      payerId: 'verified-payer',
      payeeId: 'agent-owner',
      participantIds: ['verified-payer', 'agent-owner'],
    });
    mocks.documents.set('agents/agent-owner', {
      agentId,
      ownerId: 'agent-owner',
    });
    mocks.documents.set(`agentIdentities/${agentId}`, {
      agentId,
      agentUid: 'agent-owner',
    });
    mocks.documents.set(`agentMarketplaceProfiles/${agentId}`, {
      agentId,
      ownerId: 'agent-owner',
    });
    setupTransaction();
  });

  it('accepts one review from the completed payment payer and returns no reviewer identity', async () => {
    const response = await POST(request());
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data).toMatchObject({
      agentId,
      rating: 5,
      reviewerLabel: 'Verified customer',
    });
    expect(result.data).not.toHaveProperty('reviewerUid');
    expect(mocks.documents.get(reviewPath)).toMatchObject({
      agentId,
      reviewerUid: 'verified-payer',
      paymentId,
    });
    expect(mocks.documents.get(`marketplaceAgentMetrics/${agentId}`)).toMatchObject({
      reviewCount: 1,
      ratingTotal: 5,
    });
  });

  it('rejects reviews from anyone other than the verified payer', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'other-user' },
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.documents.has(reviewPath)).toBe(false);
  });

  it('prevents a second review for the same payment', async () => {
    mocks.documents.set(reviewPath, {
      agentId,
      paymentId,
      reviewerUid: 'verified-payer',
      rating: 4,
      comment: 'Already reviewed for this completed payment.',
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.documents.get(`marketplaceAgentMetrics/${agentId}`)).toBeUndefined();
  });
});
