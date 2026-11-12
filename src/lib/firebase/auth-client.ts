// src/lib/firebase/auth-client.ts
import { getFirebaseAuth } from '@/lib/firebase/client';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  signOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';

let persistenceSetup: Promise<void> | undefined;

/** Keep the signed-in user across browser restarts. */
export function initializeAuthPersistence(): Promise<void> {
  persistenceSetup ??= setPersistence(getFirebaseAuth(), browserLocalPersistence);
  return persistenceSetup;
}

/** Register a new user with email/password and set display name. */
export async function register(email: string, password: string, fullName: string): Promise<User> {
  const auth = getFirebaseAuth();
  await initializeAuthPersistence();
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  if (fullName) {
    await updateProfile(cred.user, { displayName: fullName });
  }

  return cred.user;
}

/** Log in an existing user. */
export async function login(email: string, password: string): Promise<User> {
  const auth = getFirebaseAuth();
  await initializeAuthPersistence();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Log out the current user. */
export async function logout(): Promise<void> {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/** Get the currently signed-in user (or null). */
export function getCurrentUser(): User | null {
  const auth = getFirebaseAuth();
  return auth.currentUser;
}

/** Subscribe to auth-state changes. */
export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  return firebaseOnAuthStateChanged(auth, callback);
}

/** Retrieve the Firebase ID token of the current user. */
export async function getCurrentUserToken(forceRefresh = false): Promise<string | null> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    return null;
  }

  return user.getIdToken(forceRefresh);
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  return getCurrentUserToken(forceRefresh);
}
