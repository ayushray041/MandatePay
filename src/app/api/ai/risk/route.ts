import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { AiRequestError, aiErrorResponse } from '@/lib/ai/errors';
import { recordAiDecision } from '@/lib/ai/history';
import {
  assessAgentBehavior,
  assessPaymentAnomaly,
  assessVendorRisk,
  forecastSpending,
} from '@/lib/ai/risk';
import { formatPayment } from '@/lib/payments/format';
import { timestampToIso } from '@/lib/mandates/format';
import { paymentRecordSchema } from '@/models/payment';
import { aiRiskRequestSchema } from '@/models/ai';
import type { AiRiskAssessment } from '@/models/ai';
import type { PaymentRecord } from '@/models/payment';

async function loadCallerPayments(uid: string): Promise<PaymentRecord[]> {
  if (!adminFirestore) {
    throw new AiRequestError(503, 'SERVICE_UNAVAILABLE', 'Payment history is unavailable.');
  }
  const snapshot = await adminFirestore.collection('payments')
    .where('participantIds', 'array-contains', uid)
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  return snapshot.docs.map((document) => (
    paymentRecordSchema.parse(formatPayment(document.id, document.data()))
  ));
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'AI risk storage is unavailable.');
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = aiRiskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'AI risk request is invalid.');
  }

  const uid = authentication.user.uid;
  const riskRequest = parsed.data;
  try {
    let assessment: AiRiskAssessment;
    let resourceType: 'payment' | 'agent';
    let resourceId: string;

    if (riskRequest.action === 'agent_behavior') {
      const agentSnapshot = await adminFirestore.collection('agents').doc(uid).get();
      const agent = agentSnapshot.data();
      if (!agentSnapshot.exists || !agent || typeof agent.agentId !== 'string') {
        throw new AiRequestError(404, 'AGENT_NOT_FOUND', 'No agent profile is associated with this account.');
      }
      const activity = await adminFirestore.collection('agentActivity')
        .where('ownerId', '==', uid)
        .where('agentId', '==', agent.agentId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      assessment = assessAgentBehavior(activity.docs.map((document) => {
        const event = document.data();
        return {
          action: String(event.action ?? ''),
          createdAt: timestampToIso(event.createdAt),
        };
      }), new Date());
      resourceType = 'agent';
      resourceId = agent.agentId;
    } else {
      const payments = await loadCallerPayments(uid);
      if (riskRequest.action === 'payment_anomaly') {
        const payment = payments.find(({ id }) => id === riskRequest.paymentId);
        if (!payment || !payment.participantIds.includes(uid)) {
          throw new AiRequestError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
        }
        assessment = assessPaymentAnomaly(payments, payment.id, new Date());
        resourceType = 'payment';
        resourceId = payment.id;
      } else if (riskRequest.action === 'spending_forecast') {
        assessment = forecastSpending(payments, new Date(), riskRequest.currency);
        resourceType = 'payment';
        resourceId = `forecast:${riskRequest.currency}`;
      } else {
        const vendorPayments = payments.filter(({ payeeId }) => payeeId === riskRequest.vendorId);
        if (vendorPayments.length === 0) {
          throw new AiRequestError(
            404,
            'VENDOR_HISTORY_NOT_FOUND',
            'No payment history for this vendor is available to this account.',
          );
        }
        assessment = assessVendorRisk(payments, riskRequest.vendorId, riskRequest.currency);
        resourceType = 'agent';
        resourceId = riskRequest.vendorId;
      }
    }

    await recordAiDecision({
      userId: uid,
      action: assessment.action,
      resourceType,
      resourceId,
      source: 'deterministic',
      providerId: null,
      modelVersion: 'rules-v1',
      promptVersion: 'rules-v1',
      confidenceScore: assessment.confidence.score,
      confidenceMethod: 'sample_size_heuristic',
      requiresHumanReview: assessment.requiresHumanReview,
      evidence: [{
        type: 'server_history',
        reference: resourceId,
        sampleSize: assessment.evidence.sampleSize,
      }],
      result: assessment,
    });
    return apiSuccess(assessment);
  } catch (error: unknown) {
    if (error instanceof AiRequestError) {
      return apiError(error.status, error.code, error.message);
    }
    return aiErrorResponse(error);
  }
}
