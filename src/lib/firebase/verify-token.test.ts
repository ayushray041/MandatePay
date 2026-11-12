import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: mocks.verifyIdToken },
}));

import { verifyIdToken } from '@/lib/firebase/verify-token';

describe('Firebase ID token verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing and malformed bearer credentials without calling Firebase', async () => {
    await expect(verifyIdToken(null)).resolves.toEqual({
      success: false,
      reason: 'missing',
    });
    await expect(verifyIdToken('Basic credentials')).resolves.toEqual({
      success: false,
      reason: 'malformed',
    });
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('checks token revocation and returns only verified identity claims', async () => {
    mocks.verifyIdToken.mockResolvedValue({
      uid: 'verified-user',
      email: 'person@example.com',
      role: 'admin',
    });

    await expect(verifyIdToken('Bearer valid-token')).resolves.toEqual({
      success: true,
      uid: 'verified-user',
      email: 'person@example.com',
    });
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  it('rejects expired, revoked, or otherwise invalid tokens', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('token expired'));

    await expect(verifyIdToken('Bearer expired-token')).resolves.toEqual({
      success: false,
      reason: 'invalid',
    });
  });
});
