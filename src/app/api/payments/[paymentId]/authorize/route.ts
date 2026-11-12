import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import {
  assertPaymentMatchesContract,
  loadContractPaymentContext,
} from '@/lib/payments/context';
import { writePaymentEvent } from '@/lib/payments/events';
import { PaymentError, paymentErrorResponse } from '@/lib/payments/errors';
import { formatPayment } from '@/lib/payments/format';
import {
  authorizePayPalOrder,
  isPayPalConfigured,
  PaymentProviderError,
} from '@/lib/payments/paypal';

type RouteContext = { params: Promise<{ paymentId: string }> };
type StoredData = Record<string, unknown>;

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
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
  const now = new Date();
  let attempt = 0;
  let orderId = '';
  let alreadyAuthorized: StoredData | null = null;

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
        throw new PaymentError(403, 'FORBIDDEN', 'Only the approved client account can authorize this payment.');
      }
      if (
        payment.status === 'authorized'
        || payment.status === 'completed'
        || payment.status === 'partially_refunded'
        || payment.status === 'refunded'
      ) {
        alreadyAuthorized = payment;
        return payment;
      }
      if (
        payment.status !== 'pending'
        && !(payment.status === 'processing' && payment.pendingOperation === 'authorize')
        && !(
          payment.status === 'failed'
          && payment.providerOrderId
          && !payment.providerAuthorizationId
          && payment.failureCode !== 'PAYMENT_AUTHORIZATION_DENIED'
        )
      ) {
        throw new PaymentError(409, 'PAYMENT_NOT_AUTHORIZABLE', 'Payment is not ready for provider authorization.');
      }
      if (typeof payment.providerOrderId !== 'string' || !payment.providerOrderId) {
        throw new PaymentError(409, 'PAYMENT_ORDER_UNAVAILABLE', 'Sandbox payment order is unavailable.');
      }
      const contractContext = await loadContractPaymentContext(
        firestore,
        transaction,
        String(payment.contractId),
        uid,
        now,
      );
      assertPaymentMatchesContract(payment, contractContext, uid, now);
      const attempts = payment.attempts;
      if (typeof attempts !== 'object' || attempts === null) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const previousAttempt = Number((attempts as StoredData).authorize);
      if (!Number.isSafeInteger(previousAttempt) || previousAttempt < 0) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const retrying = payment.status === 'processing';
      attempt = retrying ? previousAttempt : previousAttempt + 1;
      orderId = payment.providerOrderId;
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      transaction.update(paymentRef, {
        status: 'processing',
        pendingOperation: 'authorize',
        attempts: { ...attempts, authorize: attempt },
        failureCode: null,
        eventCount: eventCount + 1,
        updatedAt: getServerTimestamp(),
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: retrying ? 'payment.retry_started' : 'payment.authorization_started',
        source: 'api',
        actorId: uid,
        details: { operation: 'authorize' },
      });
      return {
        ...payment,
        status: 'processing',
        pendingOperation: 'authorize',
        attempts: { ...attempts, authorize: attempt },
        eventCount: eventCount + 1,
      };
    });

    if (alreadyAuthorized) {
      return apiSuccess(formatPayment(paymentId, alreadyAuthorized));
    }

    const providerResult = await authorizePayPalOrder({
      paymentId,
      orderId,
      amountMinor: Number(current.amountMinor),
      currency: String(current.currency),
      attempt,
      paymentCycle: String(current.idempotencyKeyHash),
    });
    const finalized = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(paymentRef);
      const payment = snapshot.data();
      if (!snapshot.exists || !payment) {
        throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
      }
      if (payment.providerAuthorizationId === providerResult.authorizationId && payment.status === 'authorized') {
        return payment;
      }
      const contractContext = await loadContractPaymentContext(
        firestore,
        transaction,
        String(payment.contractId),
        uid,
        new Date(),
      );
      assertPaymentMatchesContract(payment, contractContext, uid, new Date());
      if (
        payment.status !== 'processing'
        || payment.pendingOperation !== 'authorize'
        || payment.providerOrderId !== orderId
      ) {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed during provider authorization.');
      }
      const eventCount = Number(payment.eventCount);
      const authorized = providerResult.status === 'CREATED';
      const denied = providerResult.status === 'DENIED';
      const status = authorized ? 'authorized' : denied ? 'failed' : 'processing';
      const timestamp = getServerTimestamp();
      transaction.update(paymentRef, {
        status,
        pendingOperation: authorized || denied ? null : 'authorize',
        providerAuthorizationId: denied ? null : providerResult.authorizationId,
        ...(authorized ? { authorizedAt: timestamp, failureCode: null } : {}),
        ...(denied ? { failureCode: 'PAYMENT_AUTHORIZATION_DENIED' } : {}),
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: authorized ? 'payment.authorized' : denied ? 'payment.failed' : 'payment.retry_started',
        source: 'api',
        actorId: uid,
        details: {
          operation: 'authorize',
          providerAuthorizationId: denied ? null : providerResult.authorizationId,
          providerStatus: providerResult.status,
        },
      });
      return {
        ...payment,
        status,
        pendingOperation: authorized || denied ? null : 'authorize',
        providerAuthorizationId: denied ? null : providerResult.authorizationId,
        ...(authorized ? { authorizedAt: new Date(), failureCode: null } : {}),
        ...(denied ? { failureCode: 'PAYMENT_AUTHORIZATION_DENIED' } : {}),
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
