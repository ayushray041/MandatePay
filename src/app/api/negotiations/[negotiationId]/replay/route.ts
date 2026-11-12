import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { formatNegotiationSnapshot } from '@/lib/negotiations/format';
import { assertNegotiationViewer } from '@/lib/negotiations/policy';

type RouteContext = { params: Promise<{ negotiationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const { negotiationId } = await context.params;
  const negotiationRef = adminFirestore.collection('negotiations').doc(negotiationId);
  try {
    const snapshot = await negotiationRef.get();
    if (!snapshot.exists) {
      return apiError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
    }
    const negotiation = snapshot.data();
    if (!negotiation) {
      throw new Error('Negotiation document has no data.');
    }
    assertNegotiationViewer(negotiation, authentication.user.uid);

    const versions = await negotiationRef.collection('versions').orderBy('version', 'asc').get();
    return apiSuccess({
      negotiationId,
      currentVersion: Number(negotiation.version ?? 1),
      snapshots: versions.docs.map((version) => formatNegotiationSnapshot(
        version.data(),
        authentication.user.uid,
        [String(negotiation.initiatorAgentId), String(negotiation.recipientAgentId)],
      )),
    });
  } catch (error: unknown) {
    if (error instanceof NegotiationError) {
      return negotiationErrorResponse(error);
    }
    console.error('Failed to replay negotiation history.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiation history could not be replayed.');
  }
}
