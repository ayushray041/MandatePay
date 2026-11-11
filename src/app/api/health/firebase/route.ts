// src/app/api/health/firebase/route.ts
import { NextResponse } from 'next/server';
import { adminApp, adminFirestore } from '@/lib/firebase/admin';

export async function GET() {
  // Verify admin SDK initialized
  if (!adminApp) {
    return NextResponse.json({ success: false, error: 'Admin SDK not initialized' }, { status: 500 });
  }

  // Verify project ID consistency
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  const actualProjectId = adminApp?.options?.projectId || process.env.GCLOUD_PROJECT;
  const projectMatch = expectedProjectId && actualProjectId && expectedProjectId === actualProjectId;

  // Simple Firestore connectivity test: attempt to read a tiny slice of a known collection.
  let firestoreAccessible = false;
  try {
    // Using a generic collection; it may be empty, but the call will succeed if Firestore is reachable.
    await adminFirestore.collection('users').limit(1).get();
    firestoreAccessible = true;
  } catch (e) {
    firestoreAccessible = false;
  }

  const success = projectMatch && firestoreAccessible;
  return NextResponse.json({
    success,
    firebase: projectMatch ? 'connected' : 'project_mismatch',
    firestore: firestoreAccessible ? 'accessible' : 'unavailable',
    projectId: actualProjectId,
  });
}
