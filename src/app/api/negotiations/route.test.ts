import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestReference = {
  kind: string;
  id: string;
  collection: (name: string) => { doc: (id?: string) => TestReference };
};
type TestTransaction = {
  get: (reference: TestReference) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  transaction: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  negotiationData: {
    initiatorAgentId: 'agent-1',
    recipientAgentId: 'agent-2',
    initiatorMandateId: 'mandate-1',
    recipientMandateId: null,
    title: 'Billing integration',
    status: 'initiated',
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    currentOfferId: null,
    currentOffer: null,
    offerCount: 0,
    eventCount: 1,
  },
  mandateData: {
    authorizedAgentId: 'agent-1',
    status: 'active',
    startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    spendingLimitMinor: 20_000,
    spentAmountMinor: 0,
    currency: 'USD',
    allowedOperations: ['contract.amend'],
    executionConditions: {
      maximumOperationAmountMinor: 15_000,
      requiredDescriptionTerms: [],
    },
    approvalRequirements: {
      ownerApprovalOperations: [],
    },
  },
  agentData: {
    categories: ['software'],
    supportedCurrencies: ['USD'],
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: mocks.firestore,
}));
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

import { GET as listNegotiations, POST as createNegotiation } from '@/app/api/negotiations/route';
import { POST as submitOffer } from '@/app/api/negotiations/[negotiationId]/offers/route';

const negotiationContext = {
  params: Promise.resolve({ negotiationId: 'negotiation-1' }),
};

const validTerms = {
  title: 'API integration',
  category: 'software',
  description: 'Build and document the billing service integration.',
  amountMinor: 12_000,
  currency: 'USD',
  deliveryDays: 14,
};

function request(path: string, body: unknown) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reference(kind: string, id = `${kind}-generated`): TestReference {
  return {
    kind,
    id,
    collection: (name) => ({
      doc: (nestedId) => reference(`${kind}/${id}/${name}`, nestedId),
    }),
  };
}

describe('negotiation offer APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.negotiationData = {
      initiatorAgentId: 'agent-1',
      recipientAgentId: 'agent-2',
      initiatorMandateId: 'mandate-1',
      recipientMandateId: null,
      title: 'Billing integration',
      status: 'initiated',
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      currentOfferId: null,
      currentOffer: null,
      offerCount: 0,
      eventCount: 1,
    };
    mocks.mandateData = {
      authorizedAgentId: 'agent-1',
      status: 'active',
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      spendingLimitMinor: 20_000,
      spentAmountMinor: 0,
      currency: 'USD',
      allowedOperations: ['contract.amend'],
      executionConditions: {
        maximumOperationAmountMinor: 15_000,
        requiredDescriptionTerms: [],
      },
      approvalRequirements: {
        ownerApprovalOperations: [],
      },
    };
    mocks.agentData = {
      categories: ['software'],
      supportedCurrencies: ['USD'],
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });
    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id?: string) => reference(name, id),
      where: () => ({
        orderBy: () => ({
          limit: () => ({ get: async () => ({ docs: [] }) }),
        }),
      }),
    }));

    const transaction: TestTransaction = {
      get: vi.fn(async (ref: TestReference) => {
        const data = ref.kind === 'negotiations' && ref.id === 'negotiation-1'
          ? mocks.negotiationData
          : ref.kind === 'agents' && ref.id === 'agent-1'
            ? mocks.agentData
            : ref.kind === 'agents' && ref.id === 'agent-2'
              ? mocks.agentData
              : mocks.mandateData;
        return {
          exists: true,
          data: () => data,
        };
      }),
      create: mocks.transaction.create,
      update: mocks.transaction.update,
    };
    mocks.transaction.get.mockImplementation(transaction.get);
    mocks.firestore.runTransaction.mockImplementation(
      async (callback: (tx: TestTransaction) => Promise<unknown>) => callback(transaction),
    );
  });

  it('creates an initiated request using token identity and an active assigned mandate', async () => {
    const response = await createNegotiation(
      request('/api/negotiations', {
        mandateId: 'mandate-1',
        recipientAgentId: 'agent-2',
        title: 'Billing integration',
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        initiatorAgentId: 'agent-1',
        recipientAgentId: 'agent-2',
        status: 'initiated',
      },
    });
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations' }),
      expect.objectContaining({ status: 'initiated', initiatorAgentId: 'agent-1' }),
    );
  });

  it('submits the first offer as an immutable record under the initiator mandate', async () => {
    const response = await submitOffer(
      request('/api/negotiations/negotiation-1/offers', { terms: validTerms }),
      negotiationContext,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        sequence: 1,
        submittedByAgentId: 'agent-1',
        mandateId: 'mandate-1',
        terms: { amountMinor: 12_000 },
      },
    });
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/offers' }),
      expect.objectContaining({ sequence: 1, terms: validTerms }),
    );
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations', id: 'negotiation-1' }),
      expect.objectContaining({ status: 'offer_submitted', offerCount: 1 }),
    );
  });

  it('rejects offers exceeding the mandate budget without writing history', async () => {
    const response = await submitOffer(
      request('/api/negotiations/negotiation-1/offers', {
        terms: { ...validTerms, amountMinor: 20_001 },
      }),
      negotiationContext,
    );

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(409);
    expect(mocks.transaction.create).not.toHaveBeenCalled();
    expect(mocks.transaction.update).not.toHaveBeenCalled();
  });

  it('prevents an unrelated account from participating', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'stranger' },
    });
    const response = await submitOffer(
      request('/api/negotiations/negotiation-1/offers', { terms: validTerms }),
      negotiationContext,
    );
    expect(response.status).toBe(404);
    expect(mocks.transaction.create).not.toHaveBeenCalled();
  });

  it('includes only the caller’s owner-approval negotiations in the inbox', async () => {
    const pendingNegotiation = {
      ...mocks.negotiationData,
      status: 'pending_owner_approval',
      requiredOwnerApprovalIds: ['owner-1'],
      ownerApprovals: [],
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id?: string) => reference(name, id),
      where: (field: string, _operator: string, value: string) => ({
        orderBy: () => ({
          limit: () => ({ get: async () => ({ docs: [] }) }),
        }),
        limit: () => ({
          get: async () => ({
            docs: field === 'requiredOwnerApprovalIds' && value === 'owner-1'
              ? [{
                  id: 'negotiation-pending',
                  data: () => pendingNegotiation,
                }]
              : [],
          }),
        }),
      }),
    }));

    const response = await listNegotiations(
      new Request('https://example.test/api/negotiations'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{
        id: 'negotiation-pending',
        status: 'pending_owner_approval',
        ownerApprovalRequiredForViewer: true,
      }],
    });
  });
});
