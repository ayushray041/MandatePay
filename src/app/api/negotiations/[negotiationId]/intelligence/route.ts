import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { createAiProvider } from '@/lib/ai/gemini';
import { aiErrorResponse, AiRequestError } from '@/lib/ai/errors';
import { recommendNegotiation, assessOffer } from '@/lib/ai/negotiation-recommendation';
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
    if (isNegotiationTerminal(negotiation.status) || isNegotiationExpired(negotiation, new Date())) {
      throw new AiRequestError(409, 'NEGOTIATION_CLOSED', 'Intelligence is unavailable for a closed or expired negotiation.');
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
        terms: terms as NegotiationOfferTerms,
      };
    });
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
