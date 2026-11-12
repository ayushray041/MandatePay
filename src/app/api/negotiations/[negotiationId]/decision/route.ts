import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { formatNegotiationForViewer } from '@/lib/negotiations/format';
import {
  assertMandateActive,
  assertNegotiationParticipant,
  assertOfferWithinMandate,
  isNegotiationExpired,
  isNegotiationTerminal,
  requiredOwnerApprovalIds,
} from '@/lib/negotiations/policy';
import {
  negotiationDecisionSchema,
  negotiationOfferTermsSchema,
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
    return apiError(400, 'INVALID_JSON', 'Negotiation decision must be valid JSON.');
  }
  const parsed = negotiationDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Negotiation decision is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const { negotiationId } = await context.params;
  const firestore = adminFirestore;
  const negotiationRef = firestore.collection('negotiations').doc(negotiationId);
  const uid = authentication.user.uid;
  const now = new Date();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(negotiationRef);
      if (!snapshot.exists) {
        throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      const negotiation = snapshot.data();
      if (!negotiation) {
        throw new Error('Negotiation document has no data.');
      }
      const participant = assertNegotiationParticipant(negotiation, uid);
      if (isNegotiationTerminal(negotiation.status)) {
        throw new NegotiationError(409, 'NEGOTIATION_CLOSED', 'Negotiation is already closed.');
      }
      if (isNegotiationExpired(negotiation, now)) {
        const currentEventCount = Number(negotiation.eventCount ?? 0);
        if (
          !Number.isSafeInteger(currentEventCount)
          || currentEventCount < 0
          || currentEventCount >= Number.MAX_SAFE_INTEGER
        ) {
          throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Negotiation event sequence is invalid.');
        }
        const eventCount = currentEventCount + 1;
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

      const currentOffer =
        typeof negotiation.currentOffer === 'object' && negotiation.currentOffer !== null
          ? negotiation.currentOffer as StoredData
          : null;
      if (parsed.data.decision === 'cancel') {
        if (participant !== 'initiator') {
          throw new NegotiationError(403, 'FORBIDDEN', 'Only the initiator can cancel a negotiation.');
        }
      } else if (parsed.data.decision === 'reject') {
        if (negotiation.status === 'initiated') {
          if (participant !== 'recipient') {
            throw new NegotiationError(
              409,
              'INVALID_NEGOTIATION_STATE',
              'Only the recipient can reject an unoffered request.',
            );
          }
        } else if (
          !['offer_submitted', 'counter_offered'].includes(String(negotiation.status))
          || !currentOffer
          || currentOffer.submittedByAgentId === uid
        ) {
          throw new NegotiationError(
            409,
            'INVALID_NEGOTIATION_STATE',
            'Only the other participant can reject the latest offer.',
          );
        }
      } else if (
        !['offer_submitted', 'counter_offered'].includes(String(negotiation.status))
        || !currentOffer
        || currentOffer.submittedByAgentId === uid
      ) {
        throw new NegotiationError(
          409,
          'INVALID_NEGOTIATION_STATE',
          'Only the other participant can accept the latest offer.',
        );
      }

      const nextStatus = parsed.data.decision === 'accept'
        ? 'accepted'
        : parsed.data.decision === 'reject'
          ? 'rejected'
          : 'cancelled';
      const eventCount = Number(negotiation.eventCount ?? 0) + 1;
      const timestamp = getServerTimestamp();

      if (parsed.data.decision !== 'accept') {
        transaction.update(negotiationRef, {
          status: nextStatus,
          resolvedByAgentId: uid,
          ...(parsed.data.decision === 'reject'
            ? { rejectionReason: parsed.data.reason }
            : {}),
          eventCount,
          updatedAt: timestamp,
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount,
          type: `negotiation.${parsed.data.decision === 'reject' ? 'rejected' : 'cancelled'}`,
          actorAgentId: uid,
          ...(parsed.data.decision === 'reject'
            ? { details: { reason: parsed.data.reason } }
            : {}),
        });
        return {
          expired: false as const,
          pendingOwnerApproval: false as const,
          negotiation: {
            ...negotiation,
            status: nextStatus,
            resolvedByAgentId: uid,
            ...(parsed.data.decision === 'reject'
              ? { rejectionReason: parsed.data.reason }
              : {}),
            updatedAt: now,
          },
        };
      }

      if (!currentOffer) {
        throw new NegotiationError(409, 'NO_OFFER_TO_ACCEPT', 'There is no offer to accept.');
      }
      const termsResult = negotiationOfferTermsSchema.safeParse(currentOffer.terms);
      if (!termsResult.success) {
        throw new NegotiationError(500, 'INVALID_OFFER', 'The current offer is invalid.');
      }
      const terms: NegotiationOfferTerms = termsResult.data;
      const initiatorId = String(negotiation.initiatorAgentId);
      const recipientId = String(negotiation.recipientAgentId);
      const initiatorMandateId = String(negotiation.initiatorMandateId);
      const boundRecipientMandateId =
        typeof negotiation.recipientMandateId === 'string'
          ? negotiation.recipientMandateId
          : null;

      let recipientMandateId = boundRecipientMandateId;
      if (participant === 'initiator') {
        if (parsed.data.mandateId && parsed.data.mandateId !== initiatorMandateId) {
          throw new NegotiationError(409, 'MANDATE_MISMATCH', 'The initiator mandate cannot be changed.');
        }
      } else {
        if (!boundRecipientMandateId && !parsed.data.mandateId) {
          throw new NegotiationError(
            400,
            'MANDATE_REQUIRED',
            'Select an active mandate before accepting.',
          );
        }
        if (
          boundRecipientMandateId
          && parsed.data.mandateId
          && parsed.data.mandateId !== boundRecipientMandateId
        ) {
          throw new NegotiationError(409, 'MANDATE_MISMATCH', 'The recipient mandate cannot be changed.');
        }
        recipientMandateId = boundRecipientMandateId ?? String(parsed.data.mandateId);
      }
      if (!recipientMandateId || recipientMandateId === initiatorMandateId) {
        throw new NegotiationError(409, 'INVALID_MANDATE_PAIR', 'Two distinct participant mandates are required.');
      }

      const initiatorMandateRef = firestore.collection('mandates').doc(initiatorMandateId);
      const recipientMandateRef = firestore.collection('mandates').doc(recipientMandateId);
      const initiatorAgentRef = firestore.collection('agents').doc(initiatorId);
      const recipientAgentRef = firestore.collection('agents').doc(recipientId);
      const [
        initiatorMandateSnapshot,
        recipientMandateSnapshot,
        initiatorAgentSnapshot,
        recipientAgentSnapshot,
      ] = await Promise.all([
        transaction.get(initiatorMandateRef),
        transaction.get(recipientMandateRef),
        transaction.get(initiatorAgentRef),
        transaction.get(recipientAgentRef),
      ]);
      if (
        !initiatorMandateSnapshot.exists
        || !recipientMandateSnapshot.exists
        || !initiatorAgentSnapshot.exists
        || !recipientAgentSnapshot.exists
      ) {
        throw new NegotiationError(
          409,
          'ACTIVE_AGENT_MANDATE_REQUIRED',
          'Both agents must have profiles and active mandates to accept terms.',
        );
      }
      const initiatorMandate = initiatorMandateSnapshot.data();
      const recipientMandate = recipientMandateSnapshot.data();
      const initiatorAgent = initiatorAgentSnapshot.data();
      const recipientAgent = recipientAgentSnapshot.data();
      if (!initiatorMandate || !recipientMandate || !initiatorAgent || !recipientAgent) {
        throw new Error('Negotiation participant data is incomplete.');
      }
      assertMandateActive(initiatorMandate, initiatorId, now);
      assertMandateActive(recipientMandate, recipientId, now);

      const offerAuthorId = String(currentOffer.submittedByAgentId);
      if (offerAuthorId === initiatorId) {
        if (currentOffer.mandateId !== initiatorMandateId) {
          throw new NegotiationError(500, 'INVALID_OFFER', 'Offer mandate does not match the initiator mandate.');
        }
        assertOfferWithinMandate(initiatorMandate, initiatorAgent, initiatorId, terms, now);
      } else if (offerAuthorId === recipientId) {
        if (currentOffer.mandateId !== recipientMandateId) {
          throw new NegotiationError(500, 'INVALID_OFFER', 'Offer mandate does not match the recipient mandate.');
        }
        assertOfferWithinMandate(recipientMandate, recipientAgent, recipientId, terms, now);
      } else {
        throw new NegotiationError(500, 'INVALID_OFFER', 'Offer author is not a negotiation participant.');
      }
      const requiredOwners = requiredOwnerApprovalIds(
        [initiatorMandate, recipientMandate],
        terms,
        now,
      );

      if (requiredOwners.length > 0) {
        transaction.update(negotiationRef, {
          ...(participant === 'recipient' && !boundRecipientMandateId
            ? { recipientMandateId }
            : {}),
          status: 'pending_owner_approval',
          requiredOwnerApprovalIds: requiredOwners,
          ownerApprovals: [],
          acceptanceRequestedByAgentId: uid,
          eventCount,
          updatedAt: timestamp,
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount,
          type: 'negotiation.owner_approval_requested',
          actorAgentId: uid,
          offerId: String(negotiation.currentOfferId),
          details: { requiredApprovalCount: requiredOwners.length },
        });
        return {
          expired: false as const,
          pendingOwnerApproval: true as const,
          negotiation: {
            ...negotiation,
            ...(participant === 'recipient' && !boundRecipientMandateId
              ? { recipientMandateId }
              : {}),
            status: 'pending_owner_approval',
            requiredOwnerApprovalIds: requiredOwners,
            ownerApprovals: [],
            acceptanceRequestedByAgentId: uid,
            eventCount,
            updatedAt: now,
          },
        };
      }

      const initiatorReserved = Number(initiatorMandate.reservedAmountMinor ?? 0);
      const recipientReserved = Number(recipientMandate.reservedAmountMinor ?? 0);
      if (
        !Number.isSafeInteger(initiatorReserved)
        || !Number.isSafeInteger(recipientReserved)
      ) {
        throw new NegotiationError(500, 'INVALID_MANDATE', 'Mandate reservation data is invalid.');
      }
      transaction.update(initiatorMandateRef, {
        reservedAmountMinor: initiatorReserved + terms.amountMinor,
        updatedAt: timestamp,
      });
      transaction.update(recipientMandateRef, {
        reservedAmountMinor: recipientReserved + terms.amountMinor,
        updatedAt: timestamp,
      });
      transaction.update(negotiationRef, {
        ...(participant === 'recipient' && !boundRecipientMandateId
          ? { recipientMandateId }
          : {}),
        status: 'accepted',
        acceptedAt: timestamp,
        resolvedByAgentId: uid,
        eventCount,
        updatedAt: timestamp,
      });
      writeNegotiationEvent(transaction, negotiationRef, {
        sequence: eventCount,
        type: 'negotiation.accepted',
        actorAgentId: uid,
        offerId: String(negotiation.currentOfferId),
        details: { amountMinor: terms.amountMinor, currency: terms.currency },
      });

      return {
        expired: false as const,
        pendingOwnerApproval: false as const,
        negotiation: {
          ...negotiation,
          ...(participant === 'recipient' && !boundRecipientMandateId
            ? { recipientMandateId }
            : {}),
          status: 'accepted',
          acceptedAt: now,
          resolvedByAgentId: uid,
          eventCount,
          updatedAt: now,
        },
      };
    });

    if (result.expired) {
      return apiError(410, 'NEGOTIATION_EXPIRED', 'Negotiation has expired.');
    }
    return apiSuccess(
      formatNegotiationForViewer(negotiationId, result.negotiation, uid),
      result.pendingOwnerApproval ? 202 : 200,
    );
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
