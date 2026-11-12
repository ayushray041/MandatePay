import { adminAuth } from '@/lib/firebase/admin';

export type IdTokenVerification =
  | { success: true; uid: string; email?: string }
  | { success: false; reason: 'missing' | 'malformed' | 'invalid' | 'unavailable' };

export async function verifyIdToken(
  authHeader: string | null,
): Promise<IdTokenVerification> {
  if (!authHeader) {
    return { success: false, reason: 'missing' };
  }

  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!bearerMatch) {
    return { success: false, reason: 'malformed' };
  }

  if (!adminAuth) {
    return { success: false, reason: 'unavailable' };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(bearerMatch[1], true);
    return {
      success: true,
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch {
    return { success: false, reason: 'invalid' };
  }
}
