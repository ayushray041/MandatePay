import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestReference = { collection: string; id: string };
type TestTransaction = {
  get: (reference: TestReference) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
type TestMandateData = {
  ownerId: string;
  authorizedAgentId: string;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  spendingLimitMinor: number;
  spentAmountMinor: number;
  currency: string;
  allowedOperations: string[];
  approvalRequirements: {
    ownerApprovalOperations: string[];
    ownerApprovalAboveMinor?: number;
  };
  pendingLimitRequest?: Record<string, unknown> | null;
  reservedAmountMinor?: number;
  executionConditions: {
    maximumOperationAmountMinor: number;
    requiredDescriptionTerms: string[];
  };
};

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  writeMandateAuditEvent: vi.fn(),
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  transaction: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mandateData: {
    ownerId: 'owner-1',
    authorizedAgentId: 'agent-1',
    status: 'active',
    startsAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    spendingLimitMinor: 20_000,
    spentAmountMinor: 5_000,
    currency: 'USD',
    allowedOperations: ['payment.authorize'],
    approvalRequirements: {
      ownerApprovalOperations: [],
      ownerApprovalAboveMinor: undefined,
    },
    executionConditions: {
      maximumOperationAmountMinor: 8_000,
      requiredDescriptionTerms: ['project alpha'],
    },
  } as TestMandateData,
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: mocks.firestore,
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

vi.mock('@/lib/mandates/audit', () => ({
  writeMandateAuditEvent: mocks.writeMandateAuditEvent,
}));

import { GET, POST } from '@/app/api/mandates/[mandateId]/authorizations/route';
import { PATCH as decideAuthorization } from '@/app/api/mandates/[mandateId]/authorizations/[authorizationId]/route';
import { POST as requestLimitIncrease } from '@/app/api/mandates/[mandateId]/limit-requests/route';
import { POST as decideLimitIncrease } from '@/app/api/mandates/[mandateId]/limit-requests/decision/route';
import { PATCH as updateMandate } from '@/app/api/mandates/[mandateId]/route';
import { POST as updateMandateLifecycle } from '@/app/api/mandates/[mandateId]/lifecycle/route';

const context = { params: Promise.resolve({ mandateId: 'mandate-1' }) };

function request(body?: unknown, method = 'POST'): Request {
  return new Request('https://example.test/api/mandates/mandate-1/authorizations', {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

describe('mandate APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mandateData = {
      ownerId: 'owner-1',
      authorizedAgentId: 'agent-1',
      status: 'active',
      startsAt: new Date('2026-11-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      spendingLimitMinor: 20_000,
      spentAmountMinor: 5_000,
      currency: 'USD',
      allowedOperations: ['payment.authorize'],
      approvalRequirements: {
        ownerApprovalOperations: [],
        ownerApprovalAboveMinor: undefined,
      },
      executionConditions: {
        maximumOperationAmountMinor: 8_000,
        requiredDescriptionTerms: ['project alpha'],
      },
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });

    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id?: string) => ({
        collection: name,
        id: id ?? `${name}-generated`,
        get: async () => ({ exists: true, data: () => mocks.mandateData }),
      }),
      where: () => ({
        orderBy: () => ({
          get: async () => ({ docs: [] }),
        }),
      }),
    }));

    const transaction: TestTransaction = {
      get: vi.fn(async (reference: TestReference) => ({
        exists: true,
        data: () => reference.collection === 'mandates'
          ? mocks.mandateData
          : {
              mandateId: 'mandate-1',
              status: 'pending_approval',
              amountMinor: 1_000,
              operation: 'payment.authorize',
              description: 'Project Alpha invoice',
            },
      })),
      create: mocks.transaction.create,
      update: mocks.transaction.update,
    };
    mocks.transaction.get.mockImplementation(transaction.get);
    mocks.firestore.runTransaction.mockImplementation(
      async (callback: (transaction: TestTransaction) => Promise<unknown>) => callback(transaction),
    );
  });

  it('does not disclose a mandate to a user who is neither owner nor agent', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'stranger' },
    });
    const response = await GET(request(undefined, 'GET'), context);

    expect(response.status).toBe(404);
    expect(mocks.firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects an agent trying to edit the owner’s mandate', async () => {
    const response = await updateMandate(
      request({ title: 'Changed by agent' }, 'PATCH'),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('prevents irreversible revocation while accepted budget remains reserved', async () => {
    mocks.mandateData.reservedAmountMinor = 1_000;
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    const response = await updateMandateLifecycle(
      request({ action: 'revoke' }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'MANDATE_HAS_RESERVATIONS' },
    });
    expect(mocks.transaction.update).not.toHaveBeenCalled();
    expect(mocks.writeMandateAuditEvent).not.toHaveBeenCalled();
  });

  it('allows mandate revocation after reservations are resolved', async () => {
    mocks.mandateData.reservedAmountMinor = 0;
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    const response = await updateMandateLifecycle(
      request({ action: 'revoke' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'mandates', id: 'mandate-1' }),
      expect.objectContaining({ status: 'revoked' }),
    );
    expect(mocks.writeMandateAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'mandate.revoked' }),
    );
  });

  it('prevents an owner from escalating a limit through ordinary mandate edits', async () => {
    mocks.mandateData.status = 'draft';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    const response = await updateMandate(
      request({ spendingLimitMinor: 30_000 }, 'PATCH'),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'LIMIT_APPROVAL_REQUIRED' },
    });
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('rejects disallowed or over-budget operation requests before writing authorization records', async () => {
    const invalidPayload = await POST(
      request({
        operation: 'payment.authorize',
        amountMinor: 0,
        description: '',
      }),
      context,
    );
    expect(invalidPayload.status).toBe(400);

    const disallowed = await POST(
      request({
        operation: 'contract.create',
        amountMinor: 1_000,
        description: 'Project Alpha work',
      }),
      context,
    );
    expect(disallowed.status).toBe(403);
    expect(mocks.transaction.create).not.toHaveBeenCalled();

    const overBudget = await POST(
      request({
        operation: 'payment.authorize',
        amountMinor: 15_001,
        description: 'Project Alpha work',
      }),
      context,
    );
    expect(overBudget.status).toBe(409);
    expect(mocks.transaction.create).not.toHaveBeenCalled();
  });

  it('commits approved operations against budget and requires approval when policy says so', async () => {
    const immediate = await POST(
      request({
        operation: 'payment.authorize',
        amountMinor: 5_000,
        description: 'Project Alpha milestone',
      }),
      context,
    );
    expect(immediate.status).toBe(201);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'mandates', id: 'mandate-1' }),
      expect.objectContaining({ spentAmountMinor: 10_000 }),
    );

    mocks.transaction.create.mockClear();
    mocks.transaction.update.mockClear();
    mocks.mandateData.approvalRequirements = {
      ownerApprovalOperations: ['payment.authorize'],
    };
    const pending = await POST(
      request({
        operation: 'payment.authorize',
        amountMinor: 1_000,
        description: 'Project Alpha milestone',
      }),
      context,
    );
    expect(pending.status).toBe(202);
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'mandateAuthorizations',
        id: 'mandateAuthorizations-generated',
      }),
      expect.objectContaining({ status: 'pending_approval' }),
    );
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('requires an agent request and a separate owner decision for spending-limit increases', async () => {
    const requested = await requestLimitIncrease(
      request({ requestedLimitMinor: 30_000, reason: 'Expanded project scope' }),
      context,
    );
    expect(requested.status).toBe(202);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'mandates', id: 'mandate-1' }),
      expect.objectContaining({
        pendingLimitRequest: expect.objectContaining({
          requestedLimitMinor: 30_000,
          previousLimitMinor: 20_000,
        }),
      }),
    );

    mocks.transaction.update.mockClear();
    mocks.mandateData.pendingLimitRequest = {
      requestedLimitMinor: 30_000,
      previousLimitMinor: 20_000,
      requestedBy: 'agent-1',
      reason: 'Expanded project scope',
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    const decided = await decideLimitIncrease(
      request({ decision: 'approve' }),
      context,
    );

    expect(decided.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'mandates', id: 'mandate-1' }),
      expect.objectContaining({
        spendingLimitMinor: 30_000,
        pendingLimitRequest: null,
      }),
    );
    expect(mocks.writeMandateAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'mandate.limit_increase_approved' }),
    );
  });

  it('does not approve a limit increase after mandate expiry', async () => {
    mocks.mandateData.pendingLimitRequest = {
      requestedLimitMinor: 30_000,
      previousLimitMinor: 20_000,
      requestedBy: 'agent-1',
      reason: 'Expanded project scope',
    };
    mocks.mandateData.expiresAt = new Date('2026-11-11T00:00:00.000Z');
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    const response = await decideLimitIncrease(
      request({ decision: 'approve' }),
      context,
    );

    expect(response.status).toBe(410);
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('requires owner approval for gated operations and then commits their amount', async () => {
    mocks.mandateData.approvalRequirements = {
      ownerApprovalOperations: ['payment.authorize'],
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    const decided = await decideAuthorization(
      new Request('https://example.test/api/mandates/mandate-1/authorizations/auth-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
      {
        params: Promise.resolve({
          mandateId: 'mandate-1',
          authorizationId: 'authorization-1',
        }),
      },
    );

    expect(decided.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'mandates', id: 'mandate-1' }),
      expect.objectContaining({ spentAmountMinor: 6_000 }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'mandateAuthorizations',
        id: 'authorization-1',
      }),
      expect.objectContaining({ status: 'approved' }),
    );
  });
});
