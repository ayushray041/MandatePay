import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  documents: new Map<string, Record<string, unknown>>(),
  generateStructured: vi.fn(),
  uid: 'user-a',
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock('@/lib/ai/gemini', () => ({
  createAiProvider: () => ({ generateStructured: mocks.generateStructured }),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        return {
          get: async () => {
            const data = mocks.documents.get(path);
            return { exists: data !== undefined, id, data: () => data };
          },
          collection: (subcollection: string) => ({
            doc: (nestedId: string) => ({
              get: async () => {
                const data = mocks.documents.get(`${path}/${subcollection}/${nestedId}`);
                return { exists: data !== undefined, id: nestedId, data: () => data };
              },
            }),
            orderBy: () => ({
              limitToLast: () => ({
                get: async () => ({ docs: [] }),
              }),
            }),
          }),
        };
      },
    }),
  },
}));

import { POST as negotiationIntelligence } from '@/app/api/negotiations/[negotiationId]/intelligence/route';
import { POST as contractAnalysis } from '@/app/api/contracts/[contractId]/analysis/route';

const negotiationContext = { params: Promise.resolve({ negotiationId: 'neg-1' }) };
const contractContext = { params: Promise.resolve({ contractId: 'contract-1' }) };

const contractTerms = {
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
    title: 'Reporting service',
    category: 'consulting',
    description: 'Deliver monthly reporting to the client.',
    deliveryDays: 14,
  },
  amountMinor: 45_000,
  currency: 'USD',
  paymentConditions: 'Payment is due after monthly delivery.',
  deliveryConditions: 'Reports are delivered by the end of each month.',
  expiresAt: '2027-01-01T00:00:00.000Z',
  terminationConditions: 'Either party may terminate with written notice.',
};

function request(path: string, body?: unknown) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
}

describe('AI API boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.uid = 'user-a';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    mocks.generateStructured.mockResolvedValue({
      summary: 'The payment timing may need more detail.',
      clauses: [{
        field: 'paymentConditions',
        excerpt: 'Payment is due after monthly delivery.',
        concern: 'The term does not specify a payment deadline.',
        question: 'How many days after delivery is payment due?',
        severity: 'medium',
      }],
    });
  });

  it('rejects unauthenticated requests before accessing AI data', async () => {
    const response = new Response(JSON.stringify({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in.' },
    }), { status: 401 });
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: false,
      response,
    });

    await expect(negotiationIntelligence(
      request('/api/negotiations/neg-1/intelligence', { action: 'recommend' }),
      negotiationContext,
    )).resolves.toBe(response);
    await expect(contractAnalysis(
      request('/api/contracts/contract-1/analysis'),
      contractContext,
    )).resolves.toBe(response);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('rejects malformed intelligence payloads', async () => {
    const response = await negotiationIntelligence(
      request('/api/negotiations/neg-1/intelligence', { action: 'recommend', uid: 'forged' }),
      negotiationContext,
    );
    expect(response.status).toBe(400);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('hides negotiation details from nonparticipants', async () => {
    mocks.documents.set('negotiations/neg-1', {
      initiatorAgentId: 'agent-a',
      recipientAgentId: 'agent-b',
      initiatorMandateId: 'mandate-a',
      recipientMandateId: null,
      status: 'initiated',
      expiresAt: new Date(Date.now() + 60_000),
      offerCount: 0,
      eventCount: 1,
    });
    mocks.uid = 'unrelated-user';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    const response = await negotiationIntelligence(
      request('/api/negotiations/neg-1/intelligence', { action: 'recommend' }),
      negotiationContext,
    );
    expect(response.status).toBe(404);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('requires contract participation before reading a version or invoking the model', async () => {
    mocks.documents.set('contracts/contract-1', {
      participantIds: ['owner-a', 'owner-b', 'agent-a', 'agent-b'],
    });
    mocks.uid = 'stranger';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    const response = await contractAnalysis(
      request('/api/contracts/contract-1/analysis'),
      contractContext,
    );
    expect(response.status).toBe(404);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('analyzes only the authorized current contract version', async () => {
    mocks.uid = 'agent-a';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    mocks.documents.set('contracts/contract-1', {
      negotiationId: 'neg-1',
      participantIds: ['owner-a', 'owner-b', 'agent-a', 'agent-b'],
      requiredApproverIds: ['owner-a', 'owner-b', 'agent-a', 'agent-b'],
      mandateIds: ['mandate-a', 'mandate-b'],
      status: 'active',
      currentVersion: 1,
      currentVersionId: 'v1',
      activeAmendmentId: null,
      approvals: ['owner-a', 'owner-b', 'agent-a', 'agent-b'],
      rejectionReason: null,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      activatedAt: new Date('2026-01-01T00:00:00Z'),
      eventCount: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mocks.documents.set('contracts/contract-1/versions/v1', {
      contractId: 'contract-1',
      version: 1,
      previousVersionId: null,
      negotiationId: 'neg-1',
      amendmentId: null,
      createdBy: 'agent-a',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      terms: contractTerms,
    });
    const response = await contractAnalysis(
      request('/api/contracts/contract-1/analysis'),
      contractContext,
    );
    expect(mocks.generateStructured).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        action: 'analyze',
        source: 'gemini',
        analysis: { clauses: [{ field: 'paymentConditions' }] },
      },
    });
  });
});
