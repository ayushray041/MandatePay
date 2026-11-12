import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  runTransaction: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: (collectionName: string) => ({
      doc: (documentId?: string) => ({
        path: `${collectionName}/${documentId ?? `generated-${Math.random()}`}`,
      }),
    }),
    runTransaction: mocks.runTransaction,
  },
}));

import { agentApiKeyHashMatches, generateAgentApiKey, generateAgentId } from '@/lib/agents/credentials';
import { authenticateAgentRequest } from '@/lib/agents/auth';

const ownerId = 'agent-owner';
const agentId = `agt_${'A'.repeat(32)}`;
let currentKey: NonNullable<ReturnType<typeof generateAgentApiKey>>;
let transactionTail: Promise<void>;

function agentRequest(token: string) {
  return new Request('https://mandatepay.test/api/agent/v1/mandates', {
    headers: { authorization: `Bearer ${token}` },
  });
}

function seedCredential({
  status = 'active',
  expiresAt = new Date(Date.now() + 60_000),
  scopes = ['mandates:read', 'mandates:authorize'],
  keyOwnerId = ownerId,
  keyAgentId = agentId,
}: {
  status?: string;
  expiresAt?: Date;
  scopes?: string[];
  keyOwnerId?: string;
  keyAgentId?: string;
} = {}) {
  if (!currentKey) {
    throw new Error('Test credential was not generated.');
  }
  mocks.documents.set(`agentApiKeys/${currentKey.keyId}`, {
    keyId: currentKey.keyId,
    ownerId: keyOwnerId,
    agentId: keyAgentId,
    tokenHash: currentKey.tokenHash,
    status,
    scopes,
    expiresAt,
  });
  mocks.documents.set(`agents/${ownerId}`, {
    ownerId,
    agentId,
    status: 'active',
    rateLimitPerMinute: 60,
    dailyQuota: 100,
  });
}

