import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writePaymentEvent } from '@/lib/payments/events';
import { PaymentError, paymentErrorResponse } from '@/lib/payments/errors';
import { formatPayment } from '@/lib/payments/format';
import {
  isPayPalConfigured,
  PaymentProviderError,
  refundPayPalCapture,
} from '@/lib/payments/paypal';
import { paymentRefundSchema } from '@/models/payment';

type RouteContext = { params: Promise<{ paymentId: string }> };
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
    return apiError(400, 'INVALID_JSON', 'Refund request must be valid JSON.');
  }
  const parsed = paymentRefundSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'A refund reason is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }
  if (!isPayPalConfigured()) {
    return apiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Sandbox payment provider is not configured.');
  }

  const { paymentId } = await context.params;
  const firestore = adminFirestore;
  const paymentRef = firestore.collection('payments').doc(paymentId);
  const uid = authentication.user.uid;
  let captureId = '';
  let attempt = 0;
  let alreadyRefunded: StoredData | null = null;
  try {
    const current = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(paymentRef);
      if (!snapshot.exists) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
      }
      const payment = snapshot.data();
      if (!payment || !Array.isArray(payment.participantIds) || !payment.participantIds.includes(uid)) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
      }
      if (payment.payerId !== uid) {
        throw new PaymentError(403, 'FORBIDDEN', 'Only the approved client account can request a refund.');
      }
      if (payment.status === 'refunded') {
        alreadyRefunded = payment;
        return payment;
      }
      const retrying =
        payment.status === 'processing' && payment.pendingOperation === 'refund';
      const retryingFailedRefund =
        payment.status === 'completed' && payment.failureCode === 'PAYMENT_REFUND_FAILED';
      if (payment.status !== 'completed' && !retrying && !retryingFailedRefund) {
        throw new PaymentError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a completed payment can be refunded.');
      }
      if (typeof payment.providerCaptureId !== 'string' || !payment.providerCaptureId) {
        throw new PaymentError(409, 'PAYMENT_CAPTURE_UNAVAILABLE', 'Provider capture is unavailable.');
      }
      const attempts = payment.attempts;
      if (typeof attempts !== 'object' || attempts === null) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const previousAttempt = Number((attempts as StoredData).refund);
      if (!Number.isSafeInteger(previousAttempt) || previousAttempt < 0) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      attempt = retrying ? previousAttempt : previousAttempt + 1;
      captureId = payment.providerCaptureId;
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      transaction.update(paymentRef, {
        status: 'processing',
        pendingOperation: 'refund',
        attempts: { ...attempts, refund: attempt },
        failureCode: null,
        eventCount: eventCount + 1,
        updatedAt: getServerTimestamp(),
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: retrying ? 'payment.retry_started' : 'payment.refund_started',
        source: 'api',
        actorId: uid,
        details: { operation: 'refund', reason: parsed.data.reason },
      });
      return {
        ...payment,
        status: 'processing',
        pendingOperation: 'refund',
        attempts: { ...attempts, refund: attempt },
      };
    });

    if (alreadyRefunded) {
      return apiSuccess(formatPayment(paymentId, alreadyRefunded));
    }

    const providerResult = await refundPayPalCapture({
      paymentId,
      captureId,
      reason: parsed.data.reason,
      attempt,
      paymentCycle: String(current.idempotencyKeyHash),
    });
    const finalized = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(paymentRef);
      const payment = snapshot.data();
      if (!snapshot.exists || !payment) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
      }
      if (payment.status === 'refunded') {
        return payment;
      }
      if (payment.status !== 'processing' || payment.pendingOperation !== 'refund') {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed during provider refund.');
      }
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      const timestamp = getServerTimestamp();
      const refunded = providerResult.status === 'COMPLETED';
      const failed = providerResult.status === 'FAILED';
      if (refunded) {
        const payerRef = firestore.collection('mandates').doc(String(payment.payerMandateId));
        const payerSnapshot = await transaction.get(payerRef);
        const payer = payerSnapshot.data();
        const spentAmountMinor = payer?.spentAmountMinor;
        if (
          !payerSnapshot.exists
          || payer?.ownerId !== payment.payerId
          || typeof spentAmountMinor !== 'number'
          || !Number.isSafeInteger(spentAmountMinor)
          || spentAmountMinor < Number(payment.amountMinor)
        ) {
          throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Refund cannot be reconciled with the mandate ledger.');
        }
        transaction.update(payerRef, {
          spentAmountMinor: spentAmountMinor - Number(payment.amountMinor),
          updatedAt: timestamp,
        });
      }
      const status = refunded ? 'refunded' : failed ? 'completed' : 'processing';
      transaction.update(paymentRef, {
        status,
        pendingOperation: refunded || failed ? null : 'refund',
        ...(!failed ? {
          providerRefundId: providerResult.refundId,
          ...(refunded ? { refundedAt: timestamp } : {}),
          failureCode: null,
        } : failed ? { failureCode: 'PAYMENT_REFUND_FAILED' } : {}),
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: refunded ? 'payment.refunded' : failed ? 'payment.failed' : 'payment.retry_started',
        source: 'api',
        actorId: uid,
        details: {
          operation: 'refund',
          providerRefundId: providerResult.refundId,
          providerStatus: providerResult.status,
        },
      });
      return {
        ...payment,
        status,
        pendingOperation: refunded || failed ? null : 'refund',
        ...(!failed ? {
          providerRefundId: providerResult.refundId,
          ...(refunded ? { refundedAt: new Date() } : {}),
          failureCode: null,
        } : failed ? { failureCode: 'PAYMENT_REFUND_FAILED' } : {}),
        eventCount: eventCount + 1,
        updatedAt: new Date(),
      };
    });
    return apiSuccess(formatPayment(paymentId, finalized), providerResult.status === 'PENDING' ? 202 : 200);
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      return apiError(502, error.code, error.message);
    }
    return paymentErrorResponse(error);
  }
}
