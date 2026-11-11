// Server‑only Firebase Admin SDK initialization.
// This module must never be imported from client‑side code.

import { initializeApp, getApps, getApp, applicationDefault } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function getAdminApp() {
  try {
    if (getApps().length > 0) {
      return getApp();
    }

    return initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
    });
  } catch (error) {
    console.warn('Firebase Admin SDK could not initialize. Check Firebase credentials and environment variables.', error);
    return undefined;
  }
}

export const adminApp = getAdminApp();
export const adminAuth: Auth | null = adminApp ? getAuth(adminApp) : null;
export const adminFirestore: Firestore | null = adminApp ? getFirestore(adminApp) : null;
