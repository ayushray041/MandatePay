// src/app/api/health/firebase/route.ts
import { NextResponse } from 'next/server';
import { adminApp, adminFirestore } from '@/lib/firebase/admin';

export async function GET() {
  if (!adminApp || !adminFirestore) {
    return NextResponse.json({ success: false, error: 'Admin SDK not initialized' }, { status: 500 });
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  const actualProjectId = adminApp.options.projectId || process.env.GCLOUD_PROJECT;
  const projectMatch = Boolean(expectedProjectId && actualProjectId && expectedProjectId === actualProjectId);

  let firestoreAccessible = false;
  try {
    await adminFirestore.collection('users').limit(1).get();
    firestoreAccessible = true;
  } catch {
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
