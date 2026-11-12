import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  documents: new Map<string, Record<string, unknown>>(),
  loadPaymentLedgerContext: vi.fn(),
  recordMarketplaceCaptureOutcome: vi.fn(),
  verifyPayPalWebhookSignature: vi.fn(),
  writePaymentEvent: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));
vi.mock('@/lib/firebase/firestore', () => ({ getServerTimestamp: () => new Date() }));
vi.mock('@/lib/payments/context', () => ({
  loadPaymentLedgerContext: mocks.loadPaymentLedgerContext,
}));
vi.mock('@/lib/payments/events', () => ({ writePaymentEvent: mocks.writePaymentEvent }));
vi.mock('@/lib/marketplace/metrics', () => ({
  recordMarketplaceCaptureOutcome: mocks.recordMarketplaceCaptureOutcome,
}));
vi.mock('@/lib/payments/paypal', () => ({
  validatedPayPalReceiptUrl: (value: unknown) => typeof value === 'string' ? value : null,
  verifyPayPalWebhookSignature: mocks.verifyPayPalWebhookSignature,
  PaymentProviderError: class PaymentProviderError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { createHash } from 'node:crypto';
import { POST as receiveWebhook } from '@/app/api/payments/webhook/route';

function reference(path: string) {
  const segments = path.split('/');
  return {
    id: segments[segments.length - 1],
    path,
    collection: (name: string) => collection(`${path}/${name}`),
  };
}

function collection(path: string) {
  return {
    doc: (id?: string) => reference(`${path}/${id ?? 'new-document'}`),
    where: (field: string, _operator: string, value: string) => ({
      field,
      value,
      limit: () => ({ field, value }),
    }),
  };
}

function snapshot(path: string) {
  const data = mocks.documents.get(path);
  return {
    id: path.split('/').at(-1),
    exists: data !== undefined,
    data: () => data,
  };
}

const captureEvent = {
  id: 'paypal-event-capture-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'capture-1',
    amount: { currency_code: 'USD', value: '10.00' },
    links: [{ rel: 'receipt', href: 'https://www.sandbox.paypal.com/receipt?id=capture-1' }],
    supplementary_data: { related_ids: { order_id: 'order-1' } },
  },
};

const ledgerContext = {
  terms: {
    parties: [
      { userId: 'payer', mandateId: 'mandate-payer' },
      { userId: 'payee', mandateId: 'mandate-payee' },
    ],
  },
  mandates: [
    { ownerId: 'payer', reservedAmountMinor: 1_000, spentAmountMinor: 0, spendingLimitMinor: 5_000 },
    { ownerId: 'payee', reservedAmountMinor: 1_000, spentAmountMinor: 0, spendingLimitMinor: 5_000 },
  ],
};

function setupTransactions() {
  const transaction = {
    get: vi.fn(async (ref: { field?: string; value?: string; path?: string }) => {
      if (ref.field && ref.value) {
        const docs = [...mocks.documents.entries()]
          .filter(([, value]) => value[ref.field!] === ref.value)
          .map(([path]) => snapshot(path));
        return { docs };
      }
      return snapshot(ref.path ?? '');
    }),
    create: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      mocks.documents.set(ref.path, value);
    }),
    update: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      mocks.documents.set(ref.path, { ...mocks.documents.get(ref.path), ...value });
    }),
  };
  mocks.firestore.runTransaction.mockImplementation(async (callback) => callback(transaction));
}

