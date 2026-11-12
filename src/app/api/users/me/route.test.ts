import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getDocumentReference: vi.fn(),
  getServerTimestamp: vi.fn(),
  adminFirestore: {},
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminFirestore: mocks.adminFirestore,
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

vi.mock('@/lib/firebase/firestore', () => ({
  getDocumentReference: mocks.getDocumentReference,
  getServerTimestamp: mocks.getServerTimestamp,
}));

import { GET, PATCH, POST } from '@/app/api/users/me/route';

const profile = {
  uid: 'alice',
  email: 'alice@example.com',
  displayName: 'Alice',
  role: 'client',
  createdAt: 'created',
  updatedAt: 'updated',
};

const userDocument = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

describe('/api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userDocument.get.mockReset();
    userDocument.create.mockReset();
    userDocument.update.mockReset();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'alice', email: 'alice@example.com' },
    });
    mocks.getDocumentReference.mockReturnValue(userDocument);
    mocks.getServerTimestamp.mockReturnValue('server-timestamp');
    userDocument.get.mockResolvedValue({
      exists: true,
      data: () => profile,
    });
    userDocument.create.mockResolvedValue(undefined);
    userDocument.update.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated requests before accessing Firestore', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: false,
      response: Response.json(
        { error: { code: 'UNAUTHENTICATED', message: 'A valid token is required.' } },
        { status: 401 },
      ),
    });

    const response = await GET(new Request('https://example.test/api/users/me'));

    expect(response.status).toBe(401);
    expect(mocks.getDocumentReference).not.toHaveBeenCalled();
  });

  it('uses only verified UID for profile reads, ignoring caller-supplied identity', async () => {
    const response = await GET(
      new Request('https://example.test/api/users/me?uid=bob'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: profile });
    expect(mocks.getDocumentReference).toHaveBeenCalledWith('users', 'alice');
  });

  it('rejects invalid payloads and self-assigned privileged roles', async () => {
    const response = await POST(
      new Request('https://example.test/api/users/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Alice',
          role: 'admin',
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(mocks.getDocumentReference).not.toHaveBeenCalled();
  });

  it('creates profiles with token identity and only a non-privileged role', async () => {
    userDocument.get
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ...profile, role: 'freelancer' }) });

    const response = await POST(
      new Request('https://example.test/api/users/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Alice', role: 'freelancer' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(userDocument.create).toHaveBeenCalledWith({
      uid: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'freelancer',
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    });
  });

  it('permits only displayName updates on the verified user profile', async () => {
    const response = await PATCH(
      new Request('https://example.test/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Alice New', uid: 'bob' }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getDocumentReference).not.toHaveBeenCalled();
    expect(userDocument.update).not.toHaveBeenCalled();
  });

  it('updates the caller profile using the verified UID and server timestamp', async () => {
    userDocument.get
      .mockResolvedValueOnce({ exists: true, data: () => profile })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ ...profile, displayName: 'Alice New' }),
      });

    const response = await PATCH(
      new Request('https://example.test/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Alice New' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getDocumentReference).toHaveBeenCalledWith('users', 'alice');
    expect(userDocument.update).toHaveBeenCalledWith({
      displayName: 'Alice New',
      updatedAt: 'server-timestamp',
    });
  });
});
