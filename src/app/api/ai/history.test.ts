import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  collection: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: { collection: mocks.collection },
}));

import { GET } from '@/app/api/ai/history/route';

describe('AI recommendation history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-a' },
    });
  });

  it('scopes history to the verified user and omits the private owner key', async () => {
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({
        docs: [{
          id: 'history-1',
          data: () => ({
            actorUserId: 'owner-a',
            action: 'payment_anomaly',
            resourceType: 'payment',
            resourceId: 'payment-1',
            source: 'deterministic',
            providerId: null,
            modelVersion: 'rules-v1',
            promptVersion: 'rules-v1',
            confidenceScore: 0.3,
            confidenceMethod: 'sample_size_heuristic',
            requiresHumanReview: true,
            evidence: [{ type: 'server_history', reference: 'payment-1', sampleSize: 2 }],
            result: { riskLevel: 'insufficient_data' },
            createdAt: new Date('2026-11-12T10:00:00.000Z'),
          }),
        }],
      })),
    };
    mocks.collection.mockReturnValue(query);

    const response = await GET(new Request('https://example.test/api/ai/history'));
    const payload = await response.json();

    expect(query.where).toHaveBeenCalledWith('actorUserId', '==', 'owner-a');
    expect(payload.data[0]).toMatchObject({
      id: 'history-1',
      action: 'payment_anomaly',
      resourceId: 'payment-1',
      createdAt: '2026-11-12T10:00:00.000Z',
    });
    expect(payload.data[0]).not.toHaveProperty('actorUserId');
  });

  it('rejects unauthenticated callers before querying history', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
      status: 401,
    });
    mocks.authenticateRequest.mockResolvedValue({ authenticated: false, response });

    await expect(GET(new Request('https://example.test/api/ai/history'))).resolves.toBe(response);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});
