import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  collection: vi.fn(),
  recordAiDecision: vi.fn(),
  uid: 'owner-a',
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock('@/lib/ai/history', () => ({
  recordAiDecision: mocks.recordAiDecision,
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: { collection: mocks.collection },
}));

import { POST } from '@/app/api/ai/risk/route';

function payment(id: string, amountMinor: number, status: string, createdAt: Date) {
  return {
    id,
    contractId: `contract-${id}`,
    negotiationId: `negotiation-${id}`,
    participantIds: ['owner-a', 'vendor-a'],
    payerId: 'owner-a',
    payerMandateId: 'payer-mandate',
    payeeId: 'vendor-a',
    payeeMandateId: 'payee-mandate',
    amountMinor,
    currency: 'USD',
    serviceTitle: 'Consulting',
    status,
    provider: 'paypal',
    providerOrderId: `order-${id}`,
    approvalUrl: null,
    providerAuthorizationId: null,
    providerCaptureId: null,
    providerRefundId: null,
    pendingOperation: null,
    eventCount: 1,
    mandateApproval: { approverId: 'owner-a', approvedAt: createdAt },
    attempts: { createOrder: 1, authorize: 0, capture: 0, cancel: 0, refund: 0 },
    failureCode: null,
    cancellationReason: null,
    receiptUrl: null,
    authorizedAt: null,
    completedAt: status === 'completed' ? createdAt : null,
    cancelledAt: null,
    refundedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function setupFirestore(payments: Array<Record<string, unknown>>) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn(async () => ({
      docs: payments.map((data) => ({
        id: data.id,
        data: () => data,
      })),
    })),
  };
  mocks.collection.mockImplementation((name: string) => {
    if (name === 'payments') {
      return query;
    }
    if (name === 'agents') {
      return { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) };
    }
    if (name === 'agentActivity') {
      return query;
    }
    return {};
  });
  return query;
}

function request(body: unknown) {
  return new Request('https://example.test/api/ai/risk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('financial risk API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uid = 'owner-a';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    mocks.recordAiDecision.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated callers before querying financial history', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
      status: 401,
    });
    mocks.authenticateRequest.mockResolvedValue({ authenticated: false, response });

    await expect(POST(request({ action: 'spending_forecast', currency: 'USD' }))).resolves.toBe(response);
    expect(mocks.collection).not.toHaveBeenCalled();
  });

  it('derives anomaly inputs from the caller-isolated payment history and persists the evidence', async () => {
    const now = new Date();
    const query = setupFirestore([
      payment('prior', 10_000, 'completed', new Date(now.getTime() - 30 * 60 * 1000)),
      payment('current', 10_000, 'pending', new Date(now.getTime() - 10 * 60 * 1000)),
    ]);

    const response = await POST(request({ action: 'payment_anomaly', paymentId: 'current' }));

    expect(response.status).toBe(200);
    expect(query.where).toHaveBeenCalledWith('participantIds', 'array-contains', 'owner-a');
    expect(await response.json()).toMatchObject({
      data: {
        action: 'payment_anomaly',
        signals: [{ code: 'POSSIBLE_DUPLICATE' }],
        requiresHumanReview: true,
      },
    });
    expect(mocks.recordAiDecision).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-a',
      resourceId: 'current',
      source: 'deterministic',
    }));
  });

  it('does not accept client-supplied amounts or expose payments outside the caller history', async () => {
    setupFirestore([]);
    const malformed = await POST(request({
      action: 'payment_anomaly',
      paymentId: 'current',
      amountMinor: 1,
    }));
    const missing = await POST(request({ action: 'payment_anomaly', paymentId: 'current' }));

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(mocks.recordAiDecision).not.toHaveBeenCalled();
  });
});
