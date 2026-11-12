import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  documents: new Map<string, Record<string, unknown>>(),
  loadPaymentLedgerContext: vi.fn(),
  verifyPayPalWebhookSignature: vi.fn(),
  writePaymentEvent: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));
vi.mock('@/lib/firebase/firestore', () => ({ getServerTimestamp: () => new Date() }));
vi.mock('@/lib/payments/context', () => ({
  loadPaymentLedgerContext: mocks.loadPaymentLedgerContext,
}));
vi.mock('@/lib/payments/events', () => ({ writePaymentEvent: mocks.writePaymentEvent }));
vi.mock('@/lib/payments/paypal', () => ({
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
});
