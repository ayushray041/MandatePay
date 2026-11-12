import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { adminFirestore } from '@/lib/firebase/admin';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { loadPaymentLedgerContext } from '@/lib/payments/context';
import { writePaymentEvent } from '@/lib/payments/events';
import { PaymentError, paymentErrorResponse } from '@/lib/payments/errors';
import {
  PaymentProviderError,
  verifyPayPalWebhookSignature,
} from '@/lib/payments/paypal';
import { parseMajorAmount } from '@/lib/mandates/money';
import { paypalWebhookEventSchema, type PayPalWebhookEvent } from '@/models/payment';

type StoredData = Record<string, unknown>;

const handledEventTypes = new Set([
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
]);

function asRecord(value: unknown): StoredData | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as StoredData
    : null;
}

function relatedIds(resource: StoredData): StoredData {
  return asRecord(asRecord(resource.supplementary_data)?.related_ids) ?? {};
}

function lookupForEvent(event: PayPalWebhookEvent): { field: string; value: string } | null {
  const resource = event.resource;
  const related = relatedIds(resource);
  if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const captureId = related.capture_id;
    return typeof captureId === 'string' && captureId
      ? { field: 'providerCaptureId', value: captureId }
      : null;
  }
  const orderId = related.order_id ?? resource.order_id;
  if (typeof orderId === 'string' && orderId) {
    return { field: 'providerOrderId', value: orderId };
  }
  if (event.event_type === 'PAYMENT.AUTHORIZATION.CREATED' || event.event_type === 'PAYMENT.AUTHORIZATION.VOIDED') {
    return typeof resource.id === 'string' && resource.id
      ? { field: 'providerAuthorizationId', value: resource.id }
      : null;
  }
  if (event.event_type.startsWith('PAYMENT.CAPTURE.')) {
    return typeof resource.id === 'string' && resource.id
      ? { field: 'providerCaptureId', value: resource.id }
      : null;
  }
  return null;
}

function hasExpectedAmount(resource: StoredData, payment: StoredData): boolean {
  const amount = asRecord(resource.amount);
  if (typeof amount?.value !== 'string' || typeof amount.currency_code !== 'string') {
    return false;
  }
  return amount.currency_code === payment.currency
    && parseMajorAmount(amount.value, amount.currency_code) === payment.amountMinor;
}

function addPaymentEvent(
  firestore: Firestore,
  transaction: Transaction,
  paymentRef: FirebaseFirestore.DocumentReference,
  event: PayPalWebhookEvent,
  payment: StoredData,
  updates: StoredData,
  type: string,
  outcome: string,
): void {
  const eventCount = Number(payment.eventCount);
  if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
    throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
  }
  const timestamp = getServerTimestamp();
  transaction.update(paymentRef, {
    ...updates,
    eventCount: eventCount + 1,
    updatedAt: timestamp,
  });
  writePaymentEvent(firestore, transaction, paymentRef, {
    sequence: eventCount + 1,
    type,
    source: 'webhook',
    actorId: null,
    providerEventId: event.id,
    details: { providerEventType: event.event_type, outcome },
  });
}

