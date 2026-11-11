// src/lib/firebase/admin.ts
// Server‑only Firebase Admin SDK initialization.
// This module must never be imported from client‑side code.

import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Guard against duplicate initialization (important in dev hot‑reload).
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    // Optional: specify the project ID if available.
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

export const adminApp: App = getApps()[0];
export const adminAuth = getAuth(adminApp);
export const adminFirestore = getFirestore(adminApp);
