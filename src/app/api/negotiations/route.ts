import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { NegotiationError, negotiationErrorResponse } from '@/lib/negotiations/errors';
import { writeNegotiationEvent } from '@/lib/negotiations/events';
import { formatNegotiation } from '@/lib/negotiations/format';
import { assertMandateActive } from '@/lib/negotiations/policy';
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
    const [initiated, received] = await Promise.all([
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
    ]);
    const negotiations = new Map(
      [...initiated.docs, ...received.docs].map((snapshot) => [
        snapshot.id,
        formatNegotiation(snapshot.id, snapshot.data()),
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
  if (parsed.data.recipientAgentId === authentication.user.uid) {
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
  const recipientAgentRef = firestore.collection('agents').doc(parsed.data.recipientAgentId);
  const negotiationRef = firestore.collection('negotiations').doc();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const [mandateSnapshot, initiatorAgentSnapshot, recipientAgentSnapshot] =
        await Promise.all([
          transaction.get(mandateRef),
          transaction.get(initiatorAgentRef),
          transaction.get(recipientAgentRef),
        ]);
      if (!mandateSnapshot.exists) {
        throw new NegotiationError(404, 'MANDATE_NOT_FOUND', 'Initiator mandate was not found.');
      }
      if (!initiatorAgentSnapshot.exists) {
        throw new NegotiationError(403, 'AGENT_NOT_REGISTERED', 'Register an agent profile before negotiating.');
      }
      if (!recipientAgentSnapshot.exists) {
        throw new NegotiationError(404, 'RECIPIENT_NOT_FOUND', 'Recipient agent was not found.');
      }
      const mandate = mandateSnapshot.data();
      const initiatorAgent = initiatorAgentSnapshot.data();
      const recipientAgent = recipientAgentSnapshot.data();
      if (!mandate) {
        throw new Error('Initiator mandate document has no data.');
      }
      assertMandateActive(mandate, uid, now);
      if (
        !initiatorAgent
        || !Array.isArray(initiatorAgent.supportedCurrencies)
        || !initiatorAgent.supportedCurrencies.includes(mandate.currency)
        || !recipientAgent
        || !Array.isArray(recipientAgent.supportedCurrencies)
        || !recipientAgent.supportedCurrencies.includes(mandate.currency)
      ) {
        throw new NegotiationError(
          409,
          'CURRENCY_NOT_SUPPORTED',
          'Both agents must support the initiator mandate currency.',
        );
      }

      const timestamp = getServerTimestamp();
      transaction.create(negotiationRef, {
        initiatorAgentId: uid,
        recipientAgentId: parsed.data.recipientAgentId,
        initiatorMandateId: parsed.data.mandateId,
        recipientMandateId: null,
        title: parsed.data.title,
        status: 'initiated',
        expiresAt,
        currentOfferId: null,
        currentOffer: null,
        offerCount: 0,
        eventCount: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        acceptedAt: null,
        resolvedByAgentId: null,
        rejectionReason: null,
      });
      writeNegotiationEvent(transaction, negotiationRef, {
        sequence: 1,
        type: 'negotiation.created',
        actorAgentId: uid,
        details: { recipientAgentId: parsed.data.recipientAgentId },
      });

      return {
        id: negotiationRef.id,
        initiatorAgentId: uid,
        recipientAgentId: parsed.data.recipientAgentId,
        initiatorMandateId: parsed.data.mandateId,
        recipientMandateId: null,
        title: parsed.data.title,
        status: 'initiated',
        expiresAt,
        currentOfferId: null,
        currentOffer: null,
        offerCount: 0,
        eventCount: 1,
        createdAt: now,
        updatedAt: now,
        acceptedAt: null,
        resolvedByAgentId: null,
        rejectionReason: null,
      };
    });

    return apiSuccess(formatNegotiation(result.id, result), 201);
  } catch (error: unknown) {
    return negotiationErrorResponse(error);
  }
}