async function releaseReservations(
  firestore: Firestore,
  transaction: Transaction,
  payment: StoredData,
): Promise<void> {
  const context = await loadPaymentLedgerContext(firestore, transaction, payment);
  const payerIndex = context.terms.parties.findIndex((party) => party.userId === payment.payerId);
  if (payerIndex < 0) {
    throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Payer is missing from approved contract terms.');
  }
  const payeeIndex = payerIndex === 0 ? 1 : 0;
  const payerRef = firestore.collection('mandates').doc(context.terms.parties[payerIndex].mandateId);
  const payeeRef = firestore.collection('mandates').doc(context.terms.parties[payeeIndex].mandateId);
  const [payerSnapshot, payeeSnapshot] = await Promise.all([
    transaction.get(payerRef),
    transaction.get(payeeRef),
  ]);
  const payer = payerSnapshot.data();
  const payee = payeeSnapshot.data();
  const payerReserved = payer?.reservedAmountMinor;
  const payeeReserved = payee?.reservedAmountMinor;
  if (
    !payerSnapshot.exists
    || !payeeSnapshot.exists
    || !payer
    || !payee
    || payer.ownerId !== payment.payerId
    || payee.ownerId !== payment.payeeId
    || !Number.isSafeInteger(payment.amountMinor)
    || typeof payerReserved !== 'number'
    || typeof payeeReserved !== 'number'
    || !Number.isSafeInteger(payerReserved)
    || !Number.isSafeInteger(payeeReserved)
    || payerReserved < Number(payment.amountMinor)
    || payeeReserved < Number(payment.amountMinor)
  ) {
    throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Payment reservation cannot be released safely.');
  }
  const timestamp = getServerTimestamp();
  transaction.update(payerRef, {
    reservedAmountMinor: payerReserved - Number(payment.amountMinor),
    updatedAt: timestamp,
  });
  transaction.update(payeeRef, {
    reservedAmountMinor: payeeReserved - Number(payment.amountMinor),
    updatedAt: timestamp,
  });
}

