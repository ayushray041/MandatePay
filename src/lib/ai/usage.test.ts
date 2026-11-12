import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  counts: new Map<string, { day: string; requestCount: number }>(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: {
    collection: mocks.collection,
    runTransaction: mocks.runTransaction,
  },
}));

import { consumeAiRequestQuota } from '@/lib/ai/usage';

describe('AI request quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.counts.clear();
    mocks.collection.mockImplementation((name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }));
    mocks.runTransaction.mockImplementation(async (
      callback: (transaction: {
        get: (reference: { path: string }) => Promise<{
          exists: boolean;
          data: () => { day: string; requestCount: number } | undefined;
        }>;
        set: (reference: { path: string }, value: { day: string; requestCount: number }) => void;
      }) => Promise<void>,
    ) => callback({
      get: async (reference) => ({
        exists: mocks.counts.has(reference.path),
        data: () => mocks.counts.get(reference.path),
      }),
      set: (reference, value) => {
        mocks.counts.set(reference.path, value);
      },
    }));
  });

  it('enforces an atomic per-user daily request limit and resets on the next UTC day', async () => {
    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '2');
    const firstDay = new Date('2026-11-12T23:59:00.000Z');

    await consumeAiRequestQuota('owner-a', firstDay);
    await consumeAiRequestQuota('owner-a', firstDay);
    await expect(consumeAiRequestQuota('owner-a', firstDay)).rejects.toMatchObject({
      code: 'AI_DAILY_LIMIT_REACHED',
    });
    await expect(consumeAiRequestQuota('owner-a', new Date('2026-11-13T00:01:00.000Z')))
      .resolves.toBeUndefined();
  });

  it('fails closed for invalid quota configuration', async () => {
    vi.stubEnv('AI_DAILY_REQUEST_LIMIT', '0');

    await expect(consumeAiRequestQuota('owner-a', new Date()))
      .rejects.toMatchObject({ code: 'AI_LIMIT_MISCONFIGURED' });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });
});
