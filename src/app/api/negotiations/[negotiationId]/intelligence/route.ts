import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { createAiProvider } from '@/lib/ai/gemini';
import { aiErrorResponse, AiRequestError } from '@/lib/ai/errors';
import { recommendNegotiation, assessOffer } from '@/lib/ai/negotiation-recommendation';
import { compareNegotiationOffers } from '@/lib/ai/offer-comparison';
import { summarizeNegotiationHistory } from '@/lib/ai/negotiation-summary';
import { assertNegotiationParticipant, isNegotiationExpired, isNegotiationTerminal } from '@/lib/negotiations/policy';
import { NegotiationError } from '@/lib/negotiations/errors';
import { negotiationIntelligenceRequestSchema, mandateExplanationResponseSchema } from '@/models/ai';
import { negotiationOfferTermsSchema } from '@/models/negotiation';
import type { NegotiationOfferTerms } from '@/models/negotiation';

type RouteContext = { params: Promise<{ negotiationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Negotiation storage is unavailable.');
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = negotiationIntelligenceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', 'The negotiation intelligence request is invalid.', parsed.error.flatten());
  }

  const { negotiationId } = await context.params;
  try {
    const firestore = adminFirestore;
    const negotiationRef = firestore.collection('negotiations').doc(negotiationId);
    const negotiationSnapshot = await negotiationRef.get();
    const negotiation = negotiationSnapshot.data();
    if (!negotiationSnapshot.exists || !negotiation) {
      return apiError(404, 'NEGOTIATION_NOT_FOUND', 'Negotiation was not found.');
    }
    const perspective = assertNegotiationParticipant(negotiation, authentication.user.uid);
    if (
      parsed.data.action !== 'summarize'
      && (isNegotiationTerminal(negotiation.status) || isNegotiationExpired(negotiation, new Date()))
    ) {
      throw new AiRequestError(409, 'NEGOTIATION_CLOSED', 'Intelligence is unavailable for a closed or expired negotiation.');
    }

    if (parsed.data.action === 'summarize') {
      const [offersSnapshot, eventsSnapshot] = await Promise.all([
        negotiationRef.collection('offers').orderBy('sequence', 'asc').limitToLast(30).get(),
        negotiationRef.collection('events').orderBy('sequence', 'asc').limitToLast(50).get(),
      ]);
      const offers = offersSnapshot.docs.map((offerSnapshot) => {
        const data = offerSnapshot.data();
        const terms = negotiationOfferTermsSchema.parse(data.terms);
        const submitterId = String(data.submittedByAgentId);
        if (![negotiation.initiatorAgentId, negotiation.recipientAgentId].includes(submitterId)) {
          throw new AiRequestError(500, 'INVALID_NEGOTIATION_HISTORY', 'Negotiation offer history is inconsistent.');
        }
        return {
          sequence: Number(data.sequence),
          submittedByAgentId: submitterId,
          terms,
        };
      });
      const events = eventsSnapshot.docs.map((eventSnapshot) => {
        const data = eventSnapshot.data();
        const agentActorId = typeof data.actorAgentId === 'string' ? data.actorAgentId : null;
        const ownerActorId = typeof data.actorOwnerId === 'string' ? data.actorOwnerId : null;
        if ((agentActorId === null) === (ownerActorId === null)) {
          throw new AiRequestError(500, 'INVALID_NEGOTIATION_HISTORY', 'Negotiation event actor is invalid.');
        }
        const actorId = agentActorId
          ?? (ownerActorId ? 'mandate_owner' : '');
        const validAgentActor = actorId === 'mandate_owner'
          || [negotiation.initiatorAgentId, negotiation.recipientAgentId].includes(actorId);
        const validOwnerActor = ownerActorId === null
          || (Array.isArray(negotiation.requiredOwnerApprovalIds)
            && negotiation.requiredOwnerApprovalIds.includes(ownerActorId));
        if (!validAgentActor || !validOwnerActor) {
          throw new AiRequestError(500, 'INVALID_NEGOTIATION_HISTORY', 'Negotiation event history is inconsistent.');
        }
        return {
          sequence: Number(data.sequence),
          type: String(data.type),
          actorId,
          ...(typeof data.details?.reason === 'string' ? { reason: data.details.reason } : {}),
        };
      });
      const totalOffers = Number(negotiation.offerCount);
      const totalEvents = Number(negotiation.eventCount);
      if (!Number.isSafeInteger(totalOffers) || totalOffers < offers.length
        || !Number.isSafeInteger(totalEvents) || totalEvents < events.length) {
        throw new AiRequestError(500, 'INVALID_NEGOTIATION_HISTORY', 'Negotiation history counts are inconsistent.');
      }
      return apiSuccess(await summarizeNegotiationHistory(createAiProvider(), {
        offers,
        events,
        agentId: authentication.user.uid,
        status: String(negotiation.status),
        totalOffers,
        totalEvents,
      }));
    }

    const ownMandateId = perspective === 'initiator'
      ? negotiation.initiatorMandateId
      : negotiation.recipientMandateId;
    if (typeof ownMandateId !== 'string' || !ownMandateId) {
      throw new AiRequestError(409, 'MANDATE_REQUIRED', 'Select an authorized mandate before requesting a recommendation.');
    }

    const [mandateSnapshot, agentSnapshot, offersSnapshot] = await Promise.all([
      firestore.collection('mandates').doc(ownMandateId).get(),
      firestore.collection('agents').doc(authentication.user.uid).get(),
      negotiationRef.collection('offers').orderBy('sequence', 'asc').limitToLast(20).get(),
    ]);
    const mandate = mandateSnapshot.data();
    const agent = agentSnapshot.data();
    if (!mandateSnapshot.exists || !mandate || !agentSnapshot.exists || !agent) {
      throw new AiRequestError(409, 'AGENT_OR_MANDATE_UNAVAILABLE', 'An authorized agent profile and mandate are required.');
    }

    if (parsed.data.action === 'explain_violation') {
      const assessment = assessOffer(
        mandate,
        agent,
        authentication.user.uid,
        parsed.data.terms,
        new Date(),
      );
      return apiSuccess(mandateExplanationResponseSchema.parse({
        action: 'explain_violation',
        source: 'deterministic',
        mandateAssessment: assessment,
      }));
    }

    const offers = offersSnapshot.docs.map((offerSnapshot) => {
      const data = offerSnapshot.data();
      const terms = negotiationOfferTermsSchema.parse(data.terms);
      return {
        sequence: Number(data.sequence),
        submittedByAgentId: String(data.submittedByAgentId),
        mandateId: String(data.mandateId),
        terms: terms as NegotiationOfferTerms,
      };
    });
    if (parsed.data.action === 'compare') {
      const validOffers = offers.filter((offer) => (
        (offer.submittedByAgentId === negotiation.initiatorAgentId
          && offer.mandateId === negotiation.initiatorMandateId)
        || (offer.submittedByAgentId === negotiation.recipientAgentId
          && offer.mandateId === negotiation.recipientMandateId)
      ));
      if (validOffers.length !== offers.length) {
        throw new AiRequestError(500, 'INVALID_NEGOTIATION_HISTORY', 'Negotiation offer history is inconsistent.');
      }
      const uniqueAgentIds = [...new Set(validOffers.map((offer) => offer.submittedByAgentId))];
      const uniqueMandateIds = [...new Set(validOffers.map((offer) => offer.mandateId))];
      const [agents, mandates] = await Promise.all([
        Promise.all(uniqueAgentIds.map(async (id) => [id, (await firestore.collection('agents').doc(id).get()).data() ?? null] as const)),
        Promise.all(uniqueMandateIds.map(async (id) => [id, (await firestore.collection('mandates').doc(id).get()).data() ?? null] as const)),
      ]);
      const agentById = new Map(agents);
      const mandateById = new Map(mandates);
      return apiSuccess(await compareNegotiationOffers(createAiProvider(), {
        offers: validOffers.map((offer) => ({
          ...offer,
          mandate: mandateById.get(offer.mandateId) ?? null,
          agent: agentById.get(offer.submittedByAgentId) ?? null,
        })),
        agentId: authentication.user.uid,
        now: new Date(),
      }));
    }

    const currentOffer = negotiation.currentOffer
      ? negotiationOfferTermsSchema.parse(negotiation.currentOffer.terms) as NegotiationOfferTerms
      : null;
    return apiSuccess(await recommendNegotiation(createAiProvider(), {
      mandate,
      agent,
      agentId: authentication.user.uid,
      currentTerms: currentOffer,
      offers,
      ownMandatePerspective: perspective,
      now: new Date(),
    }));
  } catch (error: unknown) {
    if (error instanceof NegotiationError) {
      return apiError(error.status, error.code, error.message);
    }
    return aiErrorResponse(error);
  }
}
