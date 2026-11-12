import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  documents: new Map<string, Record<string, unknown>>(),
  runTransaction: vi.fn(),
  sequence: 0,
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: (collectionName: string) => {
      const makeRef = (id?: string) => ({
        id: id ?? `generated-${++mocks.sequence}`,
        path: `${collectionName}/${id ?? `generated-${mocks.sequence}`}`,
      });
      return {
        doc: makeRef,
        where: (field: string, _operator: string, value: unknown) => ({
          orderBy: () => ({
            limit: () => ({
              get: async () => ({
                docs: [...mocks.documents.entries()]
                  .filter(([path, data]) => (
                    path.startsWith(`${collectionName}/`)
                    && data[field] === value
                  ))
                  .map(([path, data]) => ({
                    id: path.slice(collectionName.length + 1),
                    data: () => data,
                  })),
              }),
            }),
          }),
        }),
      };
    },
    runTransaction: mocks.runTransaction,
  },
}));

import { GET, POST } from '@/app/api/agents/me/keys/route';
import { POST as rotateKey } from '@/app/api/agents/me/keys/[keyId]/rotate/route';
import { DELETE as revokeKey } from '@/app/api/agents/me/keys/[keyId]/route';

const ownerId = 'owner-account';
const agentId = `agt_${'A'.repeat(32)}`;

describe('agent API key management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.sequence = 0;
    process.env.AGENT_API_KEY_PEPPER = 'test-pepper-with-at-least-32-characters';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: ownerId },
    });
    mocks.documents.set(`agents/${ownerId}`, {
      uid: ownerId,
      ownerId,
      agentId,
      displayName: 'Agent Owner',
      headline: 'Independent software engineer',
      bio: 'I build reliable backend services for small and growing teams.',
      categories: ['software'],
      capabilities: [{
        category: 'software',
        description: 'API development, integrations, and data workflows.',
      }],
      supportedCurrencies: ['USD'],
      availability: 'available',
      status: 'active',
      healthStatus: 'unknown',
      version: 1,
      runtimeVersion: null,
      rateLimitPerMinute: 60,
      dailyQuota: 10_000,
      lastSeenAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.runTransaction.mockImplementation(async (callback: (transaction: {
      get: (reference: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      update: (reference: { path: string }, value: Record<string, unknown>) => void;
      set: (reference: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
      create: (reference: { path: string }, value: Record<string, unknown>) => void;
    }) => Promise<unknown>) => callback({
      get: async (reference) => ({
        exists: mocks.documents.has(reference.path),
        data: () => mocks.documents.get(reference.path),
      }),
      update: (reference, value) => {
        const current = mocks.documents.get(reference.path);
        if (!current) throw new Error(`Missing document ${reference.path}`);
        mocks.documents.set(reference.path, { ...current, ...value });
      },
      set: (reference, value, options) => {
        const current = mocks.documents.get(reference.path);
        mocks.documents.set(reference.path, options?.merge ? { ...current, ...value } : value);
      },
      create: (reference, value) => {
        if (mocks.documents.has(reference.path)) throw new Error(`Existing document ${reference.path}`);
        mocks.documents.set(reference.path, value);
      },
    }));
  });

  it('returns a new secret once, stores only its hash, and never lists the hash', async () => {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const createResponse = await POST(new Request('https://mandatepay.test/api/agents/me/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Production agent',
        scopes: ['mandates:read'],
        expiresAt,
      }),
    }));
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.data.secret).toMatch(/^mpa_live_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
    expect(created.data.warning).toContain('cannot be retrieved again');
    const credential = mocks.documents.get(`agentApiKeys/${created.data.key.keyId}`);
    expect(credential).toBeDefined();
    expect(credential?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(credential)).not.toContain(created.data.secret);

    const listResponse = await GET(new Request('https://mandatepay.test/api/agents/me/keys'));
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json();
    expect(listed.data[0].tokenHash).toBeUndefined();
    expect(listed.data[0].secret).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain(created.data.secret);
  });

  it('rotates credentials and immediately revokes the previous key', async () => {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const createResponse = await POST(new Request('https://mandatepay.test/api/agents/me/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rotation test',
        scopes: ['mandates:authorize'],
        expiresAt,
      }),
    }));
    const created = await createResponse.json();
    const oldKeyId = created.data.key.keyId;

    const rotationResponse = await rotateKey(
      new Request(`https://mandatepay.test/api/agents/me/keys/${oldKeyId}/rotate`, { method: 'POST' }),
      { params: Promise.resolve({ keyId: oldKeyId }) },
    );
    expect(rotationResponse.status).toBe(201);
    const rotated = await rotationResponse.json();
    expect(rotated.data.key.scopes).toEqual(['mandates:authorize']);
    expect(rotated.data.secret).not.toBe(created.data.secret);
    expect(mocks.documents.get(`agentApiKeys/${oldKeyId}`)?.status).toBe('revoked');
    expect(mocks.documents.get(`agentApiKeys/${rotated.data.key.keyId}`)?.tokenHash)
      .toMatch(/^[a-f0-9]{64}$/);

    const revokeResponse = await revokeKey(
      new Request(`https://mandatepay.test/api/agents/me/keys/${rotated.data.key.keyId}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ keyId: rotated.data.key.keyId }) },
    );
    expect(revokeResponse.status).toBe(200);
    expect(mocks.documents.get(`agentApiKeys/${rotated.data.key.keyId}`)?.status).toBe('revoked');
  });
});
