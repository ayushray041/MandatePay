import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { nextNegotiationVersion, writeNegotiationSnapshot } from '@/lib/negotiations/versions';
import { negotiationDisputeSchema } from '@/models/negotiation';
import { z } from 'zod';

const requestSchema = z.object({
  category: z.enum(['delivery', 'quality', 'payment', 'scope', 'other']),
  reason: z.string().trim().min(10).max(2000),
}).strict();

type RouteContext = { params: Promise<{ negotiationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Dispute escalation details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const { negotiationId } = await context.params;
  const firestore = adminFirestore;
  const negotiationRef = firestore.collection('negotiations').doc(negotiationId);
  const disputeRef = negotiationRef.collection('disputes').doc('current');
  const uid = authentication.user.uid;
  try {
    const dispute = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(negotiationRef);
      if (!snapshot.exists) {
        throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      const negotiation = snapshot.data();
      if (!negotiation) {
        throw new Error('Negotiation document has no data.');
      }
      if (![negotiation.initiatorAgentId, negotiation.recipientAgentId].includes(uid)) {
        throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      if (negotiation.status !== 'accepted') {
        throw new NegotiationError(409, 'NEGOTIATION_NOT_ACCEPTED', 'Only accepted negotiations can be escalated.');
      }
      const existing = await transaction.get(disputeRef);
      if (existing.exists) {
        throw new NegotiationError(409, 'DISPUTE_ALREADY_OPEN', 'A dispute has already been opened for this negotiation.');
      }
      const eventCount = Number(negotiation.eventCount ?? 0);
      if (!Number.isSafeInteger(eventCount) || eventCount < 0 || eventCount >= Number.MAX_SAFE_INTEGER) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Negotiation event sequence is invalid.');
      }
      const version = nextNegotiationVersion(negotiation);
      const timestamp = getServerTimestamp();
      const record = {
        negotiationId,
        raisedByAgentId: uid,
        ...parsed.data,
        status: 'open',
        createdAt: timestamp,
      };
      transaction.create(disputeRef, record);
      transaction.update(negotiationRef, {
        eventCount: eventCount + 1,
        version,
        updatedAt: timestamp,
      });
      writeNegotiationEvent(transaction, negotiationRef, {
        sequence: eventCount + 1,
        type: 'negotiation.dispute_escalated',
        actorAgentId: uid,
        details: { category: parsed.data.category },
      });
      writeNegotiationSnapshot(transaction, negotiationRef, {
        version,
        status: String(negotiation.status),
        currentOfferId: typeof negotiation.currentOfferId === 'string' ? negotiation.currentOfferId : null,
        currentOffer: negotiation.currentOffer ?? null,
        offerCount: Number(negotiation.offerCount ?? 0),
        updatedAt: timestamp,
        actorId: uid,
      });
      return negotiationDisputeSchema.parse({
        id: disputeRef.id,
        ...record,
        createdAt: new Date().toISOString(),
      });
    });
    return apiSuccess(dispute, 201);
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
