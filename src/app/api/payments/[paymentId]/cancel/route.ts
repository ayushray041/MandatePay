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
  voidPayPalAuthorization,
} from '@/lib/payments/paypal';
import { paymentCancelSchema } from '@/models/payment';

type RouteContext = { params: Promise<{ paymentId: string }> };
type StoredData = Record<string, unknown>;

async function releaseReservation(
  firestore: NonNullable<typeof adminFirestore>,
  transaction: FirebaseFirestore.Transaction,
  payment: StoredData,
): Promise<void> {
  const payerMandateId = payment.payerMandateId;
  const payeeMandateId = payment.payeeMandateId;
  const amountMinor = payment.amountMinor;
  if (
    typeof payerMandateId !== 'string'
    || typeof payeeMandateId !== 'string'
    || payerMandateId === payeeMandateId
    || typeof amountMinor !== 'number'
    || !Number.isSafeInteger(amountMinor)
    || amountMinor <= 0
  ) {
    throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment mandate reservation references are invalid.');
  }
  const payerRef = firestore.collection('mandates').doc(payerMandateId);
  const payeeRef = firestore.collection('mandates').doc(payeeMandateId);
  const [payerSnapshot, payeeSnapshot] = await Promise.all([
    transaction.get(payerRef),
    transaction.get(payeeRef),
  ]);
  const payer = payerSnapshot.data();
  const payee = payeeSnapshot.data();
  if (
    !payerSnapshot.exists
    || !payeeSnapshot.exists
    || !payer
    || !payee
    || payer.ownerId !== payment.payerId
    || payee.ownerId !== payment.payeeId
  ) {
    throw new PaymentError(409, 'MANDATE_UNAVAILABLE', 'Payment mandates are unavailable.');
  }
  const payerReserved = payer.reservedAmountMinor ?? 0;
  const payeeReserved = payee.reservedAmountMinor ?? 0;
  if (
    typeof payerReserved !== 'number'
    || typeof payeeReserved !== 'number'
    || !Number.isSafeInteger(payerReserved)
    || !Number.isSafeInteger(payeeReserved)
    || payerReserved < amountMinor
    || payeeReserved < amountMinor
  ) {
    throw new PaymentError(409, 'INVALID_RESERVATION', 'Payment reservation cannot be released safely.');
  }
  const timestamp = getServerTimestamp();
  transaction.update(payerRef, {
    reservedAmountMinor: payerReserved - amountMinor,
    updatedAt: timestamp,
  });
  transaction.update(payeeRef, {
    reservedAmountMinor: payeeReserved - amountMinor,
    updatedAt: timestamp,
  });
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
    return apiError(400, 'INVALID_JSON', 'Cancellation request must be valid JSON.');
  }
  const parsed = paymentCancelSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'A cancellation reason is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }

  const { paymentId } = await context.params;
  const firestore = adminFirestore;
  const paymentRef = firestore.collection('payments').doc(paymentId);
  const uid = authentication.user.uid;
  let authorizationId: string | null = null;
  let attempt = 0;
  let alreadyCancelled: StoredData | null = null;
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
        throw new PaymentError(403, 'FORBIDDEN', 'Only the approved client account can cancel this payment.');
      }
      if (payment.status === 'cancelled') {
        alreadyCancelled = payment;
        return payment;
      }
      if (payment.status === 'completed' || payment.status === 'refunded') {
        throw new PaymentError(409, 'PAYMENT_NOT_CANCELLABLE', 'Completed payments cannot be cancelled.');
      }
      if (
        payment.status === 'processing'
        && payment.pendingOperation !== 'cancel'
      ) {
        throw new PaymentError(409, 'PAYMENT_OPERATION_IN_PROGRESS', 'Another payment operation is still processing.');
      }
      const hasAuthorization =
        typeof payment.providerAuthorizationId === 'string'
        && payment.providerAuthorizationId.length > 0;
      const hasProviderOrder =
        typeof payment.providerOrderId === 'string'
        && payment.providerOrderId.length > 0;
      if (
        hasProviderOrder
        && !hasAuthorization
        && payment.failureCode !== 'PAYMENT_AUTHORIZATION_DENIED'
      ) {
        throw new PaymentError(
          409,
          'PAYMENT_ORDER_CANCELLATION_UNAVAILABLE',
          'An unapproved provider order cannot be safely cancelled yet. Complete or decline checkout before releasing its reservation.',
        );
      }
      if (hasAuthorization && !isPayPalConfigured()) {
        throw new PaymentError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Sandbox payment provider is not configured.');
      }
      if (!hasAuthorization) {
        await releaseReservation(firestore, transaction, payment);
        const eventCount = Number(payment.eventCount);
        if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
          throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
        }
        const timestamp = getServerTimestamp();
        transaction.update(paymentRef, {
          status: 'cancelled',
          pendingOperation: null,
          cancelledAt: timestamp,
          failureCode: null,
          cancellationReason: parsed.data.reason,
          eventCount: eventCount + 1,
          updatedAt: timestamp,
        });
        writePaymentEvent(firestore, transaction, paymentRef, {
          sequence: eventCount + 1,
          type: 'payment.cancelled',
          source: 'api',
          actorId: uid,
          details: { reason: parsed.data.reason },
        });
        return {
          ...payment,
          status: 'cancelled',
          pendingOperation: null,
          cancelledAt: new Date(),
          eventCount: eventCount + 1,
          updatedAt: new Date(),
        };
      }

      const attempts = payment.attempts;
      if (typeof attempts !== 'object' || attempts === null) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const previousAttempt = Number((attempts as StoredData).cancel);
      if (!Number.isSafeInteger(previousAttempt) || previousAttempt < 0) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const retrying = payment.status === 'processing';
      attempt = retrying ? previousAttempt : previousAttempt + 1;
      authorizationId = String(payment.providerAuthorizationId);
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      transaction.update(paymentRef, {
        status: 'processing',
        pendingOperation: 'cancel',
        attempts: { ...attempts, cancel: attempt },
        failureCode: null,
        eventCount: eventCount + 1,
        updatedAt: getServerTimestamp(),
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: retrying ? 'payment.retry_started' : 'payment.cancel_started',
        source: 'api',
        actorId: uid,
        details: { operation: 'cancel' },
      });
      return {
        ...payment,
        status: 'processing',
        pendingOperation: 'cancel',
        attempts: { ...attempts, cancel: attempt },
      };
    });

    if (alreadyCancelled) {
      return apiSuccess(formatPayment(paymentId, alreadyCancelled));
    }
    if (!authorizationId) {
      return apiSuccess(formatPayment(paymentId, current));
    }
    await voidPayPalAuthorization({
      paymentId,
      authorizationId,
      attempt,
      paymentCycle: String(current.idempotencyKeyHash),
    });
    const cancelled = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(paymentRef);
      const payment = snapshot.data();
      if (!snapshot.exists || !payment) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
      }
      if (payment.status === 'cancelled') {
        return payment;
      }
      if (payment.status !== 'processing' || payment.pendingOperation !== 'cancel') {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed during provider cancellation.');
      }
      await releaseReservation(firestore, transaction, payment);
      const eventCount = Number(payment.eventCount);
      const timestamp = getServerTimestamp();
      transaction.update(paymentRef, {
        status: 'cancelled',
        pendingOperation: null,
        cancelledAt: timestamp,
        cancellationReason: parsed.data.reason,
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: 'payment.cancelled',
        source: 'api',
        actorId: uid,
        details: { reason: parsed.data.reason, providerAuthorizationId: authorizationId },
      });
      return {
        ...payment,
        status: 'cancelled',
        pendingOperation: null,
        cancelledAt: new Date(),
        eventCount: eventCount + 1,
        updatedAt: new Date(),
      };
    });
    return apiSuccess(formatPayment(paymentId, cancelled));
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      return apiError(502, error.code, error.message);
    }
    return paymentErrorResponse(error);
  }
}
