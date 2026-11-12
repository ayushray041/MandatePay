import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';

type RouteContext = { params: Promise<{ batchId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }
  const firestore = adminFirestore;
  const { batchId } = await context.params;
  try {
    const snapshot = await firestore.collection('negotiations')
      .where('batchId', '==', batchId)
      .limit(11)
      .get();
    if (snapshot.empty || snapshot.size > 10) {
      return apiError(404, 'NEGOTIATION_BATCH_NOT_FOUND', 'Negotiation batch was not found.');
    }
    const rows: Array<Record<string, unknown> & { id: string }> = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }));
    if (rows.some((row) => row.initiatorAgentId !== authentication.user.uid || row.batchId !== batchId)) {
      return apiError(404, 'NEGOTIATION_BATCH_NOT_FOUND', 'Negotiation batch was not found.');
    }
    rows.sort((left, right) => Number(left.batchIndex ?? 0) - Number(right.batchIndex ?? 0));
    const entries = await Promise.all(rows.map(async (row) => {
      const agentSnapshot = await firestore.collection('agents')
        .doc(String(row.recipientAgentId))
        .get();
      const offer = typeof row.currentOffer === 'object' && row.currentOffer !== null
        ? row.currentOffer as Record<string, unknown>
        : null;
      const terms = typeof offer?.terms === 'object' && offer.terms !== null
        ? offer.terms as Record<string, unknown>
        : null;
      return {
        negotiationId: row.id,
        recipientAgentId: row.recipientAgentId,
        recipientDisplayName: agentSnapshot.data()?.displayName ?? 'Agent',
        status: row.status,
        offerCount: Number(row.offerCount ?? 0),
        latestOffer: terms
          ? {
              title: terms.title,
              amountMinor: terms.amountMinor,
              currency: terms.currency,
              deliveryDays: terms.deliveryDays,
            }
          : null,
      };
    }));
    return apiSuccess({ batchId, entries });
  } catch (error: unknown) {
    console.error('Failed to load negotiation batch comparison.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation batch could not be loaded.');
  }
}
