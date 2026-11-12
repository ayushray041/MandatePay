import { createHash } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { loadContractPaymentContext } from '@/lib/payments/context';
import { writePaymentEvent } from '@/lib/payments/events';
import { paymentErrorResponse, PaymentError } from '@/lib/payments/errors';
import { formatPayment } from '@/lib/payments/format';
import { createPayPalOrder, isPayPalConfigured, PaymentProviderError } from '@/lib/payments/paypal';
import { paymentCreateSchema } from '@/models/payment';
import type { Firestore } from 'firebase-admin/firestore';

type StoredPayment = Record<string, unknown>;

function hashIdempotencyKey(uid: string, key: string): string {
  return createHash('sha256').update(`${uid}:${key}`).digest('hex');
}

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }
  try {
    const snapshot = await adminFirestore.collection('payments')
      .where('participantIds', 'array-contains', authentication.user.uid)
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    return apiSuccess(snapshot.docs.map((payment) => formatPayment(payment.id, payment.data())));
  } catch (error: unknown) {
    return paymentErrorResponse(error);
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
    return apiError(400, 'INVALID_JSON', 'Payment request must be valid JSON.');
  }
  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Payment request is invalid.');
  }
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    return apiError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }
  if (!isPayPalConfigured()) {
    return apiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Sandbox payment provider is not configured.');
  }

  const firestore: Firestore = adminFirestore;
  const { contractId } = parsed.data;
  const paymentRef = firestore.collection('payments').doc(contractId);
  const contractRef = firestore.collection('contracts').doc(contractId);
  const uid = authentication.user.uid;
  const idempotencyKeyHash = hashIdempotencyKey(uid, idempotencyKey);
  const now = new Date();
  let payment: StoredPayment;
  let shouldCreateProviderOrder = false;

  try {
    payment = await firestore.runTransaction(async (transaction) => {
      const [existingSnapshot, contractSnapshot] = await Promise.all([
        transaction.get(paymentRef),
        transaction.get(contractRef),
      ]);
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data();
        if (!existing) {
          throw new PaymentError(500, 'INVALID_PAYMENT', 'Stored payment data is unavailable.');
        }
        if (existing.status === 'cancelled' && existing.idempotencyKeyHash !== idempotencyKeyHash) {
          const context = await loadContractPaymentContext(
            firestore,
            transaction,
            contractId,
            uid,
            now,
            contractSnapshot,
          );
          const attempts = existing.attempts;
          const eventCount = Number(existing.eventCount);
          if (
            typeof attempts !== 'object'
            || attempts === null
            || !Number.isSafeInteger(eventCount)
            || eventCount < 1
          ) {
            throw new PaymentError(500, 'INVALID_PAYMENT', 'Stored payment history is invalid.');
          }
          const previousCreateAttempts = Number((attempts as Record<string, unknown>).createOrder);
          if (!Number.isSafeInteger(previousCreateAttempts) || previousCreateAttempts < 1) {
            throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
          }
          const timestamp = getServerTimestamp();
          const restarted = {
            ...existing,
            contractId,
            negotiationId: String(context.contract.negotiationId ?? ''),
            participantIds: Array.isArray(context.contract.participantIds)
              ? context.contract.participantIds
              : [],
            payerId: context.payerId,
            payerMandateId: context.payerMandateId,
            payeeId: context.payeeId,
            payeeMandateId: context.payeeMandateId,
            amountMinor: context.terms.amountMinor,
            currency: context.terms.currency,
            serviceTitle: context.terms.service.title,
            status: 'created',
            providerOrderId: null,
            approvalUrl: null,
            providerAuthorizationId: null,
            providerCaptureId: null,
            providerRefundId: null,
            idempotencyKeyHash,
            pendingOperation: null,
            mandateApproval: { approverId: uid, approvedAt: timestamp },
            attempts: {
              createOrder: previousCreateAttempts + 1,
              authorize: 0,
              capture: 0,
              cancel: 0,
              refund: 0,
            },
            failureCode: null,
            cancellationReason: null,
            receiptUrl: null,
            authorizedAt: null,
            completedAt: null,
            cancelledAt: null,
            refundedAt: null,
            eventCount: eventCount + 1,
            updatedAt: timestamp,
          };
          transaction.update(paymentRef, restarted);
          writePaymentEvent(firestore, transaction, paymentRef, {
            sequence: eventCount + 1,
            type: 'payment.retry_started',
            source: 'api',
            actorId: uid,
            details: { operation: 'createOrder', newPaymentCycle: true },
          });
          shouldCreateProviderOrder = true;
          return { ...restarted, updatedAt: now };
        }
        if (existing.idempotencyKeyHash !== idempotencyKeyHash) {
          throw new PaymentError(
            409,
            'PAYMENT_ALREADY_EXISTS',
            'A payment already exists for this contract; reuse its original idempotency key.',
          );
        }
        if (
          (existing.status === 'created' || existing.status === 'failed')
          && !existing.providerOrderId
        ) {
          const attempts = existing.attempts;
          if (typeof attempts !== 'object' || attempts === null) {
            throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
          }
          const nextAttempts = Number((attempts as Record<string, unknown>).createOrder);
          if (!Number.isSafeInteger(nextAttempts) || nextAttempts < 1) {
            throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment attempt data is invalid.');
          }
          const eventCount = Number(existing.eventCount);
          if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
            throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment event sequence is invalid.');
          }
          const retrying = existing.status === 'failed';
          transaction.update(paymentRef, {
            status: 'created',
            failureCode: null,
            cancellationReason: null,
            attempts: { ...attempts, createOrder: nextAttempts + (retrying ? 1 : 0) },
            eventCount: eventCount + (retrying ? 1 : 0),
            updatedAt: getServerTimestamp(),
          });
          if (retrying) {
            writePaymentEvent(firestore, transaction, paymentRef, {
              sequence: eventCount + 1,
              type: 'payment.retry_started',
              source: 'api',
              actorId: uid,
              details: { operation: 'createOrder' },
            });
          }
          shouldCreateProviderOrder = true;
          return {
            ...existing,
            status: 'created',
            failureCode: null,
            attempts: { ...attempts, createOrder: nextAttempts + (retrying ? 1 : 0) },
            eventCount: eventCount + (retrying ? 1 : 0),
            updatedAt: now,
          };
        }
        if (existing.status === 'cancelled' || existing.status === 'failed') {
          throw new PaymentError(
            409,
            'PAYMENT_NOT_RETRYABLE',
            'This payment cannot be retried. Contact support before creating another payment.',
          );
        }
        return existing;
      }

      const context = await loadContractPaymentContext(
        firestore,
        transaction,
        contractId,
        uid,
        now,
        contractSnapshot,
      );
      const timestamp = getServerTimestamp();
      const record = {
        contractId,
        negotiationId: String(context.contract.negotiationId ?? ''),
        participantIds: Array.isArray(context.contract.participantIds)
          ? context.contract.participantIds
          : [],
        payerId: context.payerId,
        payerMandateId: context.payerMandateId,
        payeeId: context.payeeId,
        payeeMandateId: context.payeeMandateId,
        amountMinor: context.terms.amountMinor,
        currency: context.terms.currency,
        serviceTitle: context.terms.service.title,
        status: 'created',
        provider: 'paypal',
        providerOrderId: null,
        approvalUrl: null,
        providerAuthorizationId: null,
        providerCaptureId: null,
        providerRefundId: null,
        idempotencyKeyHash,
        pendingOperation: null,
        eventCount: 1,
        mandateApproval: { approverId: uid, approvedAt: timestamp },
        attempts: { createOrder: 1, authorize: 0, capture: 0, cancel: 0, refund: 0 },
        failureCode: null,
        cancellationReason: null,
        receiptUrl: null,
        authorizedAt: null,
        completedAt: null,
        cancelledAt: null,
        refundedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(paymentRef, record);
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: 1,
        type: 'payment.created',
        source: 'api',
        actorId: uid,
        details: { contractId, amountMinor: context.terms.amountMinor, currency: context.terms.currency },
      });
      shouldCreateProviderOrder = true;
      return { id: contractId, ...record, createdAt: now, updatedAt: now };
    });

    if (!shouldCreateProviderOrder) {
      return apiSuccess(formatPayment(contractId, payment));
    }

    let order: Awaited<ReturnType<typeof createPayPalOrder>>;
    try {
      order = await createPayPalOrder({
        paymentId: contractId,
        paymentCycle: String(payment.idempotencyKeyHash),
        amountMinor: Number(payment.amountMinor),
        currency: String(payment.currency),
        description: String(payment.serviceTitle),
      });
    } catch (error: unknown) {
      if (!(error instanceof PaymentProviderError)) {
        throw error;
      }
      const providerError = error;
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(paymentRef);
        const current = snapshot.data();
        if (!snapshot.exists || !current || current.status !== 'created') {
          return;
        }
        const eventCount = Number(current.eventCount);
        transaction.update(paymentRef, {
          status: 'failed',
          failureCode: providerError.code,
          eventCount: eventCount + 1,
          updatedAt: getServerTimestamp(),
        });
        writePaymentEvent(firestore, transaction, paymentRef, {
          sequence: eventCount + 1,
          type: 'payment.failed',
          source: 'system',
          actorId: null,
          details: { operation: 'createOrder', code: providerError.code },
        });
      });
      return apiError(
        providerError.code === 'PAYMENT_PROVIDER_UNAVAILABLE' ? 503 : 502,
        providerError.code,
        providerError.message,
      );
    }

    const finalized = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(paymentRef);
      const current = snapshot.data();
      if (!snapshot.exists || !current) {
        throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment could not be finalized.');
      }
      if (current.status === 'pending' && current.providerOrderId === order.orderId) {
        return current;
      }
      if (current.status !== 'created') {
        throw new PaymentError(409, 'PAYMENT_STATE_CHANGED', 'Payment changed while its provider order was being created.');
      }
      const eventCount = Number(current.eventCount);
      transaction.update(paymentRef, {
        status: 'pending',
        providerOrderId: order.orderId,
        approvalUrl: order.approvalUrl,
        eventCount: eventCount + 1,
        updatedAt: getServerTimestamp(),
      });
      writePaymentEvent(firestore, transaction, paymentRef, {
        sequence: eventCount + 1,
        type: 'payment.order_created',
        source: 'api',
        actorId: uid,
        details: { providerOrderId: order.orderId },
      });
      return {
        ...current,
        status: 'pending',
        providerOrderId: order.orderId,
        approvalUrl: order.approvalUrl,
        eventCount: eventCount + 1,
        updatedAt: now,
      };
    });
    return apiSuccess(formatPayment(contractId, finalized), 201);
  } catch (error: unknown) {
    return paymentErrorResponse(error);
  }
}
