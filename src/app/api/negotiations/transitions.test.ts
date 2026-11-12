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
    recipientMandateId: null as string | null,
    title: 'Billing integration',
    status: 'offer_submitted',
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    currentOfferId: 'offer-1',
    currentOffer: {
      sequence: 1,
      submittedByAgentId: 'agent-1',
      mandateId: 'mandate-1',
      terms: {
        title: 'API integration',
        category: 'software',
        description: 'Build and document the billing service integration.',
        amountMinor: 12_000,
        currency: 'USD',
        deliveryDays: 14,
      },
      createdAt: new Date(),
    },
    offerCount: 1,
    eventCount: 2,
    version: 1,
    lockedOfferId: null,
    acceptanceReason: null as string | null,
    ownerApprovals: [] as string[],
    requiredOwnerApprovalIds: [] as string[],
  },
  otherNegotiationData: null as Record<string, unknown> | null,
  mandates: {
    'mandate-1': {
      authorizedAgentId: 'agent-1',
      status: 'active',
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      spendingLimitMinor: 20_000,
      spentAmountMinor: 0,
      reservedAmountMinor: 0,
      currency: 'USD',
      allowedOperations: ['contract.amend'],
      executionConditions: {
        maximumOperationAmountMinor: 15_000,
        requiredDescriptionTerms: [],
      },
      approvalRequirements: { ownerApprovalOperations: [] },
      ownerId: 'owner-1',
    },
    'mandate-2': {
      authorizedAgentId: 'agent-2',
      status: 'active',
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      spendingLimitMinor: 20_000,
      spentAmountMinor: 0,
      reservedAmountMinor: 0,
      currency: 'USD',
      allowedOperations: ['contract.amend'],
      executionConditions: {
        maximumOperationAmountMinor: 15_000,
        requiredDescriptionTerms: [],
      },
      approvalRequirements: { ownerApprovalOperations: [] },
      ownerId: 'owner-2',
    },
  } as Record<string, Record<string, unknown>>,
  agentData: {
    'agent-1': { categories: ['software'], supportedCurrencies: ['USD'] },
    'agent-2': { categories: ['software'], supportedCurrencies: ['USD'] },
  } as Record<string, Record<string, unknown>>,
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: mocks.firestore,
}));
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

import { POST as submitOffer } from '@/app/api/negotiations/[negotiationId]/offers/route';
import { POST as decideNegotiation } from '@/app/api/negotiations/[negotiationId]/decision/route';
import { POST as decideOwnerApproval } from '@/app/api/negotiations/[negotiationId]/owner-approval/route';

const context = { params: Promise.resolve({ negotiationId: 'negotiation-1' }) };
const decisionUrl = 'https://example.test/api/negotiations/negotiation-1/decision';
const ownerApprovalUrl = 'https://example.test/api/negotiations/negotiation-1/owner-approval';
const offerUrl = 'https://example.test/api/negotiations/negotiation-1/offers';
let transaction!: TestTransaction;

function request(url: string, body: unknown) {
  const negotiationBody = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const currentOfferId = url.includes('negotiation-2')
    ? 'offer-1'
    : mocks.negotiationData.currentOfferId;
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...negotiationBody,
      ...(!Object.prototype.hasOwnProperty.call(negotiationBody, 'expectedOfferId')
        && (url.endsWith('/offers') || url.endsWith('/decision') || url.endsWith('/owner-approval'))
        ? { expectedOfferId: currentOfferId ?? null }
        : {}),
      ...(negotiationBody.decision === 'accept' && !('reason' in negotiationBody)
        ? { reason: 'Reviewed terms and accepted.' }
        : {}),
    }),
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