describe('agent API credential authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    transactionTail = Promise.resolve();
    process.env.AGENT_API_KEY_PEPPER = 'test-pepper-with-at-least-32-characters';
    const generated = generateAgentApiKey();
    if (!generated) {
      throw new Error('Test pepper did not generate a credential.');
    }
    currentKey = generated;
    mocks.runTransaction.mockImplementation(async (callback: (transaction: {
      get: (reference: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      update: (reference: { path: string }, value: Record<string, unknown>) => void;
      set: (reference: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
      create: (reference: { path: string }, value: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      const previous = transactionTail;
      let release = () => {};
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback({
          get: async (reference) => ({
            exists: mocks.documents.has(reference.path),
            data: () => mocks.documents.get(reference.path),
          }),
          update: (reference, value) => {
            const current = mocks.documents.get(reference.path);
            if (!current) {
              throw new Error(`Missing document ${reference.path}`);
            }
            mocks.documents.set(reference.path, { ...current, ...value });
          },
          set: (reference, value, options) => {
            const current = mocks.documents.get(reference.path);
            mocks.documents.set(reference.path, options?.merge ? { ...current, ...value } : value);
          },
          create: (reference, value) => {
            if (mocks.documents.has(reference.path)) {
              throw new Error(`Existing document ${reference.path}`);
            }
            mocks.documents.set(reference.path, value);
          },
        });
      } finally {
        release();
      }
    });
  });

  it('creates high-entropy credentials with a keyed hash rather than a stored secret', () => {
    expect(currentKey.token).toMatch(/^mpa_live_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
    expect(currentKey.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(currentKey.tokenHash).not.toContain(currentKey.token);
    expect(agentApiKeyHashMatches(currentKey.tokenHash, currentKey.tokenHash)).toBe(true);
    expect(agentApiKeyHashMatches(currentKey.tokenHash, '0'.repeat(64))).toBe(false);
  });

  it('creates a unique immutable agent identifier and fails closed without a pepper', async () => {
    const firstId = generateAgentId();
    const secondId = generateAgentId();
    expect(firstId).toMatch(/^agt_[A-Za-z0-9_-]{32}$/);
    expect(secondId).not.toBe(firstId);

    delete process.env.AGENT_API_KEY_PEPPER;
    expect(generateAgentApiKey()).toBeNull();
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.status).toBe(503);
  });

  it('rejects malformed, unknown, and tampered API keys', async () => {
    const malformed = await authenticateAgentRequest(agentRequest('not-an-api-key'), 'mandates:read');
    expect(malformed.authenticated).toBe(false);
    if (!malformed.authenticated) expect(malformed.response.status).toBe(401);

    seedCredential();
    const tampered = `${currentKey.token.slice(0, -1)}${currentKey.token.endsWith('A') ? 'B' : 'A'}`;
    const invalid = await authenticateAgentRequest(agentRequest(tampered), 'mandates:read');
    expect(invalid.authenticated).toBe(false);
    if (!invalid.authenticated) expect(invalid.response.status).toBe(401);
    expect(agentApiKeyHashMatches(currentKey.tokenHash, 'not-a-hash')).toBe(false);
  });

  it.each([
    ['expired', 'active', new Date(Date.now() - 1)],
    ['revoked', 'revoked', new Date(Date.now() + 60_000)],
  ])('rejects %s credentials', async (_label, status, expiresAt) => {
    seedCredential({ status, expiresAt });
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.status).toBe(401);
  });

  it('rejects keys whose owner or immutable agent ID does not match the stored agent', async () => {
    seedCredential({ keyAgentId: `agt_${'B'.repeat(32)}` });
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.status).toBe(401);

    seedCredential({ keyOwnerId: 'another-owner' });
    const ownerMismatch = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(ownerMismatch.authenticated).toBe(false);
    if (!ownerMismatch.authenticated) expect(ownerMismatch.response.status).toBe(401);
  });

  it('disables every credential when its agent is suspended', async () => {
    seedCredential();
    mocks.documents.set(`agents/${ownerId}`, {
      ownerId,
      agentId,
      status: 'suspended',
      rateLimitPerMinute: 60,
      dailyQuota: 100,
    });
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.status).toBe(401);
  });

  it('rejects insufficient scopes without consuming the request quota', async () => {
    seedCredential({ scopes: ['mandates:read'] });
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:authorize');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) expect(result.response.status).toBe(403);
    expect(mocks.documents.get(`agentUsage/${agentId}`)?.minuteCount).toBeUndefined();
    expect([...mocks.documents.values()]).toContainEqual(
      expect.objectContaining({ action: 'agent.api_request', outcome: 'denied' }),
    );
  });

  it('enforces atomic per-agent rate and daily quotas', async () => {
    seedCredential();
    const minuteWindow = Math.floor(Date.now() / 60_000);
    mocks.documents.set(`agentUsage/${agentId}`, {
      minuteWindow,
      minuteCount: 60,
      dayWindow: new Date().toISOString().slice(0, 10),
      dailyCount: 0,
    });

    const rateLimited = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(rateLimited.authenticated).toBe(false);
    if (!rateLimited.authenticated) {
      expect(rateLimited.response.status).toBe(429);
      expect(rateLimited.response.headers.get('Retry-After')).toBeTruthy();
    }

    mocks.documents.set(`agents/${ownerId}`, {
      ownerId,
      agentId,
      status: 'active',
      rateLimitPerMinute: 60,
      dailyQuota: 100,
    });
    mocks.documents.set(`agentUsage/${agentId}`, {
      minuteWindow,
      minuteCount: 0,
      dayWindow: new Date().toISOString().slice(0, 10),
      dailyCount: 100,
    });
    const quotaExceeded = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(quotaExceeded.authenticated).toBe(false);
    if (!quotaExceeded.authenticated) expect(quotaExceeded.response.status).toBe(429);
  });

  it('does not allow concurrent requests to exceed the per-agent rate limit', async () => {
    seedCredential();
    mocks.documents.set(`agents/${ownerId}`, {
      ownerId,
      agentId,
      status: 'active',
      rateLimitPerMinute: 1,
      dailyQuota: 100,
    });
    const results = await Promise.all([
      authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read'),
      authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read'),
    ]);
    expect(results.filter((result) => result.authenticated)).toHaveLength(1);
    expect(results.filter((result) => !result.authenticated)).toHaveLength(1);
    expect(mocks.documents.get(`agentUsage/${agentId}`)?.minuteCount).toBe(1);
  });

  it('authenticates, records an agent session, and stores no raw API key', async () => {
    seedCredential();
    const result = await authenticateAgentRequest(agentRequest(currentKey.token), 'mandates:read');
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.agent).toMatchObject({ uid: ownerId, ownerId, agentId, keyId: currentKey.keyId });
    }
    expect(mocks.documents.get(`agentApiKeys/${currentKey.keyId}`)?.tokenHash).toBe(currentKey.tokenHash);
    expect(JSON.stringify([...mocks.documents.values()])).not.toContain(currentKey.token);
    expect(mocks.documents.has(`agentSessions/${currentKey.keyId}`)).toBe(true);
  });
});
