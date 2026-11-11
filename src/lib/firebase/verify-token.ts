import { adminAuth } from '@/lib/firebase/admin';

export async function verifyIdToken(authHeader: string | null): Promise<{ success: boolean; uid?: string; email?: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing or malformed Authorization header' };
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { success: true, uid: decoded.uid, email: decoded.email };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Invalid token' };
  }
}
