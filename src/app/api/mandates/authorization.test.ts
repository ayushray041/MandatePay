import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestReference = { path: string; id: string; collection: (name: string) => { doc: (id?: string) => TestReference } };
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
  authorizationReservedAmountMinor?: number;
  velocityUsage?: Record<string, unknown>;
  version?: number;
  durationType?: string;
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
    durationType: 'temporary',
    version: 1,
    spendingLimitMinor: 20_000,
    spentAmountMinor: 5_000,
    reservedAmountMinor: 0,
    authorizationReservedAmountMinor: 0,
    velocityUsage: { totalTransactionCount: 0 },
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
      doc: (id?: string) => {
        const reference: TestReference = {
          path: `${name}/${id ?? `${name}-generated`}`,
          id: id ?? `${name}-generated`,
          collection: (subcollection: string) => ({
            doc: (nestedId?: string) => ({
              path: `${name}/${id ?? `${name}-generated`}/${subcollection}/${nestedId ?? `${subcollection}-generated`}`,
              id: nestedId ?? `${subcollection}-generated`,
              collection: () => ({ doc: (versionId?: string) => ({
                path: `${name}/${id ?? `${name}-generated`}/${subcollection}/${nestedId ?? `${subcollection}-generated`}/${versionId ?? 'generated'}`,
                id: versionId ?? 'generated',
                collection: () => ({ doc: () => { throw new Error('Unexpected nested collection.'); } }),
              }) }),
            }),
          }),
        };
        return {
          ...reference,
          get: async () => ({ exists: true, data: () => mocks.mandateData }),
        };
      },
      where: () => ({
        orderBy: () => ({
          get: async () => ({ docs: [] }),
        }),
      }),
    }));

    const transaction: TestTransaction = {
      get: vi.fn(async (reference: TestReference) => ({
        exists: true,
        data: () => reference.path === 'mandates/mandate-1'
          ? mocks.mandateData
          : {
              mandateId: 'mandate-1',
              status: 'pending_approval',
              amountMinor: 1_000,
              operation: 'payment.authorize',
              description: 'Project Alpha invoice',
              mandateVersion: 1,
              approvalApproverIds: ['owner-1'],
              approvalQuorum: 1,
              approvals: [],
              usageWindowKeys: {
                daily: '2026-11-12',
                weekly: '2026-W46',
                monthly: '2026-11',
              },
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
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
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
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
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
        path: 'mandateAuthorizations/mandateAuthorizations-generated',
        id: 'mandateAuthorizations-generated',
      }),
      expect.objectContaining({ status: 'pending_approval' }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
      expect.objectContaining({ authorizationReservedAmountMinor: 1_000 }),
    );
  });

  it('deduplicates operation authorization retries with the same idempotency key', async () => {
    const response = await POST(
      request({
        operation: 'payment.authorize',
        amountMinor: 1_000,
        description: 'Project Alpha invoice',
        idempotencyKey: 'invoice-123',
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction.create).not.toHaveBeenCalled();
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('rejects stale approvals and releases their reserved budget', async () => {
    mocks.mandateData.version = 2;
    mocks.mandateData.authorizationReservedAmountMinor = 1_000;
    mocks.mandateData.velocityUsage = {
      totalTransactionCount: 1,
      daily: { periodKey: '2026-11-12', amountMinor: 1_000, transactionCount: 1 },
      weekly: { periodKey: '2026-W46', amountMinor: 1_000, transactionCount: 1 },
      monthly: { periodKey: '2026-11', amountMinor: 1_000, transactionCount: 1 },
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    const response = await decideAuthorization(
      request({ decision: 'approve' }, 'PATCH'),
      {
        params: Promise.resolve({
          mandateId: 'mandate-1',
          authorizationId: 'authorization-1',
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHORIZATION_REJECTED' },
    });
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-1' }),
      expect.objectContaining({ authorizationReservedAmountMinor: 0 }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandateAuthorizations/authorization-1' }),
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('applies configured quorum across distinct authorized approvers', async () => {
    mocks.mandateData.authorizationReservedAmountMinor = 1_000;
    mocks.mandateData.velocityUsage = {
      totalTransactionCount: 1,
      daily: { periodKey: '2026-11-12', amountMinor: 1_000, transactionCount: 1 },
      weekly: { periodKey: '2026-W46', amountMinor: 1_000, transactionCount: 1 },
      monthly: { periodKey: '2026-11', amountMinor: 1_000, transactionCount: 1 },
    };
    const authorization: {
      mandateId: string;
      status: string;
      amountMinor: number;
      operation: string;
      description: string;
      mandateVersion: number;
      approvalApproverIds: string[];
      approvalQuorum: number;
      approvals: string[];
      usageWindowKeys: { daily: string; weekly: string; monthly: string };
    } = {
      mandateId: 'mandate-1',
      status: 'pending_approval',
      amountMinor: 1_000,
      operation: 'payment.authorize',
      description: 'Project Alpha invoice',
      mandateVersion: 1,
      approvalApproverIds: ['owner-1', 'owner-2'],
      approvalQuorum: 2,
      approvals: [],
      usageWindowKeys: {
        daily: '2026-11-12',
        weekly: '2026-W46',
        monthly: '2026-11',
      },
    };
    const transaction: TestTransaction = {
      get: vi.fn(async (reference) => ({
        exists: true,
        data: () => reference.path === 'mandates/mandate-1'
          ? mocks.mandateData
          : authorization,
      })),
      create: mocks.transaction.create,
      update: mocks.transaction.update,
    };
    mocks.firestore.runTransaction.mockImplementation(
      async (callback: (transaction: TestTransaction) => Promise<unknown>) => callback(transaction),
    );

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    const firstApproval = await decideAuthorization(
      request({ decision: 'approve' }, 'PATCH'),
      {
        params: Promise.resolve({
          mandateId: 'mandate-1',
          authorizationId: 'authorization-1',
        }),
      },
    );
    expect(firstApproval.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandateAuthorizations/authorization-1' }),
      expect.objectContaining({ approvals: ['owner-1'] }),
    );
    expect(mocks.transaction.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-1' }),
      expect.anything(),
    );

    authorization.approvals = ['owner-1'];
    mocks.transaction.update.mockClear();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-2' },
    });
    const finalApproval = await decideAuthorization(
      request({ decision: 'approve' }, 'PATCH'),
      {
        params: Promise.resolve({
          mandateId: 'mandate-1',
          authorizationId: 'authorization-1',
        }),
      },
    );
    expect(finalApproval.status).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-1' }),
      expect.objectContaining({
        authorizationReservedAmountMinor: 0,
        spentAmountMinor: 6_000,
      }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandateAuthorizations/authorization-1' }),
      expect.objectContaining({ status: 'approved', approvals: ['owner-1', 'owner-2'] }),
    );
  });

  it('serializes concurrent authorization attempts against the same available budget', async () => {
    mocks.mandateData = {
      ...mocks.mandateData,
      spendingLimitMinor: 10_000,
      spentAmountMinor: 0,
      reservedAmountMinor: 0,
      authorizationReservedAmountMinor: 0,
      velocityUsage: { totalTransactionCount: 0 },
      approvalRequirements: { ownerApprovalOperations: [] },
      executionConditions: {
        maximumOperationAmountMinor: 10_000,
        requiredDescriptionTerms: ['project alpha'],
      },
    };
    let lock = Promise.resolve();
    mocks.firestore.runTransaction.mockImplementation(
      async (callback: (transaction: TestTransaction) => Promise<unknown>) => {
        const previous = lock;
        let unlock = () => {};
        lock = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        await previous;
        const transaction: TestTransaction = {
          get: vi.fn(async (reference) => ({
            exists: reference.path === 'mandates/mandate-1',
            data: () => reference.path === 'mandates/mandate-1'
              ? { ...mocks.mandateData }
              : undefined,
          })),
          create: mocks.transaction.create,
          update: vi.fn((reference: TestReference, changes: Record<string, unknown>) => {
            if (reference.path === 'mandates/mandate-1') {
              mocks.mandateData = { ...mocks.mandateData, ...changes };
            }
            mocks.transaction.update(reference, changes);
          }),
        };
        try {
          return await callback(transaction);
        } finally {
          unlock();
        }
      },
    );
    const [first, second] = await Promise.all([
      POST(request({
        operation: 'payment.authorize',
        amountMinor: 6_000,
        description: 'Project Alpha order',
        idempotencyKey: 'concurrent-a',
      }), context),
      POST(request({
        operation: 'payment.authorize',
        amountMinor: 6_000,
        description: 'Project Alpha order',
        idempotencyKey: 'concurrent-b',
      }), context),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(mocks.mandateData.spentAmountMinor).toBe(6_000);
  });

  it('requires an agent request and a separate owner decision for spending-limit increases', async () => {
    const requested = await requestLimitIncrease(
      request({ requestedLimitMinor: 30_000, reason: 'Expanded project scope' }),
      context,
    );
    expect(requested.status).toBe(202);
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
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
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
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
    mocks.mandateData.authorizationReservedAmountMinor = 1_000;
    mocks.mandateData.velocityUsage = {
      totalTransactionCount: 1,
      daily: { periodKey: '2026-11-12', amountMinor: 1_000, transactionCount: 1 },
      weekly: { periodKey: '2026-W46', amountMinor: 1_000, transactionCount: 1 },
      monthly: { periodKey: '2026-11', amountMinor: 1_000, transactionCount: 1 },
    } as TestMandateData['velocityUsage'];
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
      expect.objectContaining({ path: 'mandates/mandate-1', id: 'mandate-1' }),
      expect.objectContaining({ spentAmountMinor: 6_000 }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'mandateAuthorizations/authorization-1',
        id: 'authorization-1',
      }),
      expect.objectContaining({ status: 'approved' }),
    );
  });
});
