import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import {
  formatNegotiation,
  formatNegotiationEvent,
  formatNegotiationOffer,
} from '@/lib/negotiations/format';
import { assertNegotiationParticipant } from '@/lib/negotiations/policy';
import { negotiationErrorResponse } from '@/lib/negotiations/errors';

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
  const firestore = adminFirestore;
  const negotiationRef = firestore.collection('negotiations').doc(negotiationId);
  try {
    const snapshot = await negotiationRef.get();
    if (!snapshot.exists) {
      return apiError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
    }
    const negotiation = snapshot.data();
    if (!negotiation) {
      throw new Error('Negotiation document has no data.');
    }
    assertNegotiationParticipant(negotiation, authentication.user.uid);

    const [offers, events, initiator, recipient] = await Promise.all([
      negotiationRef.collection('offers').orderBy('sequence', 'asc').get(),
      negotiationRef.collection('events').orderBy('sequence', 'asc').get(),
      firestore.collection('agents').doc(String(negotiation.initiatorAgentId)).get(),
      firestore.collection('agents').doc(String(negotiation.recipientAgentId)).get(),
    ]);
    return apiSuccess({
      negotiation: {
        ...formatNegotiation(snapshot.id, negotiation),
        initiatorDisplayName: initiator.data()?.displayName ?? 'Agent',
        recipientDisplayName: recipient.data()?.displayName ?? 'Agent',
      },
      offers: offers.docs.map((offer) => formatNegotiationOffer(offer.id, offer.data())),
      events: events.docs.map((event) => formatNegotiationEvent(event.id, event.data())),
    });
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
