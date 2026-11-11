import { adminAuth } from '@/lib/firebase/admin';

export async function verifyIdToken(
  authHeader: string | null,
): Promise<{ success: boolean; uid?: string; email?: string; error?: string }> {
  if (!authHeader) {
    return { success: false, error: 'Missing Authorization header' };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Malformed Authorization header' };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { success: false, error: 'Missing bearer token' };
  }

  if (!adminAuth) {
    return { success: false, error: 'Firebase Admin SDK is not configured' };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      success: true,
      uid: decoded.uid,
      email: decoded.email ?? undefined,
    };
  } catch {
    return { success: false, error: 'Invalid or expired Firebase token' };
  }
}
