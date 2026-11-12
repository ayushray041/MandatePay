import { timingSafeEqual } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import { isNegotiationTerminal } from '@/lib/negotiations/policy';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { nextNegotiationVersion, writeNegotiationSnapshot } from '@/lib/negotiations/versions';

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
    return apiError(503, 'SCHEDULER_NOT_CONFIGURED', 'Negotiation expiry is not configured.');
  }
  if (!isAuthorized(request, secret)) {
    return apiError(401, 'UNAUTHORIZED', 'A valid scheduler credential is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const now = new Date();
  try {
    const candidates = await adminFirestore.collection('negotiations')
      .where('status', 'in', ['initiated', 'offer_submitted', 'counter_offered', 'pending_owner_approval'])
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(100)
      .get();
    let expired = 0;
    for (const candidate of candidates.docs) {
      const negotiationRef = candidate.ref;
      const changed = await adminFirestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(negotiationRef);
        const negotiation = fresh.data();
        const expiresAt = negotiation ? timestampToIso(negotiation.expiresAt) : null;
        if (
          !fresh.exists
          || !negotiation
          || isNegotiationTerminal(negotiation.status)
          || !expiresAt
          || Date.parse(expiresAt) > now.getTime()
        ) {
          return false;
        }
        const currentEventCount = Number(negotiation.eventCount ?? 0);
        if (
          !Number.isSafeInteger(currentEventCount)
          || currentEventCount < 0
          || currentEventCount >= Number.MAX_SAFE_INTEGER
        ) {
          throw new Error('Negotiation event sequence is invalid.');
        }
        const version = nextNegotiationVersion(negotiation);
        const timestamp = getServerTimestamp();
        transaction.update(negotiationRef, {
          status: 'expired',
          eventCount: currentEventCount + 1,
          version,
          lockedOfferId: null,
          updatedAt: timestamp,
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: currentEventCount + 1,
          type: 'negotiation.expired',
          actorSystemId: 'negotiation-expiry-worker',
          details: { source: 'scheduled_expiry' },
        });
        writeNegotiationSnapshot(transaction, negotiationRef, {
          version,
          status: 'expired',
          currentOfferId: typeof negotiation.currentOfferId === 'string' ? negotiation.currentOfferId : null,
          currentOffer: negotiation.currentOffer ?? null,
          offerCount: Number(negotiation.offerCount ?? 0),
          updatedAt: timestamp,
          actorId: 'system:negotiation-expiry',
        });
        return true;
      });
      if (changed) {
        expired += 1;
      }
    }
    return apiSuccess({ scanned: candidates.size, expired, limit: 100 });
  } catch (error: unknown) {
    console.error('Scheduled negotiation expiry failed.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation expiry could not be completed.');
  }
}