describe('negotiation state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.negotiationData = {
      initiatorAgentId: 'agent-1',
      recipientAgentId: 'agent-2',
      initiatorMandateId: 'mandate-1',
      recipientMandateId: null,
      title: 'Billing integration',
      status: 'offer_submitted',
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      currentOfferId: 'offer-1',
      currentOffer: {
        sequence: 1,
        submittedByAgentId: 'agent-1',
        mandateId: 'mandate-1',
        terms: {
          title: 'API integration',
          category: 'software',
          description: 'Build and document the billing service integration.',
          amountMinor: 12_000,
          currency: 'USD',
          deliveryDays: 14,
        },
        createdAt: new Date(),
      },
      offerCount: 1,
      eventCount: 2,
      version: 1,
      lockedOfferId: null,
      acceptanceReason: null,
      ownerApprovals: [],
      requiredOwnerApprovalIds: [],
    };
    mocks.otherNegotiationData = {
      ...mocks.negotiationData,
      title: 'Second negotiation',
      currentOffer: {
        ...mocks.negotiationData.currentOffer,
        terms: {
          ...mocks.negotiationData.currentOffer.terms,
          amountMinor: 9_000,
        },
      },
    };
    mocks.mandates = {
      'mandate-1': {
        authorizedAgentId: 'agent-1',
        status: 'active',
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        spendingLimitMinor: 20_000,
        spentAmountMinor: 0,
        reservedAmountMinor: 0,
        currency: 'USD',
        allowedOperations: ['contract.amend'],
        executionConditions: {
          maximumOperationAmountMinor: 15_000,
          requiredDescriptionTerms: [],
        },
        approvalRequirements: { ownerApprovalOperations: [] },
        ownerId: 'owner-1',
      },
      'mandate-2': {
        authorizedAgentId: 'agent-2',
        status: 'active',
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        spendingLimitMinor: 20_000,
        spentAmountMinor: 0,
        reservedAmountMinor: 0,
        currency: 'USD',
        allowedOperations: ['contract.amend'],
        executionConditions: {
          maximumOperationAmountMinor: 15_000,
          requiredDescriptionTerms: [],
        },
        approvalRequirements: { ownerApprovalOperations: [] },
        ownerId: 'owner-2',
      },
    };
    mocks.agentData = {
      'agent-1': { categories: ['software'], supportedCurrencies: ['USD'] },
      'agent-2': { categories: ['software'], supportedCurrencies: ['USD'] },
    };
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-2' },
    });
    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id?: string) => reference(name, id),
    }));

    transaction = {
      get: vi.fn(async (ref: TestReference) => {
        const data = ref.kind === 'negotiations'
          ? ref.id === 'negotiation-2'
            ? mocks.otherNegotiationData ?? undefined
            : mocks.negotiationData
          : ref.kind === 'mandates'
            ? mocks.mandates[ref.id]
            : ref.kind === 'agents'
              ? mocks.agentData[ref.id]
              : undefined;
        return {
          exists: data !== undefined,
          data: () => data,
        };
      }),
      create: mocks.transaction.create,
      update: vi.fn((ref: TestReference, changes: Record<string, unknown>) => {
        if (ref.kind === 'negotiations') {
          if (ref.id === 'negotiation-2' && mocks.otherNegotiationData) {
            mocks.otherNegotiationData = { ...mocks.otherNegotiationData, ...changes };
          } else {
            mocks.negotiationData = { ...mocks.negotiationData, ...changes };
          }
        } else if (ref.kind === 'mandates') {
          mocks.mandates[ref.id] = { ...mocks.mandates[ref.id], ...changes };
        }
        mocks.transaction.update(ref, changes);
      }),
    };
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (tx: TestTransaction) => Promise<unknown>,
    ) => callback(transaction));
  });

  it('lets the recipient counter once and appends a new immutable offer', async () => {
    const response = await submitOffer(
      request(offerUrl, {
        mandateId: 'mandate-2',
        terms: {
          title: 'Revised API integration',
          category: 'software',
          description: 'Build and document the billing service integration.',
          amountMinor: 10_000,
          currency: 'USD',
          deliveryDays: 18,
        },
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.negotiationData).toMatchObject({
      status: 'counter_offered',
      recipientMandateId: 'mandate-2',
      offerCount: 2,
      version: 2,
      lockedOfferId: null,
    });
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/offers' }),
      expect.objectContaining({ sequence: 2, submittedByAgentId: 'agent-2' }),
    );
  });

  it('prevents a suspended participant from submitting a counteroffer', async () => {
    mocks.agentData['agent-2'].status = 'suspended';
    const response = await submitOffer(
      request(offerUrl, {
        mandateId: 'mandate-2',
        terms: {
          title: 'Revised API integration',
          category: 'software',
          description: 'Build and document the billing service integration.',
          amountMinor: 10_000,
          currency: 'USD',
          deliveryDays: 18,
        },
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.negotiationData.offerCount).toBe(1);
    expect(mocks.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects a stale counteroffer and repeated HTTP retries without appending duplicates', async () => {
    const firstRequest = {
      mandateId: 'mandate-2',
      expectedOfferId: 'offer-1',
      terms: {
        title: 'Revised API integration',
        category: 'software',
        description: 'Build and document the billing service integration.',
        amountMinor: 10_000,
        currency: 'USD',
        deliveryDays: 18,
      },
    };
    const first = await submitOffer(request(offerUrl, firstRequest), context);
    expect(first.status).toBe(201);
    const createsAfterFirst = mocks.transaction.create.mock.calls.length;
    const retry = await submitOffer(request(offerUrl, firstRequest), context);

    expect(retry.status).toBe(409);
    expect(mocks.transaction.create).toHaveBeenCalledTimes(createsAfterFirst);
    expect(mocks.negotiationData.offerCount).toBe(2);
  });

  it('rejects stale decisions before authorizing a different latest offer', async () => {
    const response = await decideNegotiation(
      request(decisionUrl, {
        decision: 'accept',
        mandateId: 'mandate-2',
        reason: 'Reviewed terms.',
        expectedOfferId: 'older-offer',
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.negotiationData.status).toBe('offer_submitted');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(0);
  });

  it('atomically accepts the latest offer and reserves its value against both mandates', async () => {
    const response = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.negotiationData.status).toBe('accepted');
    expect(mocks.negotiationData.lockedOfferId).toBe('offer-1');
    expect(mocks.negotiationData.acceptanceReason).toBe('Reviewed terms and accepted.');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(12_000);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(12_000);
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/events' }),
      expect.objectContaining({ type: 'negotiation.accepted' }),
    );
  });

  it('rejects concurrent duplicate accepts after the first transaction resolves', async () => {
    let tail = Promise.resolve();
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (tx: TestTransaction) => Promise<unknown>,
    ) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release();
      }
    });

    const decisions = await Promise.all([
      decideNegotiation(
        request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
        context,
      ),
      decideNegotiation(
        request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
        context,
      ),
    ]);

    expect(decisions.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(12_000);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(12_000);
  });

  it('serializes competing accepts against the shared mandate reservation', async () => {
    let tail = Promise.resolve();
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (tx: TestTransaction) => Promise<unknown>,
    ) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release();
      }
    });

    const decisions = await Promise.all([
      decideNegotiation(
        request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
        context,
      ),
      decideNegotiation(
        request(
          'https://example.test/api/negotiations/negotiation-2/decision',
          { decision: 'accept', mandateId: 'mandate-2' },
        ),
        { params: Promise.resolve({ negotiationId: 'negotiation-2' }) },
      ),
    ]);

    expect(decisions.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(12_000);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(12_000);
  });

  it('rejects terms that exceed either party mandate without reserving budget', async () => {
    mocks.mandates['mandate-2'].spendingLimitMinor = 10_000;
    const response = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.negotiationData.status).toBe('offer_submitted');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(0);
  });

  it('expires stale negotiations and prevents offers from the latest offer author', async () => {
    mocks.negotiationData.expiresAt = new Date(Date.now() - 1_000);
    const expired = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );
    expect(expired.status).toBe(410);
    expect(mocks.negotiationData.status).toBe('expired');
    const eventCount = mocks.negotiationData.eventCount;
    const duplicateExpiry = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );
    expect(duplicateExpiry.status).toBe(409);
    expect(mocks.negotiationData.eventCount).toBe(eventCount);

    mocks.negotiationData.status = 'offer_submitted';
    mocks.negotiationData.expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });
    const selfAccept = await decideNegotiation(
      request(decisionUrl, { decision: 'accept' }),
      context,
    );
    expect(selfAccept.status).toBe(409);
  });

  it('lets only the initiator cancel an open negotiation', async () => {
    const recipientCancel = await decideNegotiation(
      request(decisionUrl, { decision: 'cancel' }),
      context,
    );
    expect(recipientCancel.status).toBe(403);

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });
    const initiatorCancel = await decideNegotiation(
      request(decisionUrl, { decision: 'cancel' }),
      context,
    );
    expect(initiatorCancel.status).toBe(200);
    expect(mocks.negotiationData.status).toBe('cancelled');
  });

  it('allows the recipient to reject with a reason and closes the negotiation', async () => {
    const response = await decideNegotiation(
      request(decisionUrl, { decision: 'reject', reason: 'Scope is outside our current plan.' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.negotiationData).toMatchObject({
      status: 'rejected',
      resolvedByAgentId: 'agent-2',
    });
  });

  it('defers acceptance and budget reservation when a mandate requires owner approval', async () => {
    mocks.mandates['mandate-1'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };

    const response = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    expect(response.status).toBe(202);
    expect(mocks.negotiationData).toMatchObject({
      status: 'pending_owner_approval',
      requiredOwnerApprovalIds: ['owner-1'],
      ownerApprovals: [],
      acceptanceRequestedByAgentId: 'agent-2',
      lockedOfferId: 'offer-1',
    });
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(0);
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/events' }),
      expect.objectContaining({ type: 'negotiation.owner_approval_requested' }),
    );
    const conflictingOffer = await submitOffer(
      request(offerUrl, {
        mandateId: 'mandate-2',
        terms: mocks.negotiationData.currentOffer.terms,
      }),
      context,
    );
    expect(conflictingOffer.status).toBe(409);
    const conflictingDecision = await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );
    expect(conflictingDecision.status).toBe(409);
  });

  it('reserves both mandate budgets only after every required owner approves', async () => {
    mocks.mandates['mandate-1'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    mocks.mandates['mandate-2'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    const firstApproval = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(firstApproval.status).toBe(200);
    expect(mocks.negotiationData.status).toBe('pending_owner_approval');
    expect(mocks.negotiationData.ownerApprovals).toEqual(['owner-1']);
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(0);

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-2' },
    });
    const finalApproval = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(finalApproval.status).toBe(200);
    expect(mocks.negotiationData.status).toBe('accepted');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(12_000);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(12_000);
    expect(mocks.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'negotiations/negotiation-1/events' }),
      expect.objectContaining({ type: 'negotiation.accepted', actorOwnerId: 'owner-2' }),
    );
  });

  it('denies non-owners and duplicate approvals and rejects without reserving funds', async () => {
    mocks.mandates['mandate-1'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    mocks.mandates['mandate-2'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    const unauthorized = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(unauthorized.status).toBe(404);
    expect(mocks.negotiationData.ownerApprovals).toEqual([]);

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });
    const approval = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(approval.status).toBe(200);
    const duplicate = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(duplicate.status).toBe(409);

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-2' },
    });
    const rejection = await decideOwnerApproval(
      request(ownerApprovalUrl, {
        decision: 'reject',
        reason: 'The service scope is not approved.',
      }),
      context,
    );
    expect(rejection.status).toBe(200);
    expect(mocks.negotiationData.status).toBe('rejected');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(0);
  });

  it('rechecks mandate state and expiry before owner approval', async () => {
    mocks.mandates['mandate-1'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'owner-1' },
    });

    mocks.mandates['mandate-2'].status = 'revoked';
    const mandateChanged = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(mandateChanged.status).toBe(409);
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);

    mocks.mandates['mandate-2'].status = 'active';
    mocks.negotiationData.expiresAt = new Date(Date.now() - 1_000);
    const expired = await decideOwnerApproval(
      request(ownerApprovalUrl, { decision: 'approve' }),
      context,
    );
    expect(expired.status).toBe(410);
    expect(mocks.negotiationData.status).toBe('expired');
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(0);
  });

  it('serializes concurrent owner approvals and reserves the negotiation only once', async () => {
    mocks.mandates['mandate-1'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    mocks.mandates['mandate-2'].approvalRequirements = {
      ownerApprovalOperations: ['contract.amend'],
    };
    await decideNegotiation(
      request(decisionUrl, { decision: 'accept', mandateId: 'mandate-2' }),
      context,
    );

    let authenticationIndex = 0;
    mocks.authenticateRequest.mockImplementation(async () => ({
      authenticated: true,
      user: { uid: ['owner-1', 'owner-2'][authenticationIndex++] },
    }));
    let tail = Promise.resolve();
    mocks.firestore.runTransaction.mockImplementation(async (
      callback: (tx: TestTransaction) => Promise<unknown>,
    ) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release();
      }
    });

    const decisions = await Promise.all([
      decideOwnerApproval(request(ownerApprovalUrl, { decision: 'approve' }), context),
      decideOwnerApproval(request(ownerApprovalUrl, { decision: 'approve' }), context),
    ]);

    expect(decisions.map(({ status }) => status)).toEqual([200, 200]);
    expect(mocks.negotiationData.status).toBe('accepted');
    expect(mocks.negotiationData.ownerApprovals).toEqual(['owner-1', 'owner-2']);
    expect(mocks.mandates['mandate-1'].reservedAmountMinor).toBe(12_000);
    expect(mocks.mandates['mandate-2'].reservedAmountMinor).toBe(12_000);
  });
});