async function applyWebhookEvent(
  firestore: Firestore,
  transaction: Transaction,
  paymentRef: FirebaseFirestore.DocumentReference,
  payment: StoredData,
  event: PayPalWebhookEvent,
): Promise<{ outcome: string; paymentId: string }> {
  const resource = event.resource;
  const amountMatches = hasExpectedAmount(resource, payment);
  const related = relatedIds(resource);
  const resourceId = typeof resource.id === 'string' ? resource.id : '';

  if (event.event_type === 'PAYMENT.AUTHORIZATION.CREATED') {
    if (payment.status === 'completed' || payment.status === 'refunded') {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    if (!resourceId || !amountMatches) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        status: 'failed',
        pendingOperation: null,
        failureCode: 'PAYMENT_AUTHORIZATION_MISMATCH',
      }, 'payment.failed', 'authorization_mismatch');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    if (payment.status === 'authorized' && payment.providerAuthorizationId === resourceId) {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    if (
      payment.status !== 'pending'
      && !(payment.status === 'processing' && payment.pendingOperation === 'authorize')
    ) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_STATE_CONFLICT_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'state_conflict');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    const timestamp = getServerTimestamp();
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'authorized',
      pendingOperation: null,
      providerAuthorizationId: resourceId,
      authorizedAt: timestamp,
      failureCode: null,
    }, 'payment.authorized', 'authorized');
    return { outcome: 'authorized', paymentId: paymentRef.id };
  }

  if (event.event_type === 'PAYMENT.AUTHORIZATION.VOIDED') {
    if (payment.status === 'cancelled' || payment.status === 'completed' || payment.status === 'refunded') {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    if (
      payment.status !== 'authorized'
      && !(payment.status === 'processing' && payment.pendingOperation === 'cancel')
    ) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_STATE_CONFLICT_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'state_conflict');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    await releaseReservations(firestore, transaction, payment);
    const timestamp = getServerTimestamp();
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'cancelled',
      pendingOperation: null,
      cancelledAt: timestamp,
      cancellationReason: 'Provider authorization was voided.',
      failureCode: null,
    }, 'payment.cancelled', 'authorization_voided');
    return { outcome: 'cancelled', paymentId: paymentRef.id };
  }

  if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    if (payment.status === 'refunded' && payment.providerRefundId === resourceId) {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    const refundInProgress =
      payment.status === 'processing' && payment.pendingOperation === 'refund';
    if (
      (payment.status !== 'completed' && !refundInProgress)
      || !resourceId
      || !amountMatches
      || (typeof related.capture_id === 'string' && related.capture_id !== payment.providerCaptureId)
    ) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_REFUND_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'refund_mismatch');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    const context = await loadPaymentLedgerContext(firestore, transaction, payment);
    const payerIndex = context.terms.parties.findIndex((party) => party.userId === payment.payerId);
    if (payerIndex < 0) {
      throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Payer is missing from approved contract terms.');
    }
    const payerMandate = context.mandates[payerIndex];
    const spentAmountMinor = payerMandate.spentAmountMinor;
    if (
      payerMandate.ownerId !== payment.payerId
      || typeof spentAmountMinor !== 'number'
      || !Number.isSafeInteger(spentAmountMinor)
      || spentAmountMinor < Number(payment.amountMinor)
    ) {
      throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Refund cannot be reconciled with mandate spending.');
    }
    const timestamp = getServerTimestamp();
    const refundId = typeof resourceId === 'string' ? resourceId : '';
    transaction.update(firestore.collection('mandates').doc(String(payment.payerMandateId)), {
      spentAmountMinor: spentAmountMinor - Number(payment.amountMinor),
      updatedAt: timestamp,
    });
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'refunded',
      pendingOperation: null,
      providerRefundId: refundId,
      refundedAt: timestamp,
      failureCode: null,
    }, 'payment.refunded', 'refunded');
    return { outcome: 'refunded', paymentId: paymentRef.id };
  }

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    if (
      (payment.status === 'completed' || payment.status === 'refunded')
      && payment.providerCaptureId === resourceId
    ) {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    const captureCanComplete =
      payment.status === 'authorized'
      || (payment.status === 'processing' && payment.pendingOperation === 'capture')
      || (payment.status === 'failed' && payment.failureCode === 'PAYMENT_CAPTURE_FAILED');
    if (!resourceId || !amountMatches || !captureCanComplete) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        ...(payment.status === 'cancelled' ? {} : { status: 'failed', pendingOperation: null }),
        providerCaptureId: resourceId || null,
        failureCode: 'PAYMENT_CAPTURE_REQUIRES_RECONCILIATION',
      }, 'payment.failed', 'capture_mismatch_or_state_conflict');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    const context = await loadPaymentLedgerContext(firestore, transaction, payment);
    const payerIndex = context.terms.parties.findIndex((party) => party.userId === payment.payerId);
    if (payerIndex < 0) {
      throw new PaymentError(409, 'INVALID_PAYMENT_LEDGER', 'Payer is missing from approved contract terms.');
    }
    const payeeIndex = payerIndex === 0 ? 1 : 0;
    const payerMandate = context.mandates[payerIndex];
    const payeeMandate = context.mandates[payeeIndex];
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
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        status: 'failed',
        pendingOperation: null,
        providerCaptureId: resourceId,
        failureCode: 'PAYMENT_CAPTURE_REQUIRES_RECONCILIATION',
      }, 'payment.failed', 'invalid_mandate_reservation');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    const payerRef = firestore.collection('mandates').doc(String(payment.payerMandateId));
    const payeeRef = firestore.collection('mandates').doc(String(payment.payeeMandateId));
    const timestamp = getServerTimestamp();
    transaction.update(payerRef, {
      reservedAmountMinor: Number(payerReserved) - Number(payment.amountMinor),
      spentAmountMinor: Number(payerSpent) + Number(payment.amountMinor),
      updatedAt: timestamp,
    });
    transaction.update(payeeRef, {
      reservedAmountMinor: Number(payeeReserved) - Number(payment.amountMinor),
      updatedAt: timestamp,
    });
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'completed',
      pendingOperation: null,
      providerCaptureId: resourceId,
      completedAt: timestamp,
      failureCode: null,
    }, 'payment.completed', 'captured');
    return { outcome: 'completed', paymentId: paymentRef.id };
  }

  if (event.event_type === 'PAYMENT.CAPTURE.PENDING') {
    if (
      (payment.status === 'completed' || payment.status === 'refunded')
      && payment.providerCaptureId === resourceId
    ) {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    if (!resourceId || !amountMatches) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_CAPTURE_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'capture_mismatch');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    if (
      payment.status !== 'authorized'
      && !(payment.status === 'processing' && payment.pendingOperation === 'capture')
    ) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_STATE_CONFLICT_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'state_conflict');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'processing',
      pendingOperation: 'capture',
      providerCaptureId: resourceId,
    }, 'payment.webhook_processed', 'capture_pending');
    return { outcome: 'pending', paymentId: paymentRef.id };
  }

  if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
    if (
      (payment.status === 'completed' || payment.status === 'refunded')
      && payment.providerCaptureId === resourceId
    ) {
      return { outcome: 'already_applied', paymentId: paymentRef.id };
    }
    if (
      payment.status !== 'authorized'
      && !(payment.status === 'processing' && payment.pendingOperation === 'capture')
    ) {
      addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
        failureCode: 'PAYMENT_STATE_CONFLICT_REQUIRES_RECONCILIATION',
      }, 'payment.webhook_processed', 'state_conflict');
      return { outcome: 'reconciliation_required', paymentId: paymentRef.id };
    }
    addPaymentEvent(firestore, transaction, paymentRef, event, payment, {
      status: 'failed',
      pendingOperation: null,
      failureCode: 'PAYMENT_CAPTURE_FAILED',
    }, 'payment.failed', 'capture_denied');
    return { outcome: 'failed', paymentId: paymentRef.id };
  }

  return { outcome: 'ignored', paymentId: paymentRef.id };
}

