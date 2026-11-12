import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  documents: new Map<string, Record<string, unknown>>(),
  uid: 'agent-a',
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: mocks.authenticateRequest }));

import { POST as generateContract } from '@/app/api/contracts/route';
import { POST as decideContract } from '@/app/api/contracts/[contractId]/approval/route';
import { POST as proposeAmendment } from '@/app/api/contracts/[contractId]/amendments/route';
import { POST as decideAmendment } from '@/app/api/contracts/[contractId]/amendments/[amendmentId]/decision/route';

let generatedId = 0;

function reference(path: string) {
  const segments = path.split('/');
  return {
    id: segments[segments.length - 1],
    path,
    collection: (name: string) => ({
      doc: (id?: string) => reference(`${path}/${name}/${id ?? `generated-${++generatedId}`}`),
    }),
    get: async () => {
      const data = mocks.documents.get(path);
      return {
        exists: data !== undefined,
        data: () => data,
      };
    },
  };
}

function snapshot(path: string) {
  const data = mocks.documents.get(path);
  return {
    exists: data !== undefined,
    data: () => data,
  };
}

const now = new Date();
const mandateExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
const terms = {
  parties: [
    {
      userId: 'owner-a',
      displayName: 'Owner A',
      role: 'client',
      agentId: 'agent-a',
      agentDisplayName: 'Agent A',
      mandateId: 'mandate-a',
      mandateTitle: 'A mandate',
    },
    {
      userId: 'owner-b',
      displayName: 'Owner B',
      role: 'freelancer',
      agentId: 'agent-b',
      agentDisplayName: 'Agent B',
      mandateId: 'mandate-b',
      mandateTitle: 'B mandate',
    },
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
  expiresAt: mandateExpiry.toISOString(),
  terminationConditions: 'No termination procedure is configured.',
};

function seedMandate(agentId: string, ownerId: string, reservedAmountMinor = 10_000) {
  return {
    ownerId,
    authorizedAgentId: agentId,
    title: `${ownerId} mandate`,
    status: 'active',
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    expiresAt: mandateExpiry,
    allowedOperations: ['contract.create', 'contract.amend'],
    spendingLimitMinor: 20_000,
    spentAmountMinor: 0,
    reservedAmountMinor,
    currency: 'USD',
    executionConditions: {
      maximumOperationAmountMinor: 15_000,
      requiredDescriptionTerms: [],
    },
    approvalRequirements: { ownerApprovalOperations: [] },
  };
}

function seedAgent(uid: string) {
  return {
    uid,
    displayName: `Display ${uid}`,
    categories: ['software'],
    supportedCurrencies: ['USD'],
  };
}

function seedAcceptedNegotiation() {
  mocks.documents.set('negotiations/neg-1', {
    initiatorAgentId: 'agent-a',
    recipientAgentId: 'agent-b',
    initiatorMandateId: 'mandate-a',
    recipientMandateId: 'mandate-b',
    status: 'accepted',
    acceptedAt: now,
    currentOfferId: 'offer-1',
    currentOffer: {
      mandateId: 'mandate-a',
      submittedByAgentId: 'agent-a',
      terms: {
        title: terms.service.title,
        category: terms.service.category,
        description: terms.service.description,
        amountMinor: terms.amountMinor,
        currency: terms.currency,
        deliveryDays: terms.service.deliveryDays,
      },
    },
  });
  mocks.documents.set('mandates/mandate-a', seedMandate('agent-a', 'owner-a'));
  mocks.documents.set('mandates/mandate-b', seedMandate('agent-b', 'owner-b'));
  mocks.documents.set('agents/agent-a', seedAgent('agent-a'));
  mocks.documents.set('agents/agent-b', seedAgent('agent-b'));
  mocks.documents.set('users/owner-a', { displayName: 'Owner A', role: 'client' });
  mocks.documents.set('users/owner-b', { displayName: 'Owner B', role: 'freelancer' });
}

function seedContract(status: 'pending_review' | 'active' = 'pending_review') {
  const participantIds = ['owner-a', 'agent-a', 'owner-b', 'agent-b'];
  mocks.documents.set('contracts/neg-1', {
    negotiationId: 'neg-1',
    participantIds,
    requiredApproverIds: participantIds,
    mandateIds: ['mandate-a', 'mandate-b'],
    status,
    currentVersion: 1,
    currentVersionId: 'v1',
    activeAmendmentId: null,
    approvals: status === 'active' ? participantIds : [],
    rejectionReason: null,
    expiresAt: mandateExpiry,
    activatedAt: status === 'active' ? now : null,
    eventCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  mocks.documents.set('contracts/neg-1/versions/v1', {
    contractId: 'neg-1',
    version: 1,
    previousVersionId: null,
    negotiationId: 'neg-1',
    amendmentId: null,
    createdBy: 'agent-a',
    createdAt: now,
    terms,
  });
  seedMandate('agent-a', 'owner-a');
  mocks.documents.set('mandates/mandate-a', seedMandate('agent-a', 'owner-a'));
  mocks.documents.set('mandates/mandate-b', seedMandate('agent-b', 'owner-b'));
  mocks.documents.set('agents/agent-a', seedAgent('agent-a'));
  mocks.documents.set('agents/agent-b', seedAgent('agent-b'));
}

function request(body: unknown) {
  return new Request('https://example.test/api/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function responseData(response: Response) {
  return response.json() as Promise<{ data?: Record<string, unknown>; error?: { code: string } }>;
}

const contractContext = { params: Promise.resolve({ contractId: 'neg-1' }) };

describe('contract and amendment APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.uid = 'agent-a';
    generatedId = 0;
    mocks.authenticateRequest.mockImplementation(async () => ({
      authenticated: true,
      user: { uid: mocks.uid },
    }));
    mocks.firestore.collection.mockImplementation((name: string) => ({
      doc: (id?: string) => reference(`${name}/${id ?? `generated-${++generatedId}`}`),
    }));
    mocks.firestore.runTransaction.mockImplementation(async (callback) => {
      const transaction = {
        get: vi.fn(async (ref: { path: string }) => snapshot(ref.path)),
        create: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
          if (mocks.documents.has(ref.path)) {
            throw new Error('Document already exists.');
          }
          mocks.documents.set(ref.path, data);
        }),
        update: vi.fn((ref: { path: string }, patch: Record<string, unknown>) => {
          const current = mocks.documents.get(ref.path);
          if (!current) {
            throw new Error('Document does not exist.');
          }
          mocks.documents.set(ref.path, { ...current, ...patch });
        }),
      };
      return callback(transaction);
    });
  });

  it('generates one reviewable contract only from an accepted negotiation', async () => {
    seedAcceptedNegotiation();
    const response = await generateContract(request({ negotiationId: 'neg-1' }));
    const payload = await responseData(response);

    expect(response.status).toBe(201);
    expect(payload.data?.status).toBe('pending_review');
    expect(payload.data?.requiredApproverIds).toEqual(['owner-a', 'agent-a', 'owner-b', 'agent-b']);
    const generatedTerms = mocks.documents.get('contracts/neg-1/versions/v1')?.terms as Record<string, unknown>;
    expect(generatedTerms).toMatchObject({ amountMinor: 10_000, currency: 'USD' });
    expect(mocks.documents.get('contracts/neg-1/versions/v1')?.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.documents.get('contracts/neg-1/versions/v1')?.documentMetadata).toMatchObject({
      format: 'mandatepay-contract-json-v1',
      contentType: 'application/json',
    });
    expect(generatedTerms.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Owner A', agentDisplayName: 'Display agent-a' }),
    ]));
    expect(mocks.documents.get('contracts/neg-1/events/generated-1')).toBeDefined();

    const duplicate = await generateContract(request({ negotiationId: 'neg-1' }));
    expect(duplicate.status).toBe(409);
  });

  it('refuses generation from a negotiation that is not accepted', async () => {
    seedAcceptedNegotiation();
    mocks.documents.set('negotiations/neg-1', {
      ...mocks.documents.get('negotiations/neg-1'),
      status: 'offer_submitted',
    });

    const response = await generateContract(request({ negotiationId: 'neg-1' }));
    expect(response.status).toBe(409);
    expect(mocks.documents.has('contracts/neg-1')).toBe(false);
  });

  it('rejects invalid generation payloads and unauthorized contract and amendment reviews', async () => {
    expect((await generateContract(request({ negotiationId: 'invalid/id' }))).status).toBe(400);

    seedContract('active');
    const proposalResponse = await proposeAmendment(request({ amountMinor: 11_000 }), contractContext);
    const proposal = await responseData(proposalResponse);
    const amendmentId = String(proposal.data?.id);
    mocks.uid = 'outsider';

    expect((await decideContract(request({ decision: 'approve' }), contractContext)).status).toBe(404);
    expect((await decideAmendment(
      request({ decision: 'approve' }),
      { params: Promise.resolve({ contractId: 'neg-1', amendmentId }) },
    )).status).toBe(404);
    expect(mocks.documents.get('contracts/neg-1')?.currentVersion).toBe(1);
  });

  it('requires every party to approve and releases reservations when a party rejects', async () => {
    seedContract();
    mocks.uid = 'owner-a';
    const approval = await decideContract(request({ decision: 'approve' }), contractContext);
    expect(approval.status).toBe(200);
    expect(mocks.documents.get('contracts/neg-1')?.status).toBe('pending_review');

    mocks.uid = 'owner-b';
    const rejection = await decideContract(
      request({ decision: 'reject', reason: 'Please clarify the scope.' }),
      contractContext,
    );
    expect(rejection.status).toBe(200);
    expect(mocks.documents.get('contracts/neg-1')?.status).toBe('rejected');
    expect(mocks.documents.get('mandates/mandate-a')?.reservedAmountMinor).toBe(0);
    expect(mocks.documents.get('mandates/mandate-b')?.reservedAmountMinor).toBe(0);
    expect(mocks.documents.get('contracts/neg-1/versions/v1')?.terms).toMatchObject(terms);
  });

  it('rejects approval of an expired pending contract', async () => {
    seedContract();
    mocks.documents.set('contracts/neg-1', {
      ...mocks.documents.get('contracts/neg-1'),
      expiresAt: new Date(now.getTime() - 1_000),
    });

    const response = await decideContract(request({ decision: 'approve' }), contractContext);

    expect(response.status).toBe(409);
    expect(mocks.documents.get('contracts/neg-1')?.status).toBe('pending_review');
    expect(mocks.documents.get('contracts/neg-1')?.approvals).toEqual([]);
  });

  it('rejects review when the current immutable version hash does not match', async () => {
    seedContract();
    mocks.documents.set('contracts/neg-1/versions/v1', {
      ...mocks.documents.get('contracts/neg-1/versions/v1'),
      integrityHash: 'a'.repeat(64),
    });

    const response = await decideContract(request({ decision: 'approve' }), contractContext);

    expect(response.status).toBe(409);
    expect(mocks.documents.get('contracts/neg-1')?.approvals).toEqual([]);
  });

  it('requires fresh mandate capacity before accepting an amendment', async () => {
    seedContract('active');
    mocks.documents.set('mandates/mandate-b', {
      ...mocks.documents.get('mandates/mandate-b'),
      spendingLimitMinor: 11_000,
    });
    const response = await proposeAmendment(
      request({ amountMinor: 12_000 }),
      contractContext,
    );

    expect(response.status).toBe(409);
    expect(mocks.documents.get('contracts/neg-1')?.activeAmendmentId).toBeNull();
    expect([...mocks.documents.keys()].some((path) => path.includes('/amendments/'))).toBe(false);
  });

  it('creates a new immutable version and adjusts both reservations after all amendment approvals', async () => {
    seedContract('active');
    mocks.uid = 'agent-a';
    const proposalResponse = await proposeAmendment(
      request({ amountMinor: 12_000, service: { title: 'Expanded website' } }),
      contractContext,
    );
    const proposal = await responseData(proposalResponse);
    expect(proposalResponse.status).toBe(201);
    const amendmentId = String(proposal.data?.id);

    const approve = async (uid: string) => {
      mocks.uid = uid;
      return decideAmendment(
        request({ decision: 'approve' }),
        { params: Promise.resolve({ contractId: 'neg-1', amendmentId }) },
      );
    };
    expect((await approve('owner-a')).status).toBe(200);
    expect((await approve('owner-b')).status).toBe(200);
    expect((await approve('agent-a')).status).toBe(200);
    expect((await approve('agent-b')).status).toBe(200);

    expect(mocks.documents.get('contracts/neg-1')?.currentVersion).toBe(2);
    expect(mocks.documents.get('contracts/neg-1')?.activeAmendmentId).toBeNull();
    expect(mocks.documents.get('contracts/neg-1/versions/v1')?.terms).toMatchObject(terms);
    expect(mocks.documents.get('contracts/neg-1/versions/v2')?.terms).toMatchObject({
      amountMinor: 12_000,
      service: { title: 'Expanded website' },
    });
    expect(mocks.documents.get('contracts/neg-1/versions/v2')?.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.documents.get('mandates/mandate-a')?.reservedAmountMinor).toBe(12_000);
    expect(mocks.documents.get('mandates/mandate-b')?.reservedAmountMinor).toBe(12_000);
    expect(mocks.documents.get(`contracts/neg-1/amendments/${amendmentId}`)?.status).toBe('accepted');
  });

  it('rejects duplicate amendment approvals and retains the current version', async () => {
    seedContract('active');
    const proposalResponse = await proposeAmendment(
      request({ amountMinor: 11_000 }),
      contractContext,
    );
    const proposal = await responseData(proposalResponse);
    const amendmentId = String(proposal.data?.id);
    const context = { params: Promise.resolve({ contractId: 'neg-1', amendmentId }) };

    mocks.uid = 'owner-a';
    expect((await decideAmendment(request({ decision: 'approve' }), context)).status).toBe(200);
    expect((await decideAmendment(request({ decision: 'approve' }), context)).status).toBe(409);
    expect(mocks.documents.get('contracts/neg-1')?.currentVersion).toBe(1);
  });
});
