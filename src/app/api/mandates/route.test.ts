import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  profileReference: { get: vi.fn() },
  collection: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: { collection: mocks.collection },
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

import { POST } from '@/app/api/mandates/route';

function request(body: unknown): Request {
  return new Request('https://example.test/api/mandates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mandates role authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'freelancer-1' },
    });
    mocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName !== 'users') {
        throw new Error(`Unexpected collection access: ${collectionName}`);
      }
      return {
        doc: (uid: string) => {
          expect(uid).toBe('freelancer-1');
          return mocks.profileReference;
        },
      };
    });
    mocks.profileReference.get.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'freelancer' }),
    });
  });

  it('rejects a freelancer even when the request body claims a client role', async () => {
    const response = await POST(request({ role: 'client' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'CLIENT_ROLE_REQUIRED' },
    });
    expect(mocks.profileReference.get).toHaveBeenCalledOnce();
  });

  it('requires an existing trusted user profile', async () => {
    mocks.profileReference.get.mockResolvedValueOnce({ exists: false });

    const response = await POST(request({}));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'PROFILE_NOT_FOUND' },
    });
  });
});