export async function POST(request: Request) {
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Webhook payload must be valid JSON.');
  }
  const parsed = paypalWebhookEventSchema.safeParse(body);
  if (
    !parsed.success
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(parsed.data.id)
  ) {
    return apiError(400, 'INVALID_WEBHOOK', 'Webhook event is invalid.');
  }
  let verified: boolean;
  try {
    verified = await verifyPayPalWebhookSignature(request.headers, parsed.data);
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      return apiError(503, error.code, error.message);
    }
    return apiError(503, 'PAYMENT_WEBHOOK_VERIFICATION_UNAVAILABLE', 'Webhook verification is unavailable.');
  }
  if (!verified) {
    return apiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature verification failed.');
  }

  const firestore: Firestore = adminFirestore;
  const event = parsed.data;
  const eventRef = firestore.collection('paypalWebhookEvents')
    .doc(createHash('sha256').update(event.id).digest('hex'));
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      if (eventSnapshot.exists) {
        return { outcome: 'duplicate', paymentId: null };
      }

      let outcome = 'ignored';
      let paymentId: string | null = null;
      if (handledEventTypes.has(event.event_type)) {
        const lookup = lookupForEvent(event);
        if (!lookup) {
          throw new PaymentError(503, 'PAYMENT_LOOKUP_UNAVAILABLE', 'Provider event cannot be matched to a payment.');
        }
        const query = firestore.collection('payments')
          .where(lookup.field, '==', lookup.value)
          .limit(1);
        const matches = await transaction.get(query);
        const paymentSnapshot = matches.docs[0];
        if (!paymentSnapshot?.exists) {
          throw new PaymentError(503, 'PAYMENT_LOOKUP_UNAVAILABLE', 'Provider event payment is not available yet.');
        }
        const payment = paymentSnapshot.data();
        if (!payment) {
          throw new PaymentError(503, 'PAYMENT_LOOKUP_UNAVAILABLE', 'Provider event payment is unavailable.');
        }
        const paymentRef = firestore.collection('payments').doc(paymentSnapshot.id);
        const applied = await applyWebhookEvent(firestore, transaction, paymentRef, payment, event);
        outcome = applied.outcome;
        paymentId = applied.paymentId;
      }

      transaction.create(eventRef, {
        providerEventId: event.id,
        eventType: event.event_type,
        outcome,
        paymentId,
        receivedAt: getServerTimestamp(),
      });
      return { outcome, paymentId };
    });
    return apiSuccess({ received: true, ...result });
  } catch (error: unknown) {
    return paymentErrorResponse(error);
  }
}
