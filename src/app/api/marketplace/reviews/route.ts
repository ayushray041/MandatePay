import { createHash } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeAgentActivity } from '@/lib/agents/audit';
import { marketplaceReviewCreateSchema } from '@/models/marketplace';

type StoredData = Record<string, unknown>;

function isRecord(value: unknown): value is StoredData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCount(value: unknown, field: string): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored marketplace metric ${field} is invalid.`);
  }
  return value;
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Marketplace review must be valid JSON.');
  }
  const parsed = marketplaceReviewCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Review details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Marketplace review storage is unavailable.');
  }

  const firestore = adminFirestore;
  const reviewerUid = authentication.user.uid;
  const paymentRef = firestore.collection('payments').doc(parsed.data.paymentId);
  const reviewId = createHash('sha256').update(parsed.data.paymentId).digest('hex');
  const reviewRef = firestore.collection('marketplaceReviews').doc(reviewId);
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const paymentSnapshot = await transaction.get(paymentRef);
      const payment = paymentSnapshot.data();
      if (
        !paymentSnapshot.exists
        || !payment
        || payment.status !== 'completed'
        || payment.payerId !== reviewerUid
        || !Array.isArray(payment.participantIds)
        || !payment.participantIds.includes(reviewerUid)
        || typeof payment.payeeId !== 'string'
      ) {
        return { error: 'payment_not_reviewable' as const };
      }

      const payeeUid = payment.payeeId;
      const agentRef = firestore.collection('agents').doc(payeeUid);
      const agentSnapshot = await transaction.get(agentRef);
      const agent = agentSnapshot.data();
      if (
        !agentSnapshot.exists
        || !agent
        || typeof agent.agentId !== 'string'
        || !/^agt_[A-Za-z0-9_-]{32}$/.test(agent.agentId)
        || agent.ownerId !== payeeUid
      ) {
        return { error: 'agent_not_reviewable' as const };
      }

      const agentId = agent.agentId;
      const identityRef = firestore.collection('agentIdentities').doc(agentId);
      const marketplaceProfileRef = firestore.collection('agentMarketplaceProfiles').doc(agentId);
      const metricsRef = firestore.collection('marketplaceAgentMetrics').doc(agentId);
      const [identitySnapshot, profileSnapshot, metricsSnapshot, existingReview] = await Promise.all([
        transaction.get(identityRef),
        transaction.get(marketplaceProfileRef),
        transaction.get(metricsRef),
        transaction.get(reviewRef),
      ]);
      if (
        !identitySnapshot.exists
        || identitySnapshot.data()?.agentUid !== payeeUid
        || !profileSnapshot.exists
        || profileSnapshot.data()?.ownerId !== payeeUid
      ) {
        return { error: 'agent_not_reviewable' as const };
      }
      if (existingReview.exists) {
        return { error: 'duplicate_review' as const };
      }

      const metrics = metricsSnapshot.data() ?? {};
      if (!isRecord(metrics)) {
        throw new Error('Stored marketplace metrics are invalid.');
      }
      const reviewCount = safeCount(metrics.reviewCount, 'reviewCount');
      const ratingTotal = safeCount(metrics.ratingTotal, 'ratingTotal');
      const now = getServerTimestamp();
      const review = {
        agentId,
        paymentId: parsed.data.paymentId,
        reviewerUid,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
        createdAt: now,
      };
      transaction.create(reviewRef, review);
      transaction.set(metricsRef, {
        agentId,
        reviewCount: reviewCount + 1,
        ratingTotal: ratingTotal + parsed.data.rating,
        updatedAt: now,
      }, { merge: true });
      writeAgentActivity(firestore, transaction, {
        ownerId: payeeUid,
        agentId,
        actorId: reviewerUid,
        action: 'marketplace.review.created',
        details: { reviewId, rating: parsed.data.rating },
      });
      return { reviewId, agentId };
    });

    if ('error' in result) {
      if (result.error === 'duplicate_review') {
        return apiError(409, 'REVIEW_ALREADY_EXISTS', 'A review was already submitted for this payment.');
      }
      return apiError(404, 'COMPLETED_AGENT_PAYMENT_REQUIRED', 'A completed payment to a marketplace agent is required.');
    }
    return apiSuccess({
      id: result.reviewId,
      agentId: result.agentId,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      reviewerLabel: 'Verified customer',
      createdAt: new Date().toISOString(),
    }, 201);
  } catch (error: unknown) {
    console.error('Failed to create marketplace review.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Marketplace review could not be created.');
  }
}
