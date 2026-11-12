import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { addMandateVelocityUsage } from '@/lib/mandates/policy';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { formatNegotiationForViewer } from '@/lib/negotiations/format';
import {
  assertMandateActive,
  assertOfferWithinMandate,
  isNegotiationExpired,
  requiredOwnerApprovalGroups,
} from '@/lib/negotiations/policy';
import {
  negotiationOfferTermsSchema,
  negotiationOwnerApprovalSchema,
  type NegotiationOfferTerms,
} from '@/models/negotiation';

type RouteContext = { params: Promise<{ negotiationId: string }> };
type StoredData = Record<string, unknown>;
type ApprovalGroup = { approverIds: string[]; quorum: number };

function parseApprovalGroups(value: unknown): ApprovalGroup[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const groups: ApprovalGroup[] = [];
  for (const item of value) {
    if (
      typeof item !== 'object'
      || item === null
      || !('approverIds' in item)
      || !('quorum' in item)
      || !Array.isArray(item.approverIds)
      || !item.approverIds.every((id: unknown) => typeof id === 'string')
      || typeof item.quorum !== 'number'
      || !Number.isSafeInteger(item.quorum)
      || item.quorum < 1
      || item.quorum > item.approverIds.length
    ) {
      return null;
    }
    groups.push({
      approverIds: item.approverIds,
      quorum: item.quorum,
    });
  }
  return groups;
}

