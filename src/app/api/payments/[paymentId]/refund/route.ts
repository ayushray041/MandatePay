import { createHash } from 'node:crypto';
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

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const maximumRefundOperations = 100;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function refundedAmount(payment: StoredData): number {
  const total = payment.amountMinor;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) {
    throw new PaymentError(500, 'INVALID_PAYMENT', 'Captured payment amount is invalid.');
  }
  if (payment.refundedAmountMinor === undefined) {
    return payment.status === 'refunded' ? total : 0;
  }
  const amount = payment.refundedAmountMinor;
  if (
    typeof amount !== 'number'
    || !Number.isSafeInteger(amount)
    || amount < 0
    || amount > total
  ) {
    throw new PaymentError(500, 'INVALID_PAYMENT', 'Cumulative refund amount is invalid.');
  }
  return amount;
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
    return apiError(400, 'INVALID_JSON', 'Refund request must be valid JSON.');
  }
  const parsed = paymentRefundSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'A valid refund reason and optional amount are required.');
  }
  const rawIdempotencyKey = request.headers.get('Idempotency-Key');
  if (!rawIdempotencyKey || !idempotencyKeyPattern.test(rawIdempotencyKey)) {
    return apiError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required.');
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
  const refundKeyHash = hash(`${uid}:${rawIdempotencyKey}`);
  const refundRef = paymentRef.collection('refunds').doc(refundKeyHash);
  let captureId = '';
  let attempt = 0;
  let amountMinor = 0;
  let capturedAmountMinor = 0;
  let currency = '';
  let paymentCycle = '';
  let alreadyRefunded: StoredData | null = null;

  try {
    const current = await firestore.runTransaction(async (transaction) => {
      const [snapshot, refundSnapshot] = await Promise.all([
        transaction.get(paymentRef),
        transaction.get(refundRef),
      ]);
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
        return { ...payment, shouldRequestProvider: false };
      }
      const refundCount = payment.refundCount === undefined ? 0 : payment.refundCount;
      if (typeof refundCount !== 'number' || !Number.isSafeInteger(refundCount) || refundCount < 0) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Refund operation count is invalid.');
      }

      const previousRefund = refundSnapshot.data();
      if (refundSnapshot.exists && !previousRefund) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Refund operation record is invalid.');
      }
      if (refundSnapshot.exists && previousRefund) {
        if (
          previousRefund.reason !== parsed.data.reason
          || (parsed.data.amountMinor !== undefined
            && previousRefund.amountMinor !== parsed.data.amountMinor)
        ) {
          throw new PaymentError(409, 'IDEMPOTENCY_KEY_REUSED', 'This refund key was already used with different details.');
        }
        if (previousRefund.status === 'completed') {
          alreadyRefunded = payment;
          return { ...payment, shouldRequestProvider: false };
        }
        if (previousRefund.status === 'failed') {
          throw new PaymentError(409, 'REFUND_FAILED', 'This refund failed; use a new idempotency key to retry.');
        }
        if (
          !['processing', 'pending'].includes(String(previousRefund.status))
          || payment.status !== 'processing'
          || payment.pendingOperation !== 'refund'
          || payment.pendingRefundId !== refundKeyHash
          || typeof previousRefund.amountMinor !== 'number'
          || !Number.isSafeInteger(previousRefund.amountMinor)
          || previousRefund.amountMinor <= 0
          || previousRefund.amountMinor > Number(payment.amountMinor)
          || previousRefund.currency !== payment.currency
          || payment.pendingRefundAmountMinor !== previousRefund.amountMinor
        ) {
          throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Refund operation is no longer active.');
        }
        amountMinor = previousRefund.amountMinor;
      } else {
        if (
          payment.status !== 'completed'
          && payment.status !== 'partially_refunded'
        ) {
          throw new PaymentError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only a provider-confirmed capture can be refunded.');
        }
        if (payment.pendingOperation !== null && payment.pendingOperation !== undefined) {
          throw new PaymentError(409, 'PAYMENT_OPERATION_IN_PROGRESS', 'Another payment operation is still processing.');
        }
        const total = payment.amountMinor;
        const alreadyRefundedMinor = refundedAmount(payment);
        if (
          !Number.isSafeInteger(total)
          || Number(total) <= 0
          || !Number.isSafeInteger(alreadyRefundedMinor)
          || alreadyRefundedMinor < 0
          || alreadyRefundedMinor >= Number(total)
        ) {
          throw new PaymentError(409, 'PAYMENT_NOT_REFUNDABLE', 'No refundable captured balance remains.');
        }
        const remainingAmountMinor = Number(total) - alreadyRefundedMinor;
        amountMinor = parsed.data.amountMinor ?? remainingAmountMinor;
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > remainingAmountMinor) {
          throw new PaymentError(409, 'REFUND_AMOUNT_EXCEEDS_BALANCE', 'Refund amount exceeds the remaining captured balance.');
        }
        if (refundCount >= maximumRefundOperations) {
          throw new PaymentError(409, 'REFUND_OPERATION_LIMIT', 'This payment has reached its refund operation limit.');
        }
      }

      if (
        typeof payment.providerCaptureId !== 'string'
        || !payment.providerCaptureId
        || typeof payment.currency !== 'string'
        || typeof payment.amountMinor !== 'number'
        || !Number.isSafeInteger(payment.amountMinor)
      ) {
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
      const retrying = refundSnapshot.exists;
      attempt = retrying ? previousAttempt : previousAttempt + 1;
      captureId = payment.providerCaptureId;
      capturedAmountMinor = Number(payment.amountMinor);
      currency = payment.currency;
      paymentCycle = String(payment.idempotencyKeyHash ?? '');
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      const timestamp = getServerTimestamp();
      transaction.update(paymentRef, {
        status: 'processing',
        pendingOperation: 'refund',
        refundCount: refundCount + (refundSnapshot.exists ? 0 : 1),
        pendingRefundId: refundKeyHash,
        pendingRefundAmountMinor: amountMinor,
        attempts: { ...attempts, refund: attempt },
        failureCode: null,
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      if (refundSnapshot.exists) {
        transaction.update(refundRef, { status: 'processing', updatedAt: timestamp });
      } else {
        transaction.create(refundRef, {
          amountMinor,
          currency,
          reason: parsed.data.reason,
          status: 'processing',
          providerRefundId: null,
          createdBy: uid,
          createdAt: timestamp,
          completedAt: null,
        });
      }
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: retrying ? 'payment.retry_started' : 'payment.refund_started',
        source: 'api',
        actorId: uid,
        details: { operation: 'refund', amountMinor },
      });
      return {
        ...payment,
        status: 'processing',
        pendingOperation: 'refund',
        shouldRequestProvider: true,
      };
    });

    if (alreadyRefunded || !current.shouldRequestProvider) {
      return apiSuccess(formatPayment(paymentId, alreadyRefunded ?? current));
    }

    const providerResult = await refundPayPalCapture({
      paymentId,
      captureId,
      amountMinor,
      capturedAmountMinor,
      currency,
      reason: parsed.data.reason,
      refundKeyHash,
      paymentCycle,
    });
    const providerRefundRef = paymentRef.collection('providerRefunds').doc(hash(providerResult.refundId));
    const finalized = await firestore.runTransaction(async (transaction) => {
      const [snapshot, refundSnapshot, providerRefundSnapshot] = await Promise.all([
        transaction.get(paymentRef),
        transaction.get(refundRef),
        transaction.get(providerRefundRef),
      ]);
      const payment = snapshot.data();
      const refund = refundSnapshot.data();
      if (!snapshot.exists || !payment || !refund) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment refund record was not found.');
      }
      const appliedProviderRefund = providerRefundSnapshot.data();
      if (refund.status === 'completed' || appliedProviderRefund?.status === 'completed') {
        if (
          refund.providerRefundId !== providerResult.refundId
          || (appliedProviderRefund && (
            appliedProviderRefund.refundKeyHash !== refundKeyHash
            || appliedProviderRefund.amountMinor !== amountMinor
            || appliedProviderRefund.currency !== currency
          ))
        ) {
          throw new PaymentError(409, 'PROVIDER_REFUND_CONFLICT', 'Provider refund confirmation conflicts with the recorded operation.');
        }
        return payment;
      }
      if (
        payment.status !== 'processing'
        || payment.pendingOperation !== 'refund'
        || payment.pendingRefundId !== refundKeyHash
        || Number(refund.amountMinor) !== amountMinor
      ) {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed during provider refund.');
      }
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      const timestamp = getServerTimestamp();
      const completed = providerResult.status === 'COMPLETED';
      const failed = providerResult.status === 'FAILED';
      const totalRefunded = refundedAmount(payment) + amountMinor;
      if (!Number.isSafeInteger(totalRefunded) || totalRefunded > Number(payment.amountMinor)) {
        throw new PaymentError(409, 'INVALID_REFUND_TOTAL', 'Cumulative refunds exceed the captured payment.');
      }
      if (providerRefundSnapshot.exists) {
        const existingOperation = providerRefundSnapshot.data()?.refundKeyHash;
        if (existingOperation !== refundKeyHash) {
          throw new PaymentError(409, 'PROVIDER_REFUND_CONFLICT', 'Provider refund is already associated with another operation.');
        }
      }
      if (completed) {
        const payerRef = firestore.collection('mandates').doc(String(payment.payerMandateId));
        const payerSnapshot = await transaction.get(payerRef);
        const payer = payerSnapshot.data();
        const spentAmountMinor = payer?.spentAmountMinor;
        if (
          !payerSnapshot.exists
          || payer?.ownerId !== payment.payerId
          || typeof spentAmountMinor !== 'number'
          || !Number.isSafeInteger(spentAmountMinor)
          || spentAmountMinor < amountMinor
        ) {
          throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Refund cannot be reconciled with the mandate ledger.');
        }
        transaction.update(payerRef, {
          spentAmountMinor: spentAmountMinor - amountMinor,
          updatedAt: timestamp,
        });
      }
      const status = completed
        ? totalRefunded === Number(payment.amountMinor) ? 'refunded' : 'partially_refunded'
        : failed
          ? totalRefunded > 0 ? 'partially_refunded' : 'completed'
          : 'processing';
      transaction.update(paymentRef, {
        status,
        pendingOperation: completed || failed ? null : 'refund',
        pendingRefundId: completed || failed ? null : refundKeyHash,
        pendingRefundAmountMinor: completed || failed ? null : amountMinor,
        refundedAmountMinor: completed ? totalRefunded : refundedAmount(payment),
        providerRefundId: providerResult.refundId,
        ...(completed && status === 'refunded' ? { refundedAt: timestamp } : {}),
        failureCode: failed ? 'PAYMENT_REFUND_FAILED' : null,
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      transaction.update(refundRef, {
        status: completed ? 'completed' : failed ? 'failed' : 'pending',
        providerRefundId: providerResult.refundId,
        ...(completed ? { completedAt: timestamp } : {}),
        updatedAt: timestamp,
      });
      if (providerRefundSnapshot.exists) {
        transaction.update(providerRefundRef, {
          status: completed ? 'completed' : failed ? 'failed' : 'pending',
          refundKeyHash,
          amountMinor,
          currency,
          updatedAt: timestamp,
        });
      } else {
        transaction.create(providerRefundRef, {
          status: completed ? 'completed' : failed ? 'failed' : 'pending',
          refundKeyHash,
          amountMinor,
          currency,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: completed
          ? status === 'refunded' ? 'payment.refunded' : 'payment.partially_refunded'
          : failed ? 'payment.failed' : 'payment.refund_pending',
        source: 'api',
        actorId: uid,
        details: {
          operation: 'refund',
          providerRefundId: providerResult.refundId,
          providerStatus: providerResult.status,
          amountMinor,
        },
      });
      return {
        ...payment,
        status,
        pendingOperation: completed || failed ? null : 'refund',
        refundedAmountMinor: completed ? totalRefunded : refundedAmount(payment),
        providerRefundId: providerResult.refundId,
        ...(completed && status === 'refunded' ? { refundedAt: new Date() } : {}),
        failureCode: failed ? 'PAYMENT_REFUND_FAILED' : null,
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
