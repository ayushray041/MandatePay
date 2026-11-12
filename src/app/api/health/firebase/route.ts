// src/app/api/health/firebase/route.ts
import { adminApp, adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';

export async function GET() {
  if (!adminApp || !adminFirestore) {
    return apiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Firebase Admin services are not configured.',
    );
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  const actualProjectId = adminApp.options.projectId || process.env.GCLOUD_PROJECT;
  const projectMatch = Boolean(expectedProjectId && actualProjectId && expectedProjectId === actualProjectId);

  try {
    await adminFirestore.collection('users').limit(1).get();
  } catch (error: unknown) {
    console.error('Firebase health check could not access Firestore.', error);
    return apiError(
      503,
      'FIRESTORE_UNAVAILABLE',
      'Firestore is not accessible.',
      { firebase: projectMatch ? 'connected' : 'project_mismatch', firestore: 'unavailable' },
    );
  }

  if (!projectMatch) {
    return apiError(
      503,
      'FIREBASE_PROJECT_MISMATCH',
      'Firebase project configuration does not match.',
      { firebase: 'project_mismatch', firestore: 'accessible' },
    );
  }

  return apiSuccess({ success: true, firebase: 'connected', firestore: 'accessible' });
}
