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
import { recordMarketplaceCaptureOutcome } from '@/lib/marketplace/metrics';
import {
  capturePayPalAuthorization,
  isPayPalConfigured,
  PaymentProviderError,
} from '@/lib/payments/paypal';
import { paymentCaptureSchema } from '@/models/payment';

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
    return apiError(400, 'INVALID_JSON', 'Capture request must be valid JSON.');
  }
  const parsed = paymentCaptureSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Explicit fulfillment confirmation is required.');
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
  let attempt = 0;
  let authorizationId = '';
  let alreadyCompleted: StoredData | null = null;

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
        throw new PaymentError(403, 'FORBIDDEN', 'Only the approved client account can capture this payment.');
      }
      if (
        payment.status === 'completed'
        || payment.status === 'partially_refunded'
        || payment.status === 'refunded'
      ) {
        alreadyCompleted = payment;
        return payment;
      }
      const retryingFailedCapture =
        payment.status === 'failed'
        && payment.failureCode === 'PAYMENT_CAPTURE_FAILED'
        && typeof payment.providerAuthorizationId === 'string';
      if (
        payment.status !== 'authorized'
        && !(payment.status === 'processing' && payment.pendingOperation === 'capture')
        && !retryingFailedCapture
      ) {
        throw new PaymentError(409, 'PAYMENT_NOT_CAPTUREABLE', 'Payment is not authorized for capture.');
      }
      if (typeof payment.providerAuthorizationId !== 'string' || !payment.providerAuthorizationId) {
        throw new PaymentError(409, 'PAYMENT_AUTHORIZATION_UNAVAILABLE', 'Provider authorization is unavailable.');
      }
      const contractContext = await loadContractPaymentContext(
        firestore,
        transaction,
        String(payment.contractId),
        uid,
        new Date(),
      );
      assertPaymentMatchesContract(payment, contractContext, uid, new Date());
      const attempts = payment.attempts;
      if (typeof attempts !== 'object' || attempts === null) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const previousAttempt = Number((attempts as StoredData).capture);
      if (!Number.isSafeInteger(previousAttempt) || previousAttempt < 0) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
      }
      const retrying = payment.status === 'processing';
      attempt = retrying ? previousAttempt : previousAttempt + 1;
      authorizationId = payment.providerAuthorizationId;
      const eventCount = Number(payment.eventCount);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
      }
      transaction.update(paymentRef, {
        status: 'processing',
        pendingOperation: 'capture',
        attempts: { ...attempts, capture: attempt },
        failureCode: null,
        eventCount: eventCount + 1,
        updatedAt: getServerTimestamp(),
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: retrying ? 'payment.retry_started' : 'payment.capture_started',
        source: 'api',
        actorId: uid,
        details: { operation: 'capture', fulfillmentConfirmed: parsed.data.fulfillmentConfirmed },
      });
      return {
        ...payment,
        status: 'processing',
        pendingOperation: 'capture',
        attempts: { ...attempts, capture: attempt },
      };
    });

    if (alreadyCompleted) {
      return apiSuccess(formatPayment(paymentId, alreadyCompleted));
    }

    const providerResult = await capturePayPalAuthorization({
      paymentId,
      authorizationId,
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
      if (
        ['completed', 'partially_refunded', 'refunded'].includes(String(payment.status))
        && payment.providerCaptureId === providerResult.captureId
      ) {
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
      if (payment.status !== 'processing' || payment.pendingOperation !== 'capture') {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed during provider capture.');
      }
      const eventCount = Number(payment.eventCount);
      const completed = providerResult.status === 'COMPLETED';
      const failed = providerResult.status === 'FAILED' || providerResult.status === 'DECLINED';
      if ((completed || failed) && typeof payment.payeeId === 'string') {
        await recordMarketplaceCaptureOutcome(
          firestore,
          transaction,
          payment.payeeId,
          paymentId,
          completed ? 'success' : 'failure',
          completed ? 'capture-success' : `capture-failure-${attempt}`,
        );
      }
      const timestamp = getServerTimestamp();
      if (providerResult.status === 'COMPLETED') {
        const payerIndex = contractContext.terms.parties.findIndex(
          (party) => party.userId === payment.payerId,
        );
        if (payerIndex < 0) {
          throw new PaymentError(500, 'INVALID_PAYMENT', 'Payer is missing from approved contract terms.');
        }
        const payeeIndex = payerIndex === 0 ? 1 : 0;
        const payerParty = contractContext.terms.parties[payerIndex];
        const payeeParty = contractContext.terms.parties[payeeIndex];
        const payerMandate = contractContext.mandates[payerIndex];
        const payeeMandate = contractContext.mandates[payeeIndex];
        const payerReserved = payerMandate.reservedAmountMinor;
        const payeeReserved = payeeMandate.reservedAmountMinor;
        const payerSpent = payerMandate.spentAmountMinor;
        const spendingLimit = payerMandate.spendingLimitMinor;
        if (
          !Number.isSafeInteger(payerReserved)
          || !Number.isSafeInteger(payeeReserved)
          || !Number.isSafeInteger(payerSpent)
          || !Number.isSafeInteger(spendingLimit)
          || Number(payerReserved) < Number(payment.amountMinor)
          || Number(payeeReserved) < Number(payment.amountMinor)
          || Number(payerSpent) + Number(payment.amountMinor) > Number(spendingLimit)
        ) {
          throw new PaymentError(409, 'INVALID_RESERVATION', 'Authorized payment no longer has valid mandate reservations.');
        }
        transaction.update(
          firestore.collection('mandates').doc(payerParty.mandateId),
          {
            reservedAmountMinor: Number(payerReserved) - Number(payment.amountMinor),
            spentAmountMinor: Number(payerSpent) + Number(payment.amountMinor),
            updatedAt: timestamp,
          },
        );
        transaction.update(
          firestore.collection('mandates').doc(payeeParty.mandateId),
          {
            reservedAmountMinor: Number(payeeReserved) - Number(payment.amountMinor),
            updatedAt: timestamp,
          },
        );
      }
      const status = completed ? 'completed' : failed ? 'failed' : 'processing';
      transaction.update(paymentRef, {
        status,
        pendingOperation: completed || failed ? null : 'capture',
        ...(completed ? {
          providerCaptureId: providerResult.captureId,
          receiptUrl: providerResult.receiptUrl ?? null,
          completedAt: timestamp,
          failureCode: null,
        } : failed ? { failureCode: 'PAYMENT_CAPTURE_FAILED' } : {}),
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: completed ? 'payment.completed' : failed ? 'payment.failed' : 'payment.retry_started',
        source: 'api',
        actorId: uid,
        details: {
          operation: 'capture',
          ...(completed ? { providerCaptureId: providerResult.captureId } : {}),
          providerStatus: providerResult.status,
        },
      });
      return {
        ...payment,
        status,
        pendingOperation: completed || failed ? null : 'capture',
        ...(completed ? {
          providerCaptureId: providerResult.captureId,
          receiptUrl: providerResult.receiptUrl ?? null,
          completedAt: new Date(),
          failureCode: null,
        } : failed ? { failureCode: 'PAYMENT_CAPTURE_FAILED' } : {}),
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
