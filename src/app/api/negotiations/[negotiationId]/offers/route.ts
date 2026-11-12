import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { formatNegotiationOffer } from '@/lib/negotiations/format';
import {
  assertMandateActive,
  assertNegotiationParticipant,
  assertOfferWithinMandate,
  isNegotiationExpired,
  isNegotiationTerminal,
} from '@/lib/negotiations/policy';
import {
  negotiationOfferSubmitSchema,
  type NegotiationOfferTerms,
} from '@/models/negotiation';

type RouteContext = { params: Promise<{ negotiationId: string }> };
type StoredData = Record<string, unknown>;

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = negotiationOfferSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Offer details are invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const { negotiationId } = await context.params;
  const firestore = adminFirestore;
  const negotiationRef = firestore.collection('negotiations').doc(negotiationId);
  const offerRef = negotiationRef.collection('offers').doc();
  const uid = authentication.user.uid;
  const now = new Date();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const negotiationSnapshot = await transaction.get(negotiationRef);
      if (!negotiationSnapshot.exists) {
        throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      const negotiation = negotiationSnapshot.data();
      if (!negotiation) {
        throw new Error('Negotiation document has no data.');
      }
      const participant = assertNegotiationParticipant(negotiation, uid);

      if (isNegotiationTerminal(negotiation.status)) {
        throw new NegotiationError(409, 'NEGOTIATION_CLOSED', 'Negotiation is already closed.');
      }
      if (isNegotiationExpired(negotiation, now)) {
        const eventCount = Number(negotiation.eventCount ?? 0) + 1;
        transaction.update(negotiationRef, {
          status: 'expired',
          eventCount,
          updatedAt: getServerTimestamp(),
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount,
          type: 'negotiation.expired',
          actorAgentId: uid,
        });
        return { expired: true as const };
      }

      const status = negotiation.status;
      const currentOffer =
        typeof negotiation.currentOffer === 'object' && negotiation.currentOffer !== null
          ? negotiation.currentOffer as StoredData
          : null;
      if (status === 'initiated') {
        if (participant !== 'initiator' || currentOffer || Number(negotiation.offerCount) !== 0) {
          throw new NegotiationError(
            409,
            'INVALID_NEGOTIATION_STATE',
            'Only the initiator can submit the first offer.',
          );
        }
      } else if (
        !['offer_submitted', 'counter_offered'].includes(String(status))
        || !currentOffer
        || currentOffer.submittedByAgentId === uid
      ) {
        throw new NegotiationError(
          409,
          'INVALID_NEGOTIATION_STATE',
          'Only the other participant can counter the latest offer.',
        );
      }

      const initiatorMandateId = String(negotiation.initiatorMandateId);
      const boundRecipientMandateId =
        typeof negotiation.recipientMandateId === 'string'
          ? negotiation.recipientMandateId
          : null;

      let mandateId: string;
      if (participant === 'initiator') {
        if (parsed.data.mandateId && parsed.data.mandateId !== initiatorMandateId) {
          throw new NegotiationError(409, 'MANDATE_MISMATCH', 'The initiator mandate cannot be changed.');
        }
        mandateId = initiatorMandateId;
      } else {
        if (!boundRecipientMandateId && !parsed.data.mandateId) {
          throw new NegotiationError(
            400,
            'MANDATE_REQUIRED',
            'Select an active mandate the first time you respond.',
          );
        }
        if (
          boundRecipientMandateId
          && parsed.data.mandateId
          && parsed.data.mandateId !== boundRecipientMandateId
        ) {
          throw new NegotiationError(409, 'MANDATE_MISMATCH', 'The recipient mandate cannot be changed.');
        }
        mandateId = boundRecipientMandateId ?? String(parsed.data.mandateId);
      }

      const ownMandateRef = firestore.collection('mandates').doc(mandateId);
      const ownAgentRef = firestore.collection('agents').doc(uid);
      const latestMandateId = currentOffer ? String(currentOffer.mandateId) : null;
      const latestAgentId = currentOffer ? String(currentOffer.submittedByAgentId) : null;
      const latestMandateRef = latestMandateId
        ? firestore.collection('mandates').doc(latestMandateId)
        : null;
      const latestAgentRef = latestAgentId
        ? firestore.collection('agents').doc(latestAgentId)
        : null;

      const [ownMandateSnapshot, ownAgentSnapshot, latestMandateSnapshot, latestAgentSnapshot] =
        await Promise.all([
          transaction.get(ownMandateRef),
          transaction.get(ownAgentRef),
          latestMandateRef ? transaction.get(latestMandateRef) : Promise.resolve(null),
          latestAgentRef ? transaction.get(latestAgentRef) : Promise.resolve(null),
        ]);
      if (!ownMandateSnapshot.exists || !ownAgentSnapshot.exists) {
        throw new NegotiationError(
          403,
          'ACTIVE_AGENT_MANDATE_REQUIRED',
          'An active mandate and registered agent profile are required.',
        );
      }
      const ownMandate = ownMandateSnapshot.data();
      const ownAgent = ownAgentSnapshot.data();
      if (!ownMandate || !ownAgent) {
        throw new Error('Agent or mandate document has no data.');
      }
      assertOfferWithinMandate(ownMandate, ownAgent, uid, parsed.data.terms, now);

      if (currentOffer && latestMandateSnapshot && latestAgentSnapshot && latestAgentId) {
        const latestMandate = latestMandateSnapshot.data();
        const latestAgent = latestAgentSnapshot.data();
        if (!latestMandate || !latestAgent) {
          throw new NegotiationError(
            409,
            'OFFER_MANDATE_UNAVAILABLE',
            'The previous offer no longer has a valid agent mandate.',
          );
        }
        assertMandateActive(latestMandate, latestAgentId, now);
        const previousTerms = currentOffer.terms as NegotiationOfferTerms;
        assertOfferWithinMandate(latestMandate, latestAgent, latestAgentId, previousTerms, now);
      }

      const sequence = Number(negotiation.offerCount ?? 0) + 1;
      const eventCount = Number(negotiation.eventCount ?? 0) + 1;
      const timestamp = getServerTimestamp();
      const offer = {
        negotiationId,
        sequence,
        submittedByAgentId: uid,
        mandateId,
        terms: parsed.data.terms,
        createdAt: timestamp,
      };
      const nextStatus = status === 'initiated' ? 'offer_submitted' : 'counter_offered';
      transaction.create(offerRef, offer);
      transaction.update(negotiationRef, {
        ...(participant === 'recipient' && !boundRecipientMandateId
          ? { recipientMandateId: mandateId }
          : {}),
        status: nextStatus,
        currentOfferId: offerRef.id,
        currentOffer: {
          sequence,
          submittedByAgentId: uid,
          mandateId,
          terms: parsed.data.terms,
          createdAt: timestamp,
        },
        offerCount: sequence,
        eventCount,
        updatedAt: timestamp,
      });
      writeNegotiationEvent(transaction, negotiationRef, {
        sequence: eventCount,
        type: status === 'initiated' ? 'offer.submitted' : 'offer.countered',
        actorAgentId: uid,
        offerId: offerRef.id,
        details: { amountMinor: parsed.data.terms.amountMinor, currency: parsed.data.terms.currency },
      });

      return {
        expired: false as const,
        offer: { id: offerRef.id, ...offer, createdAt: now },
      };
    });

    if (result.expired) {
      return apiError(410, 'NEGOTIATION_EXPIRED', 'Negotiation has expired.');
    }
    return apiSuccess(formatNegotiationOffer(result.offer.id, result.offer), 201);
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