function request(event: unknown) {
  return new Request('https://mandatepay.test/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
}

describe('PayPal payment webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.firestore.collection.mockImplementation((name: string) => collection(name));
    mocks.verifyPayPalWebhookSignature.mockResolvedValue(true);
    mocks.loadPaymentLedgerContext.mockResolvedValue(ledgerContext);
    setupTransactions();
  });

  it('rejects events that fail provider signature verification', async () => {
    mocks.verifyPayPalWebhookSignature.mockResolvedValue(false);

    const response = await receiveWebhook(request(captureEvent));

    expect(response.status).toBe(401);
    expect(mocks.firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('atomically reconciles a verified capture and deduplicates replayed event IDs', async () => {
    mocks.documents.set('payments/contract-1', {
      contractId: 'contract-1',
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payerMandateId: 'mandate-payer',
      payeeId: 'payee',
      payeeMandateId: 'mandate-payee',
      amountMinor: 1_000,
      currency: 'USD',
      status: 'processing',
      pendingOperation: 'capture',
      providerOrderId: 'order-1',
      eventCount: 2,
    });
    mocks.documents.set('mandates/mandate-payer', ledgerContext.mandates[0]);
    mocks.documents.set('mandates/mandate-payee', ledgerContext.mandates[1]);

    const firstResponse = await receiveWebhook(request(captureEvent));
    const firstBody = await firstResponse.json();
    const payment = mocks.documents.get('payments/contract-1');
    const payerMandate = mocks.documents.get('mandates/mandate-payer');
    const payeeMandate = mocks.documents.get('mandates/mandate-payee');
    const eventDocumentId = createHash('sha256').update(captureEvent.id).digest('hex');

    expect(firstResponse.status).toBe(200);
    expect(firstBody.data).toMatchObject({ received: true, outcome: 'completed', paymentId: 'contract-1' });
    expect(payment).toMatchObject({
      status: 'completed',
      providerCaptureId: 'capture-1',
      receiptUrl: 'https://www.sandbox.paypal.com/receipt?id=capture-1',
      eventCount: 3,
    });
    expect(payerMandate).toMatchObject({ reservedAmountMinor: 0, spentAmountMinor: 1_000 });
    expect(payeeMandate).toMatchObject({ reservedAmountMinor: 0 });
    expect(mocks.documents.get(`paypalWebhookEvents/${eventDocumentId}`)).toMatchObject({
      providerEventId: captureEvent.id,
      outcome: 'completed',
      paymentId: 'contract-1',
    });

    const replayResponse = await receiveWebhook(request(captureEvent));
    const replayBody = await replayResponse.json();

    expect(replayResponse.status).toBe(200);
    expect(replayBody.data).toMatchObject({ received: true, outcome: 'duplicate' });
    expect(mocks.documents.get('payments/contract-1')).toMatchObject({ eventCount: 3 });
    expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 1_000 });
  });

  it('does not acknowledge a verified event until its payment can be matched', async () => {
    const response = await receiveWebhook(request(captureEvent));

    expect(response.status).toBe(503);
    expect([...mocks.documents.keys()]).toEqual([]);
  });

  it('does not complete a payment when the signed provider amount differs', async () => {
    mocks.documents.set('payments/contract-1', {
      contractId: 'contract-1',
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payerMandateId: 'mandate-payer',
      payeeId: 'payee',
      payeeMandateId: 'mandate-payee',
      amountMinor: 1_000,
      currency: 'USD',
      status: 'processing',
      pendingOperation: 'capture',
      providerOrderId: 'order-1',
      eventCount: 2,
    });
    const mismatchEvent = {
      ...captureEvent,
      id: 'paypal-event-capture-mismatch',
      resource: {
        ...captureEvent.resource,
        amount: { currency_code: 'USD', value: '10.01' },
      },
    };

    const response = await receiveWebhook(request(mismatchEvent));
    const payment = mocks.documents.get('payments/contract-1');

    expect(response.status).toBe(200);
    expect(payment).toMatchObject({
      status: 'failed',
      failureCode: 'PAYMENT_CAPTURE_REQUIRES_RECONCILIATION',
      eventCount: 3,
    });
    expect(mocks.loadPaymentLedgerContext).not.toHaveBeenCalled();
    expect([...mocks.documents.keys()]).not.toContain('mandates/mandate-payer');
  });

  it('does not count pending capture events as failed marketplace outcomes', async () => {
    mocks.documents.set('payments/contract-1', {
      contractId: 'contract-1',
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payeeId: 'payee',
      amountMinor: 1_000,
      currency: 'USD',
      status: 'processing',
      pendingOperation: 'capture',
      providerOrderId: 'order-1',
      attempts: { capture: 1 },
      eventCount: 2,
    });
    const pendingEvent = {
      ...captureEvent,
      id: 'paypal-event-capture-pending',
      event_type: 'PAYMENT.CAPTURE.PENDING',
    };

    const response = await receiveWebhook(request(pendingEvent));

    expect(response.status).toBe(200);
    expect(mocks.recordMarketplaceCaptureOutcome).not.toHaveBeenCalled();
  });

  it('reconciles partial refunds once per provider refund ID, even across different webhook event IDs', async () => {
    const refundKeyHash = 'a'.repeat(64);
    const refundEvent = {
      id: 'paypal-event-refund-1',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'refund-1',
        amount: { currency_code: 'USD', value: '4.00' },
        supplementary_data: { related_ids: { capture_id: 'capture-1' } },
      },
    };
    const paymentPath = 'payments/contract-1';
    const refundPath = `${paymentPath}/refunds/${refundKeyHash}`;
    mocks.documents.set(paymentPath, {
      contractId: 'contract-1',
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payerMandateId: 'mandate-payer',
      payeeId: 'payee',
      payeeMandateId: 'mandate-payee',
      amountMinor: 1_000,
      refundedAmountMinor: 0,
      currency: 'USD',
      status: 'processing',
      pendingOperation: 'refund',
      pendingRefundId: refundKeyHash,
      pendingRefundAmountMinor: 400,
      providerCaptureId: 'capture-1',
      eventCount: 3,
    });
    mocks.documents.set(refundPath, {
      amountMinor: 400,
      currency: 'USD',
      reason: 'Partial service issue',
      status: 'pending',
      providerRefundId: 'refund-1',
    });
    mocks.documents.set('mandates/mandate-payer', {
      ...ledgerContext.mandates[0],
      spentAmountMinor: 1_000,
    });
    mocks.loadPaymentLedgerContext.mockResolvedValueOnce({
      ...ledgerContext,
      mandates: [
        { ...ledgerContext.mandates[0], spentAmountMinor: 1_000 },
        ledgerContext.mandates[1],
      ],
    });

    const firstResponse = await receiveWebhook(request(refundEvent));
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(firstBody.data).toMatchObject({ outcome: 'partially_refunded', paymentId: 'contract-1' });
    expect(mocks.documents.get(paymentPath)).toMatchObject({
      status: 'partially_refunded',
      refundedAmountMinor: 400,
      pendingOperation: null,
    });
    expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 600 });
    expect(mocks.documents.get(refundPath)).toMatchObject({ status: 'completed', providerRefundId: 'refund-1' });

    const distinctEventReplay = await receiveWebhook(request({
      ...refundEvent,
      id: 'paypal-event-refund-duplicate-notification',
    }));
    const replayBody = await distinctEventReplay.json();
    expect(distinctEventReplay.status).toBe(200);
    expect(replayBody.data).toMatchObject({ outcome: 'already_applied' });
    expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 600 });

    const conflictingReplay = await receiveWebhook(request({
      ...refundEvent,
      id: 'paypal-event-refund-conflicting-replay',
      resource: {
        ...refundEvent.resource,
        amount: { currency_code: 'USD', value: '4.01' },
      },
    }));
    const conflictingBody = await conflictingReplay.json();
    expect(conflictingReplay.status).toBe(200);
    expect(conflictingBody.data).toMatchObject({ outcome: 'reconciliation_required' });
    expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 600 });
  });

  it('records a denied capture as one failed marketplace outcome', async () => {
    mocks.documents.set('payments/contract-1', {
      contractId: 'contract-1',
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payeeId: 'payee',
      amountMinor: 1_000,
      currency: 'USD',
      status: 'processing',
      pendingOperation: 'capture',
      providerOrderId: 'order-1',
      attempts: { capture: 2 },
      eventCount: 2,
    });
    const deniedEvent = {
      ...captureEvent,
      id: 'paypal-event-capture-denied',
      event_type: 'PAYMENT.CAPTURE.DENIED',
    };

    const response = await receiveWebhook(request(deniedEvent));

    expect(response.status).toBe(200);
    expect(mocks.recordMarketplaceCaptureOutcome).toHaveBeenCalledWith(
      mocks.firestore,
      expect.anything(),
      'payee',
      'contract-1',
      'failure',
      'capture-failure-2',
    );
  });
});
