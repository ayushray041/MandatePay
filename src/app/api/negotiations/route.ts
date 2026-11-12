import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { formatNegotiation, formatNegotiationForViewer } from '@/lib/negotiations/format';
import { assertMandateActive } from '@/lib/negotiations/policy';
import { writeNegotiationSnapshot } from '@/lib/negotiations/versions';
import { negotiationCreateSchema } from '@/models/negotiation';

const maxNegotiationLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const uid = authentication.user.uid;
  try {
    const [initiated, received, ownerApprovals] = await Promise.all([
      adminFirestore.collection('negotiations')
        .where('initiatorAgentId', '==', uid)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get(),
      adminFirestore.collection('negotiations')
        .where('recipientAgentId', '==', uid)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get(),
      adminFirestore.collection('negotiations')
        .where('requiredOwnerApprovalIds', 'array-contains', uid)
        .limit(50)
        .get(),
    ]);
    const negotiations = new Map(
      [...initiated.docs, ...received.docs, ...ownerApprovals.docs].map((snapshot) => [
        snapshot.id,
        formatNegotiationForViewer(snapshot.id, snapshot.data(), uid),
      ]),
    );
    return apiSuccess([...negotiations.values()].sort((left, right) => (
      Date.parse(String(right.updatedAt ?? '')) - Date.parse(String(left.updatedAt ?? ''))
    )));
  } catch (error: unknown) {
    console.error('Failed to list agent negotiations.', error);
    return apiError(500, 'INTERNAL_ERROR', 'Negotiations could not be loaded.');
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
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  const parsed = negotiationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Negotiation request is invalid.');
  }
  const recipientAgentIds = parsed.data.recipientAgentIds
    ?? (parsed.data.recipientAgentId ? [parsed.data.recipientAgentId] : []);
  if (recipientAgentIds.length === 0) {
    return apiError(400, 'INVALID_RECIPIENT', 'At least one recipient agent is required.');
  }
  if (recipientAgentIds.includes(authentication.user.uid)) {
    return apiError(400, 'INVALID_RECIPIENT', 'An agent cannot negotiate with itself.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const now = new Date();
  const expiresAt = new Date(parsed.data.expiresAt);
  if (
    expiresAt.getTime() <= now.getTime()
    || expiresAt.getTime() > now.getTime() + maxNegotiationLifetimeMs
  ) {
    return apiError(
      400,
      'INVALID_EXPIRY',
      'Negotiation expiry must be in the future and within 30 days.',
    );
  }

  const firestore = adminFirestore;
  const uid = authentication.user.uid;
  const mandateRef = firestore.collection('mandates').doc(parsed.data.mandateId);
  const initiatorAgentRef = firestore.collection('agents').doc(uid);
  const recipientAgentRefs = recipientAgentIds.map((agentId) => firestore.collection('agents').doc(agentId));
  const negotiationRefs = recipientAgentIds.map(() => firestore.collection('negotiations').doc());
  const batchId = negotiationRefs[0].id;
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [mandateSnapshot, initiatorAgentSnapshot, ...recipientAgentSnapshots] =
        await Promise.all([
          transaction.get(mandateRef),
          transaction.get(initiatorAgentRef),
          ...recipientAgentRefs.map((reference) => transaction.get(reference)),
        ]);
      if (!mandateSnapshot.exists) {
        throw new NegotiationError(404, 'MANDATE_NOT_FOUND', 'Initiator mandate was not found.');
      }
      if (!initiatorAgentSnapshot.exists) {
        throw new NegotiationError(403, 'AGENT_NOT_REGISTERED', 'Register an agent profile before negotiating.');
      }
      if (recipientAgentSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new NegotiationError(404, 'RECIPIENT_NOT_FOUND', 'Recipient agent was not found.');
      }
      const mandate = mandateSnapshot.data();
      const initiatorAgent = initiatorAgentSnapshot.data();
      const recipientAgents = recipientAgentSnapshots.map((snapshot) => snapshot.data());
      if (!mandate) {
        throw new Error('Initiator mandate document has no data.');
      }
      assertMandateActive(mandate, uid, now);
      if (
        !initiatorAgent
        || !Array.isArray(initiatorAgent.supportedCurrencies)
        || !initiatorAgent.supportedCurrencies.includes(mandate.currency)
        || initiatorAgent.status !== 'active'
        || recipientAgents.some((recipientAgent) => (
          !recipientAgent
          || recipientAgent.status !== 'active'
          || !Array.isArray(recipientAgent.supportedCurrencies)
          || !recipientAgent.supportedCurrencies.includes(mandate.currency)
        ))
      ) {
        throw new NegotiationError(
          409,
          'CURRENCY_NOT_SUPPORTED',
          'Both agents must support the initiator mandate currency.',
        );
      }

      const timestamp = getServerTimestamp();
      return negotiationRefs.map((negotiationRef, index) => {
        const recipientAgentId = recipientAgentIds[index];
        const negotiation = {
          initiatorAgentId: uid,
          recipientAgentId,
          initiatorMandateId: parsed.data.mandateId,
          recipientMandateId: null,
          title: parsed.data.title,
          status: 'initiated',
          expiresAt,
          currentOfferId: null,
          currentOffer: null,
          offerCount: 0,
          eventCount: 1,
          version: 1,
          batchId,
          batchIndex: index,
          batchSize: recipientAgentIds.length,
          createdAt: timestamp,
          updatedAt: timestamp,
          acceptedAt: null,
          resolvedByAgentId: null,
          rejectionReason: null,
          acceptanceReason: null,
          lockedOfferId: null,
        };
        transaction.create(negotiationRef, negotiation);
        writeNegotiationEvent(transaction, negotiationRef, {
          sequence: 1,
          type: 'negotiation.created',
          actorAgentId: uid,
          details: {
            recipientAgentId,
            batchId,
            batchIndex: index,
            batchSize: recipientAgentIds.length,
          },
        });
        writeNegotiationSnapshot(transaction, negotiationRef, {
          version: 1,
          status: 'initiated',
          currentOfferId: null,
          currentOffer: null,
          offerCount: 0,
          updatedAt: timestamp,
          actorId: uid,
        });
        return {
          id: negotiationRef.id,
          ...negotiation,
          createdAt: now,
          updatedAt: now,
        };
      });
    });

    const formatted = result.map((negotiation) => formatNegotiation(negotiation.id, negotiation));
    return apiSuccess(
      formatted.length === 1
        ? formatted[0]
        : { batchId, negotiations: formatted },
      201,
    );
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
