import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  agentsQuery: { get: vi.fn() },
  collection: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: mocks.collection,
    runTransaction: mocks.runTransaction,
  },
}));
vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

import { GET } from '@/app/api/agents/route';
import { POST as registerAgent } from '@/app/api/agents/me/route';

const validProfile = {
  headline: 'Independent software engineer',
  bio: 'I build reliable backend services for small and growing teams.',
  categories: ['software'],
  capabilities: [{
    category: 'software',
    description: 'API development, integrations, and data workflows.',
  }],
  supportedCurrencies: ['USD'],
  availability: 'available',
};

function request(body: unknown) {
  return new Request('https://example.test/api/agents/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('agent APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'agent-1' },
    });
    mocks.collection.mockImplementation((name: string) => {
      if (name === 'users') {
        return { doc: () => ({}) };
      }
      return {
        doc: (uid: string) => ({ id: uid }),
        where: () => ({
          orderBy: () => ({
            limit: () => mocks.agentsQuery,
          }),
        }),
        orderBy: () => ({
          limit: () => mocks.agentsQuery,
        }),
      };
    });
    mocks.agentsQuery.get.mockResolvedValue({
      docs: [{
        id: 'agent-2',
        data: () => ({ ...validProfile, uid: 'forged-id', createdAt: null, updatedAt: null }),
      }],
    });
  });

  it('discovers profiles but never returns the caller as a counterpart', async () => {
    mocks.agentsQuery.get.mockResolvedValueOnce({
      docs: [
        { id: 'agent-1', data: () => validProfile },
        { id: 'agent-2', data: () => validProfile },
      ],
    });
    const response = await GET(new Request('https://example.test/api/agents?category=software'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ uid: 'agent-2' }],
    });
  });

  it('rejects invalid discovery filters', async () => {
    const response = await GET(new Request('https://example.test/api/agents?category=unknown'));
    expect(response.status).toBe(400);
    expect(mocks.agentsQuery.get).not.toHaveBeenCalled();
  });

  it('binds registration identity to the token and checks the account role', async () => {
    const profileRef = { collection: 'agents', id: 'agent-1' };
    const userRef = { collection: 'users', id: 'agent-1' };
    const transaction = {
      get: vi.fn(async (reference: { collection: string }) => ({
        exists: reference.collection === 'users',
        data: () => ({ role: 'freelancer', displayName: 'Verified Agent' }),
      })),
      create: vi.fn(),
    };
    mocks.collection.mockImplementation((name: string) => ({
      doc: () => name === 'agents' ? profileRef : name === 'users' ? userRef : {
        collection: name,
        id: 'new-agent-identity',
      },
    }));
    mocks.runTransaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    );

    const response = await registerAgent(request(validProfile));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        uid: 'agent-1',
        agentId: expect.stringMatching(/^agt_[A-Za-z0-9_-]{32}$/),
        ownerId: 'agent-1',
        displayName: 'Verified Agent',
        status: 'active',
      },
    });
    expect(transaction.create).toHaveBeenCalledWith(
      profileRef,
      expect.objectContaining({ uid: 'agent-1', displayName: 'Verified Agent' }),
    );
    const createdIdentity = transaction.create.mock.calls.find(([reference]) => (
      (reference as { collection?: string }).collection === 'agentIdentities'
    ));
    expect(createdIdentity?.[1]).toMatchObject({
      ownerId: 'agent-1',
      agentUid: 'agent-1',
    });
  });
});