function approvalGroupsMatch(left: ApprovalGroup[], right: ApprovalGroup[]): boolean {
  const normalize = (groups: ApprovalGroup[]) => groups
    .map((group) => `${[...group.approverIds].sort().join(',')}:${group.quorum}`)
    .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Owner approval must be valid JSON.');
  }
  const parsed = negotiationOwnerApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Owner approval is invalid.');
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
      const storedRequiredOwners = negotiation.requiredOwnerApprovalIds;
      const storedApprovals = negotiation.ownerApprovals;
      if (
        !Array.isArray(storedRequiredOwners)
        || storedRequiredOwners.length === 0
        || !storedRequiredOwners.every((ownerId) => typeof ownerId === 'string')
        || !Array.isArray(storedApprovals)
        || !storedApprovals.every((ownerId) => typeof ownerId === 'string')
      ) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Owner approval data is invalid.');
      }
      const requiredOwners = storedRequiredOwners as string[];
      const approvals = storedApprovals as string[];
      const storedGroups = negotiation.requiredOwnerApprovalGroups === undefined
        ? requiredOwners.map((ownerId) => ({ approverIds: [ownerId], quorum: 1 }))
        : parseApprovalGroups(negotiation.requiredOwnerApprovalGroups);
      if (!storedGroups || storedGroups.length === 0) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Owner approval quorum data is invalid.');
      }
      if (
        new Set(requiredOwners).size !== requiredOwners.length
        || new Set(approvals).size !== approvals.length
        || approvals.some((ownerId) => !requiredOwners.includes(ownerId))
      ) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Owner approval data is inconsistent.');
      }
      if (!requiredOwners.includes(uid)) {
        throw new NegotiationError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      if (negotiation.status !== 'pending_owner_approval') {
        throw new NegotiationError(409, 'NEGOTIATION_NOT_AWAITING_APPROVAL', 'Negotiation is not awaiting owner approval.');
      }
      if (approvals.includes(uid)) {
        throw new NegotiationError(409, 'ALREADY_REVIEWED', 'This account has already reviewed the negotiation.');
      }

      const eventCount = Number(negotiation.eventCount ?? 0);
      if (
        !Number.isSafeInteger(eventCount)
        || eventCount < 0
        || eventCount > Number.MAX_SAFE_INTEGER - 2
      ) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Negotiation event sequence is invalid.');
      }
      if (isNegotiationExpired(negotiation, now)) {
        transaction.update(negotiationRef, {
          status: 'expired',
          eventCount: eventCount + 1,
          updatedAt: getServerTimestamp(),
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount + 1,
          type: 'negotiation.expired',
          actorOwnerId: uid,
        });
        return { expired: true as const };
      }

      const currentOffer =
        typeof negotiation.currentOffer === 'object' && negotiation.currentOffer !== null
          ? negotiation.currentOffer as StoredData
          : null;
      const termsResult = negotiationOfferTermsSchema.safeParse(currentOffer?.terms);
      if (!termsResult.success || !currentOffer) {
        throw new NegotiationError(500, 'INVALID_OFFER', 'The current offer is invalid.');
      }
      const terms: NegotiationOfferTerms = termsResult.data;
      const initiatorId = String(negotiation.initiatorAgentId ?? '');
      const recipientId = String(negotiation.recipientAgentId ?? '');
      const initiatorMandateId = String(negotiation.initiatorMandateId ?? '');
      const recipientMandateId = String(negotiation.recipientMandateId ?? '');
      if (
        !initiatorId
        || !recipientId
        || initiatorId === recipientId
        || !initiatorMandateId
        || !recipientMandateId
        || initiatorMandateId === recipientMandateId
      ) {
        throw new NegotiationError(500, 'INVALID_NEGOTIATION', 'Negotiation participant references are invalid.');
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
        throw new NegotiationError(409, 'ACTIVE_AGENT_MANDATE_REQUIRED', 'Both agents must have profiles and active mandates.');
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
      const offerAuthorId = String(currentOffer.submittedByAgentId ?? '');
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

      const currentGroups = requiredOwnerApprovalGroups(
        [initiatorMandate, recipientMandate],
        terms,
        now,
      );
      const currentRequiredOwners = [...new Set(currentGroups.flatMap((group) => group.approverIds))];
      if (
        currentRequiredOwners.length !== requiredOwners.length
        || currentRequiredOwners.some((ownerId) => !requiredOwners.includes(ownerId))
        || !approvalGroupsMatch(currentGroups, storedGroups)
      ) {
        throw new NegotiationError(409, 'APPROVAL_REQUIREMENTS_CHANGED', 'Mandate owner approval requirements have changed.');
      }

      const timestamp = getServerTimestamp();
      if (parsed.data.decision === 'reject') {
        transaction.update(negotiationRef, {
          status: 'rejected',
          rejectionReason: parsed.data.reason,
          eventCount: eventCount + 1,
          updatedAt: timestamp,
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount + 1,
          type: 'negotiation.owner_rejected',
          actorOwnerId: uid,
          offerId: String(negotiation.currentOfferId),
          details: { reason: parsed.data.reason },
        });
        return {
          expired: false as const,
          negotiation: {
            ...negotiation,
            status: 'rejected',
            rejectionReason: parsed.data.reason,
            eventCount: eventCount + 1,
            updatedAt: now,
          },
        };
      }

      const nextApprovals = [...approvals, uid];
      const fullyApproved = currentGroups.every((group) =>
        group.approverIds.filter((ownerId) => nextApprovals.includes(ownerId)).length >= group.quorum);
      const nextEventCount = eventCount + (fullyApproved ? 2 : 1);
      transaction.update(negotiationRef, {
        ownerApprovals: nextApprovals,
        ...(fullyApproved
          ? {
              status: 'accepted',
              acceptedAt: timestamp,
            }
          : {}),
        eventCount: nextEventCount,
        updatedAt: timestamp,
      });
      writeNegotiationEvent(transaction, negotiationRef, {
        sequence: eventCount + 1,
        type: 'negotiation.owner_approved',
        actorOwnerId: uid,
        offerId: String(negotiation.currentOfferId),
      });

      if (fullyApproved) {
        const initiatorReserved = Number(initiatorMandate.reservedAmountMinor ?? 0);
        const recipientReserved = Number(recipientMandate.reservedAmountMinor ?? 0);
        if (
          !Number.isSafeInteger(initiatorReserved)
          || initiatorReserved < 0
          || !Number.isSafeInteger(recipientReserved)
          || recipientReserved < 0
          || !Number.isSafeInteger(initiatorReserved + terms.amountMinor)
          || !Number.isSafeInteger(recipientReserved + terms.amountMinor)
        ) {
          throw new NegotiationError(500, 'INVALID_MANDATE', 'Mandate reservation data is invalid.');
        }
        const initiatorUsage = addMandateVelocityUsage(initiatorMandate, terms.amountMinor, now);
        const recipientUsage = addMandateVelocityUsage(recipientMandate, terms.amountMinor, now);
        transaction.update(initiatorMandateRef, {
          reservedAmountMinor: initiatorReserved + terms.amountMinor,
          velocityUsage: initiatorUsage.velocityUsage,
          updatedAt: timestamp,
        });
        transaction.update(recipientMandateRef, {
          reservedAmountMinor: recipientReserved + terms.amountMinor,
          velocityUsage: recipientUsage.velocityUsage,
          updatedAt: timestamp,
        });
        transaction.update(negotiationRef, {
          reservationUsageWindowKeys: {
            initiator: initiatorUsage.usageWindowKeys,
            recipient: recipientUsage.usageWindowKeys,
          },
        });
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: eventCount + 2,
          type: 'negotiation.accepted',
          actorOwnerId: uid,
          offerId: String(negotiation.currentOfferId),
          details: { amountMinor: terms.amountMinor, currency: terms.currency },
        });
      }

      return {
        expired: false as const,
        negotiation: {
          ...negotiation,
          status: fullyApproved ? 'accepted' : 'pending_owner_approval',
          ownerApprovals: nextApprovals,
          ...(fullyApproved
            ? { acceptedAt: now }
            : {}),
          eventCount: nextEventCount,
          updatedAt: now,
        },
      };
    });

    if (result.expired) {
      return apiError(410, 'NEGOTIATION_EXPIRED', 'Negotiation has expired.');
    }
    return apiSuccess(formatNegotiationForViewer(negotiationId, result.negotiation, uid));
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
