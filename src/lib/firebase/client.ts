import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

// Lazy, guarded initialization of Firebase client SDK.
// Returns undefined if required env vars are missing – avoids runtime errors in production builds where the vars may be injected later.
export function getFirebaseApp(): FirebaseApp | undefined {
  if (getApps().length) {
    // Assume the first app is the one we need.
    return getApps()[0];
  }

  const {
    NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID,
  } = process.env;

  if (!NEXT_PUBLIC_FIREBASE_API_KEY || !NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    // Env vars not present – do not initialize.
    // This warning is safe for production; it will be removed once env vars are provided.
    console.warn('Firebase client environment variables missing – client SDK not initialized.');
    return undefined;
  }

  return initializeApp({
    apiKey: NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

// Export ready‑to‑use instances (or undefined if initialization failed).
export const firebaseApp = getFirebaseApp();
export const auth: Auth | undefined = firebaseApp ? getAuth(firebaseApp) : undefined;
export const firestore: Firestore | undefined = firebaseApp ? getFirestore(firebaseApp) : undefined;
