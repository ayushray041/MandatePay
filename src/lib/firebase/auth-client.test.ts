import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
  getFirebaseAuth: vi.fn(),
  setPersistence: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
  onAuthStateChanged: vi.fn(),
  localPersistence: { name: 'local' },
}));

vi.mock('@/lib/firebase/client', () => ({
  getFirebaseAuth: mocks.getFirebaseAuth,
}));

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: mocks.localPersistence,
  createUserWithEmailAndPassword: mocks.createUserWithEmailAndPassword,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
  setPersistence: mocks.setPersistence,
  updateProfile: mocks.updateProfile,
  onAuthStateChanged: mocks.onAuthStateChanged,
}));

import {
  getIdToken,
  login,
  logout,
  onAuthStateChanged,
  register,
} from '@/lib/firebase/auth-client';

describe('Firebase browser authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebaseAuth.mockReturnValue(mocks.auth);
    mocks.setPersistence.mockResolvedValue(undefined);
  });

  it('uses local persistence before email/password signup and sets the display name', async () => {
    const user = { uid: 'user-1', displayName: null };
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user });

    await expect(register('person@example.com', 'password123', 'Person')).resolves.toBe(user);

    expect(mocks.setPersistence).toHaveBeenCalledWith(
      mocks.auth,
      mocks.localPersistence,
    );
    expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      mocks.auth,
      'person@example.com',
      'password123',
    );
    expect(mocks.updateProfile).toHaveBeenCalledWith(user, {
      displayName: 'Person',
    });
  });

  it('signs in, signs out, and subscribes using the configured Firebase auth instance', async () => {
    const user = { uid: 'user-2', getIdToken: vi.fn().mockResolvedValue('id-token') };
    const unsubscribe = vi.fn();
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.auth.currentUser = user;
    mocks.onAuthStateChanged.mockReturnValue(unsubscribe);

    await expect(login('person@example.com', 'password123')).resolves.toBe(user);
    await expect(getIdToken()).resolves.toBe('id-token');
    await logout();
    expect(onAuthStateChanged(vi.fn())).toBe(unsubscribe);
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      mocks.auth,
      'person@example.com',
      'password123',
    );
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth);
    expect(mocks.onAuthStateChanged).toHaveBeenCalledWith(
      mocks.auth,
      expect.any(Function),
    );
  });
});
