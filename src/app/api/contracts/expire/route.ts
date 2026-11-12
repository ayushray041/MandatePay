import { timingSafeEqual } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { expireContractIfDue } from '@/lib/contracts/lifecycle';

function isAuthorized(request: Request, secret: string): boolean {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return apiError(503, 'SCHEDULER_NOT_CONFIGURED', 'Contract expiry is not configured.');
  }
  if (!isAuthorized(request, secret)) {
    return apiError(401, 'UNAUTHORIZED', 'A valid scheduler credential is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const now = new Date();
  try {
    const candidates = await adminFirestore.collection('contracts')
      .where('status', 'in', ['pending_review', 'active'])
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(100)
      .get();
    let expired = 0;
    for (const candidate of candidates.docs) {
      const result = await expireContractIfDue(
        adminFirestore,
        candidate.ref,
        now,
        'scheduled_expiry',
      );
      if (result.expired) {
        expired += 1;
      }
    }
    return apiSuccess({ scanned: candidates.size, expired, limit: 100 });
  } catch (error: unknown) {
    console.error('Scheduled contract expiry failed.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Contract expiry could not be completed.');
  }
}
