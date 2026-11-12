import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import { writeContractEvent } from '@/lib/contracts/events';
import { formatContract } from '@/lib/contracts/format';
import { contractVersionMetadata } from '@/lib/contracts/integrity';
import {
  assertContractTermsAuthorized,
  contractReservationUsageWindowKeys,
} from '@/lib/contracts/policy';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import { negotiationOfferTermsSchema } from '@/models/negotiation';
import { contractGenerateSchema, contractTermsSchema } from '@/models/contract';

type StoredData = Record<string, unknown>;

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  try {
    const snapshot = await adminFirestore.collection('contracts')
      .where('participantIds', 'array-contains', authentication.user.uid)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(snapshot.docs.map((contract) => formatContract(contract.id, contract.data())));
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
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
    return apiError(400, 'INVALID_JSON', 'Contract request must be valid JSON.');
  }
  const parsed = contractGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Contract request is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const firestore = adminFirestore;
  const { negotiationId } = parsed.data;
  const contractRef = firestore.collection('contracts').doc(negotiationId);
  const versionRef = contractRef.collection('versions').doc('v1');
  const now = new Date();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [negotiationSnapshot, existingContract] = await Promise.all([
        transaction.get(firestore.collection('negotiations').doc(negotiationId)),
        transaction.get(contractRef),
      ]);
      if (!negotiationSnapshot.exists) {
        throw new ContractError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      if (existingContract.exists) {
        throw new ContractError(409, 'CONTRACT_ALREADY_EXISTS', 'A contract already exists for this negotiation.');
      }
      const negotiation = negotiationSnapshot.data();
      if (!negotiation) {
        throw new Error('Negotiation document has no data.');
      }
      if (negotiation.status !== 'accepted') {
        throw new ContractError(409, 'NEGOTIATION_NOT_ACCEPTED', 'Only an accepted negotiation can generate a contract.');
      }
      if (
        negotiation.lockedOfferId !== undefined
        && negotiation.lockedOfferId !== negotiation.currentOfferId
      ) {
        throw new ContractError(409, 'ACCEPTED_OFFER_MISMATCH', 'The accepted offer snapshot is inconsistent.');
      }

      const initiatorId = String(negotiation.initiatorAgentId ?? '');
      const recipientId = String(negotiation.recipientAgentId ?? '');
      const initiatorMandateId = String(negotiation.initiatorMandateId ?? '');
      const recipientMandateId = String(negotiation.recipientMandateId ?? '');
      const currentOffer =
        typeof negotiation.currentOffer === 'object' && negotiation.currentOffer !== null
          ? negotiation.currentOffer as StoredData
          : null;
      const currentTerms = negotiationOfferTermsSchema.safeParse(currentOffer?.terms);
      if (
        !initiatorId
        || !recipientId
        || !initiatorMandateId
        || !recipientMandateId
        || !currentOffer
        || !currentTerms.success
        || !negotiation.acceptedAt
      ) {
        throw new ContractError(409, 'INVALID_ACCEPTED_NEGOTIATION', 'Accepted negotiation data is incomplete.');
      }
      if (
        currentOffer.mandateId !== initiatorMandateId
        && currentOffer.mandateId !== recipientMandateId
      ) {
        throw new ContractError(409, 'INVALID_ACCEPTED_NEGOTIATION', 'The accepted offer is not linked to either participant mandate.');
      }

      const [initiatorMandateSnapshot, recipientMandateSnapshot,
        initiatorAgentSnapshot, recipientAgentSnapshot] = await Promise.all([
        transaction.get(firestore.collection('mandates').doc(initiatorMandateId)),
        transaction.get(firestore.collection('mandates').doc(recipientMandateId)),
        transaction.get(firestore.collection('agents').doc(initiatorId)),
        transaction.get(firestore.collection('agents').doc(recipientId)),
      ]);
      if (
        !initiatorMandateSnapshot.exists
        || !recipientMandateSnapshot.exists
        || !initiatorAgentSnapshot.exists
        || !recipientAgentSnapshot.exists
      ) {
        throw new ContractError(409, 'CONTRACT_PARTY_UNAVAILABLE', 'Contract parties or mandates are unavailable.');
      }
      const initiatorMandate = initiatorMandateSnapshot.data();
      const recipientMandate = recipientMandateSnapshot.data();
      const initiatorAgent = initiatorAgentSnapshot.data();
      const recipientAgent = recipientAgentSnapshot.data();
      if (!initiatorMandate || !recipientMandate || !initiatorAgent || !recipientAgent) {
        throw new Error('Contract party data is incomplete.');
      }
      const initiatorOwnerId = String(initiatorMandate.ownerId ?? '');
      const recipientOwnerId = String(recipientMandate.ownerId ?? '');
      const [initiatorOwnerSnapshot, recipientOwnerSnapshot] = await Promise.all([
        transaction.get(firestore.collection('users').doc(initiatorOwnerId)),
        transaction.get(firestore.collection('users').doc(recipientOwnerId)),
      ]);
      if (!initiatorOwnerSnapshot.exists || !recipientOwnerSnapshot.exists) {
        throw new ContractError(409, 'CONTRACT_PARTY_UNAVAILABLE', 'A mandate owner profile is unavailable.');
      }
      const initiatorOwner = initiatorOwnerSnapshot.data();
      const recipientOwner = recipientOwnerSnapshot.data();
      if (
        !initiatorOwner
        || !recipientOwner
        || typeof initiatorOwner.displayName !== 'string'
        || typeof recipientOwner.displayName !== 'string'
        || typeof initiatorAgent.displayName !== 'string'
        || typeof recipientAgent.displayName !== 'string'
      ) {
        throw new ContractError(409, 'CONTRACT_PARTY_UNAVAILABLE', 'Contract party identity details are incomplete.');
      }

      const parties = [
        {
          userId: initiatorOwnerId,
          displayName: initiatorOwner.displayName,
          role: initiatorOwner.role,
          agentId: initiatorId,
          agentDisplayName: initiatorAgent.displayName,
          mandateId: initiatorMandateId,
          mandateTitle: initiatorMandate.title,
        },
        {
          userId: recipientOwnerId,
          displayName: recipientOwner.displayName,
          role: recipientOwner.role,
          agentId: recipientId,
          agentDisplayName: recipientAgent.displayName,
          mandateId: recipientMandateId,
          mandateTitle: recipientMandate.title,
        },
      ];
      const mandateExpiries = [
        timestampToIso(initiatorMandate.expiresAt),
        timestampToIso(recipientMandate.expiresAt),
      ].filter((expiry): expiry is string => expiry !== null);
      if (
        (!timestampToIso(initiatorMandate.expiresAt) && initiatorMandate.durationType !== 'permanent')
        || (!timestampToIso(recipientMandate.expiresAt) && recipientMandate.durationType !== 'permanent')
      ) {
        throw new ContractError(409, 'INVALID_MANDATE', 'Contract mandate expiry dates are invalid.');
      }
      const fallbackContractExpiry = now.getTime() + currentTerms.data.deliveryDays * 86_400_000;
      const expiresAt = new Date(Math.min(
        fallbackContractExpiry,
        ...mandateExpiries.map(Date.parse),
      )).toISOString();
      const termsResult = contractTermsSchema.safeParse({
        parties,
        service: {
          title: currentTerms.data.title,
          category: currentTerms.data.category,
          description: currentTerms.data.description,
          deliveryDays: currentTerms.data.deliveryDays,
        },
        amountMinor: currentTerms.data.amountMinor,
        currency: currentTerms.data.currency,
        ...(
          currentTerms.data.quantityPricing
          || currentTerms.data.sla
          || currentTerms.data.contractTerms
          || currentTerms.data.conditions
          ? {
              negotiatedTerms: {
                ...(currentTerms.data.quantityPricing
                  ? { quantityPricing: currentTerms.data.quantityPricing }
                  : {}),
                ...(currentTerms.data.sla ? { sla: currentTerms.data.sla } : {}),
                ...(currentTerms.data.contractTerms
                  ? { contractTerms: currentTerms.data.contractTerms }
                  : {}),
                ...(currentTerms.data.conditions
                  ? { conditions: currentTerms.data.conditions }
                  : {}),
              },
            }
          : {}
        ),
        paymentConditions:
          'Payment schedule and method are not specified. This record does not authorize or process payment.',
        deliveryConditions:
          `Delivery is expected within ${currentTerms.data.deliveryDays} calendar days after all required approvals. MandatePay does not monitor delivery.`,
        expiresAt,
        terminationConditions:
          'This record does not determine legal termination rights. Any termination agreement must be documented separately.',
      });
      if (!termsResult.success) {
        throw new ContractError(409, 'INVALID_CONTRACT_TERMS', 'Accepted terms cannot be represented as a contract.');
      }
      const terms = termsResult.data;
      assertContractTermsAuthorized(
        [initiatorMandate, recipientMandate] as [StoredData, StoredData],
        [initiatorAgent, recipientAgent] as [StoredData, StoredData],
        [initiatorId, recipientId],
        terms,
        terms.amountMinor,
        'contract.create',
        now,
        contractReservationUsageWindowKeys(negotiation.reservationUsageWindowKeys),
      );

      const participantIds = [...new Set([
        initiatorOwnerId, initiatorId, recipientOwnerId, recipientId,
      ])];
      if (!participantIds.includes(authentication.user.uid)) {
        throw new ContractError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
      }
      const timestamp = getServerTimestamp();
      const versionContent = {
        contractId: negotiationId,
        version: 1,
        previousVersionId: null,
        negotiationId,
        amendmentId: null,
        createdBy: authentication.user.uid,
        terms,
      };
      transaction.create(versionRef, {
        ...versionContent,
        createdAt: timestamp,
        ...contractVersionMetadata(versionContent),
      });
      transaction.create(contractRef, {
        negotiationId,
        participantIds,
        requiredApproverIds: participantIds,
        mandateIds: [initiatorMandateId, recipientMandateId],
        reservationUsageWindowKeys: negotiation.reservationUsageWindowKeys ?? null,
        status: 'pending_review',
        currentVersion: 1,
        currentVersionId: versionRef.id,
        activeAmendmentId: null,
        approvals: [],
        rejectionReason: null,
        expiresAt: new Date(expiresAt),
        activatedAt: null,
        eventCount: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      writeContractEvent(transaction, contractRef, {
        sequence: 1,
        type: 'contract.generated',
        actorId: authentication.user.uid,
        versionId: versionRef.id,
        details: { negotiationId, amountMinor: terms.amountMinor, currency: terms.currency },
      });

      return {
        id: negotiationId,
        negotiationId,
        participantIds,
        requiredApproverIds: participantIds,
        mandateIds: [initiatorMandateId, recipientMandateId],
        reservationUsageWindowKeys: negotiation.reservationUsageWindowKeys ?? null,
        status: 'pending_review',
        currentVersion: 1,
        currentVersionId: versionRef.id,
        activeAmendmentId: null,
        approvals: [],
        rejectionReason: null,
        expiresAt: new Date(expiresAt),
        activatedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    });

    return apiSuccess(formatContract(result.id, result), 201);
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
}
