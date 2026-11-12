import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'toMillis' in value
    && typeof value.toMillis === 'function'
  ) {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }
  try {
    const [initiated, received] = await Promise.all([
      adminFirestore.collection('negotiations')
        .where('initiatorAgentId', '==', authentication.user.uid)
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get(),
      adminFirestore.collection('negotiations')
        .where('recipientAgentId', '==', authentication.user.uid)
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get(),
    ]);
    const rows = [...new Map(
      [...initiated.docs, ...received.docs].map((snapshot) => [snapshot.id, snapshot.data()]),
    ).values()];
    const statusCounts: Record<string, number> = {};
    let totalOffers = 0;
    const completedDurations: number[] = [];
    for (const negotiation of rows) {
      const status = typeof negotiation.status === 'string' ? negotiation.status : 'unknown';
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const offerCount = Number(negotiation.offerCount);
      if (Number.isSafeInteger(offerCount) && offerCount >= 0) {
        totalOffers += offerCount;
      }
      if (['accepted', 'rejected', 'expired', 'cancelled'].includes(status)) {
        const createdAt = timestampMillis(negotiation.createdAt);
        const resolvedAt = timestampMillis(negotiation.acceptedAt ?? negotiation.updatedAt);
        if (createdAt !== null && resolvedAt !== null && resolvedAt >= createdAt) {
          completedDurations.push(resolvedAt - createdAt);
        }
      }
    }
    const decided = (statusCounts.accepted ?? 0) + (statusCounts.rejected ?? 0);
    return apiSuccess({
      sampleSize: rows.length,
      windowTruncated: initiated.size === 100 || received.size === 100,
      statusCounts,
      averageOffersPerNegotiation: rows.length === 0 ? 0 : totalOffers / rows.length,
      acceptanceRate: decided === 0 ? null : (statusCounts.accepted ?? 0) / decided,
      averageResolutionMs: completedDurations.length === 0
        ? null
        : completedDurations.reduce((total, duration) => total + duration, 0) / completedDurations.length,
    });
  } catch (error: unknown) {
    console.error('Failed to calculate negotiation analytics.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation analytics could not be calculated.');
  }
}
