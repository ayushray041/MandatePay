import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateAgentRequest: vi.fn(),
  runTransaction: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  get: vi.fn(),
  getMandate: vi.fn(),
  doc: vi.fn(),
}));

vi.mock('@/lib/agents/auth', () => ({
  authenticateAgentRequest: mocks.authenticateAgentRequest,
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: vi.fn(() => ({
      where: mocks.where,
      doc: mocks.doc,
    })),
    runTransaction: mocks.runTransaction,
  },
}));

import { GET as listMandates } from '@/app/api/agent/v1/mandates/route';
import {
  GET as listAuthorizations,
  POST as requestAuthorization,
} from '@/app/api/agent/v1/mandates/[mandateId]/authorizations/route';

const principal = {
  uid: 'agent-owner-1',
  ownerId: 'agent-owner-1',
  agentId: `agt_${'A'.repeat(32)}`,
  keyId: 'keyidentifier1234',
  sessionId: 'keyidentifier1234',
  scopes: ['mandates:read', 'mandates:authorize'] as const,
};

describe('scoped agent API isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAgentRequest.mockResolvedValue({ authenticated: true, agent: principal });
    mocks.where.mockReturnValue({ where: mocks.where, orderBy: mocks.orderBy });
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockReturnValue({ get: mocks.get });
    mocks.doc.mockReturnValue({ id: 'foreign-mandate', get: mocks.getMandate });
  });

  it('lists mandates only through the authenticated agent assignment', async () => {
    const assigned = {
      id: 'assigned',
      data: () => ({ authorizedAgentId: principal.uid, status: 'active' }),
    };
    const foreign = {
      id: 'foreign',
      data: () => ({ authorizedAgentId: 'other-agent', status: 'active' }),
    };
    mocks.get.mockResolvedValue({ docs: [assigned, foreign] });

    const response = await listMandates(new Request('https://mandatepay.test/api/agent/v1/mandates'));

    expect(response.status).toBe(200);
    expect(mocks.where).toHaveBeenCalledWith('authorizedAgentId', '==', principal.uid);
    expect(await response.json()).toMatchObject({ data: [{ id: 'assigned' }] });
  });

  it('rejects authorization requests against another agent’s mandate', async () => {
    const transaction = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({
          authorizedAgentId: 'different-agent',
          ownerId: 'mandate-owner',
        }),
      })),
      create: vi.fn(),
      update: vi.fn(),
    };
    mocks.runTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
    const response = await requestAuthorization(
      new Request('https://mandatepay.test/api/agent/v1/mandates/foreign/authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'payment.authorize',
          amountMinor: 100,
          description: 'Authorized service purchase',
        }),
      }),
      { params: Promise.resolve({ mandateId: 'foreign' }) },
    );

    expect(response.status).toBe(403);
    expect(transaction.create).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('limits authorization history to the authenticated agent after mandate reassignment', async () => {
    mocks.getMandate.mockResolvedValue({
      exists: true,
      data: () => ({ authorizedAgentId: principal.uid, ownerId: 'mandate-owner' }),
    });
    mocks.get.mockResolvedValue({
      docs: [{
        id: 'authorization-1',
        data: () => ({
          authorizedAgentId: principal.uid,
          mandateId: 'assigned',
          operation: 'payment.authorize',
          amountMinor: 100,
          currency: 'USD',
          description: 'Current agent operation',
          mandateVersion: 1,
          status: 'approved',
        }),
      }],
    });

    const response = await listAuthorizations(
      new Request('https://mandatepay.test/api/agent/v1/mandates/assigned/authorizations'),
      { params: Promise.resolve({ mandateId: 'assigned' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.where).toHaveBeenNthCalledWith(1, 'mandateId', '==', 'assigned');
    expect(mocks.where).toHaveBeenNthCalledWith(2, 'authorizedAgentId', '==', principal.uid);
    expect(await response.json()).toMatchObject({
      data: [{ id: 'authorization-1', description: 'Current agent operation' }],
    });
  });
});
