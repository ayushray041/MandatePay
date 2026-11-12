import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  assertPaymentMatchesContract: vi.fn(),
  createPayPalOrder: vi.fn(),
  isPayPalConfigured: vi.fn(),
  refundPayPalCapture: vi.fn(),
  loadContractPaymentContext: vi.fn(),
  firestore: {
    collection: vi.fn(),
    runTransaction: vi.fn(),
  },
  documents: new Map<string, Record<string, unknown>>(),
  uid: 'payer',
  writePaymentEvent: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({ adminFirestore: mocks.firestore }));
vi.mock('@/lib/firebase/firestore', () => ({ getServerTimestamp: () => new Date() }));
vi.mock('@/lib/api/auth', () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock('@/lib/payments/context', () => ({
  assertPaymentMatchesContract: mocks.assertPaymentMatchesContract,
  loadContractPaymentContext: mocks.loadContractPaymentContext,
}));
vi.mock('@/lib/payments/events', () => ({ writePaymentEvent: mocks.writePaymentEvent }));
vi.mock('@/lib/payments/paypal', () => ({
  createPayPalOrder: mocks.createPayPalOrder,
  isPayPalConfigured: mocks.isPayPalConfigured,
  refundPayPalCapture: mocks.refundPayPalCapture,
  PaymentProviderError: class PaymentProviderError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { POST as createPayment } from '@/app/api/payments/route';
import { POST as authorizePayment } from '@/app/api/payments/[paymentId]/authorize/route';
import { POST as cancelPayment } from '@/app/api/payments/[paymentId]/cancel/route';
import { POST as refundPayment } from '@/app/api/payments/[paymentId]/refund/route';

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
  };
}

function snapshot(path: string) {
  const data = mocks.documents.get(path);
  return { exists: data !== undefined, data: () => data };
}

const paymentContext = {
  contract: { negotiationId: 'neg-1', participantIds: ['payer', 'payee'] },
  terms: {
    parties: [],
    service: { title: 'Build website' },
    amountMinor: 125_000,
    currency: 'USD',
  },
  payerId: 'payer',
  payerMandateId: 'mandate-payer',
  payeeId: 'payee',
  payeeMandateId: 'mandate-payee',
};

function transactionMock() {
  return {
    get: vi.fn(async (ref: { path: string }) => snapshot(ref.path)),
    create: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      mocks.documents.set(ref.path, value);
    }),
    update: vi.fn((ref: { path: string }, value: Record<string, unknown>) => {
      mocks.documents.set(ref.path, { ...mocks.documents.get(ref.path), ...value });
    }),
  };
}

function jsonRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request('https://mandatepay.test/api/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('payment APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents.clear();
    mocks.uid = 'payer';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: mocks.uid },
    });
    mocks.firestore.collection.mockImplementation((name: string) => collection(name));
    mocks.firestore.runTransaction.mockImplementation(async (callback) => {
      return callback(transactionMock());
    });
    mocks.loadContractPaymentContext.mockResolvedValue(paymentContext);
    mocks.createPayPalOrder.mockResolvedValue({
      orderId: 'sandbox-order-1',
      approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=sandbox-order-1',
    });
    mocks.isPayPalConfigured.mockReturnValue(true);
    mocks.refundPayPalCapture.mockImplementation(async (input: {
      amountMinor: number;
      currency: string;
    }) => ({
      refundId: 'sandbox-refund-1',
      status: 'COMPLETED',
      amountMinor: input.amountMinor,
      currency: input.currency,
    }));
  });

  it('rejects unauthenticated payment creation', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: false,
      response: Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
    });

    const response = await createPayment(jsonRequest(
      { contractId: 'contract-1' },
      { 'Idempotency-Key': 'payment-create-key-001' },
    ));

    expect(response.status).toBe(401);
    expect(mocks.createPayPalOrder).not.toHaveBeenCalled();
  });

  it('rejects client-supplied amounts instead of trusting them', async () => {
    const response = await createPayment(jsonRequest(
      { contractId: 'contract-1', amountMinor: 1 },
      { 'Idempotency-Key': 'payment-create-key-001' },
    ));

    expect(response.status).toBe(400);
    expect(mocks.loadContractPaymentContext).not.toHaveBeenCalled();
    expect(mocks.createPayPalOrder).not.toHaveBeenCalled();
  });

  it('derives the provider amount from approved contract terms', async () => {
    mocks.documents.set('contracts/contract-1', { currentVersionId: 'version-1' });

    const response = await createPayment(jsonRequest(
      { contractId: 'contract-1' },
      { 'Idempotency-Key': 'payment-create-key-001' },
    ));

    expect(response.status).toBe(201);
    expect(mocks.createPayPalOrder).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'contract-1',
      amountMinor: 125_000,
      currency: 'USD',
      paymentCycle: expect.any(String),
    }));
    expect(mocks.documents.get('payments/contract-1')).toMatchObject({
      amountMinor: 125_000,
      payerId: 'payer',
      payeeId: 'payee',
    });
  });

  it('prevents the payee from authorizing a payer-owned payment', async () => {
    mocks.uid = 'payee';
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { uid: 'payee' },
    });
    mocks.documents.set('payments/contract-1', {
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      status: 'pending',
    });

    const response = await authorizePayment(
      new Request('https://mandatepay.test/api/payments/contract-1/authorize', { method: 'POST' }),
      { params: Promise.resolve({ paymentId: 'contract-1' }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.assertPaymentMatchesContract).not.toHaveBeenCalled();
  });

  it('does not release reservations for an unapproved provider order', async () => {
    mocks.documents.set('payments/contract-1', {
      participantIds: ['payer', 'payee'],
      payerId: 'payer',
      payeeId: 'payee',
      status: 'pending',
      providerOrderId: 'sandbox-order-1',
      providerAuthorizationId: null,
    });

    const response = await cancelPayment(
      jsonRequest({ reason: 'No longer needed' }),
      { params: Promise.resolve({ paymentId: 'contract-1' }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.documents.get('payments/contract-1')).toMatchObject({
      status: 'pending',
      providerOrderId: 'sandbox-order-1',
    });
  });

  it('only lets the payer request refunds and requires a refund idempotency key', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        status: 'completed',
        amountMinor: 10_000,
      });

      const missingKeyResponse = await refundPayment(
        jsonRequest({ reason: 'Duplicate charge' }),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );
      expect(missingKeyResponse.status).toBe(400);

      mocks.uid = 'payee';
      mocks.authenticateRequest.mockResolvedValue({
        authenticated: true,
        user: { uid: 'payee' },
      });
      const forbiddenResponse = await refundPayment(
        jsonRequest({ reason: 'Duplicate charge' }, { 'Idempotency-Key': 'refund-key-00000001' }),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );
      expect(forbiddenResponse.status).toBe(403);
      expect(mocks.refundPayPalCapture).not.toHaveBeenCalled();
    });

  it('rejects cumulative refunds above the captured balance without contacting PayPal', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        payerMandateId: 'mandate-payer',
        status: 'partially_refunded',
        amountMinor: 10_000,
        refundedAmountMinor: 7_500,
        providerCaptureId: 'capture-1',
        currency: 'USD',
        attempts: { refund: 1 },
        eventCount: 2,
      });

      const response = await refundPayment(
        jsonRequest(
          { reason: 'Remaining partial refund', amountMinor: 2_501 },
          { 'Idempotency-Key': 'refund-key-00000002' },
        ),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );

      expect(response.status).toBe(409);
      expect(mocks.refundPayPalCapture).not.toHaveBeenCalled();
    });

    it('bounds the number of partial refund operations per payment', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        status: 'completed',
        amountMinor: 10_000,
        refundedAmountMinor: 0,
        refundCount: 100,
        providerCaptureId: 'capture-1',
        currency: 'USD',
      });

      const response = await refundPayment(
        jsonRequest(
          { reason: 'Small refund', amountMinor: 1 },
          { 'Idempotency-Key': 'refund-key-00000006' },
        ),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );

      expect(response.status).toBe(409);
      expect(mocks.refundPayPalCapture).not.toHaveBeenCalled();
    });

  it('atomically applies partial refunds and replays the same key without a second provider request', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        payerMandateId: 'mandate-payer',
        amountMinor: 10_000,
        refundedAmountMinor: 0,
        currency: 'USD',
        status: 'completed',
        providerCaptureId: 'capture-1',
        idempotencyKeyHash: 'payment-cycle-hash',
        attempts: { refund: 0 },
        eventCount: 2,
      });
      mocks.documents.set('mandates/mandate-payer', {
        ownerId: 'payer',
        spentAmountMinor: 10_000,
      });
      const request = () => jsonRequest(
        { reason: 'Service partially delivered', amountMinor: 2_500 },
        { 'Idempotency-Key': 'refund-key-00000003' },
      );

      const firstResponse = await refundPayment(request(), {
        params: Promise.resolve({ paymentId: 'contract-1' }),
      });
      const firstBody = await firstResponse.json();
      expect(firstResponse.status).toBe(200);
      expect(firstBody.data).toMatchObject({
        status: 'partially_refunded',
        amountMinor: 10_000,
        refundedAmountMinor: 2_500,
      });
      expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 7_500 });
      expect(mocks.refundPayPalCapture).toHaveBeenCalledTimes(1);
      expect(mocks.refundPayPalCapture).toHaveBeenCalledWith(expect.objectContaining({
        amountMinor: 2_500,
        capturedAmountMinor: 10_000,
        currency: 'USD',
      }));

      const replayResponse = await refundPayment(request(), {
        params: Promise.resolve({ paymentId: 'contract-1' }),
      });
      expect(replayResponse.status).toBe(200);
      expect(mocks.refundPayPalCapture).toHaveBeenCalledTimes(1);
      expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 7_500 });
    });

    it('defaults an omitted amount to the remaining balance and confirms a full refund', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        payerMandateId: 'mandate-payer',
        amountMinor: 10_000,
        refundedAmountMinor: 0,
        currency: 'USD',
        status: 'completed',
        providerCaptureId: 'capture-1',
        idempotencyKeyHash: 'payment-cycle-hash',
        attempts: { refund: 0 },
        eventCount: 2,
      });
      mocks.documents.set('mandates/mandate-payer', {
        ownerId: 'payer',
        spentAmountMinor: 10_000,
      });

      const response = await refundPayment(
        jsonRequest(
          { reason: 'Refund entire capture' },
          { 'Idempotency-Key': 'refund-key-00000005' },
        ),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({
        status: 'refunded',
        refundedAmountMinor: 10_000,
      });
      expect(mocks.refundPayPalCapture).toHaveBeenCalledWith(expect.objectContaining({
        amountMinor: 10_000,
        capturedAmountMinor: 10_000,
      }));
      expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 0 });
    });

  it('keeps a pending provider refund out of the mandate ledger', async () => {
      mocks.documents.set('payments/contract-1', {
        participantIds: ['payer', 'payee'],
        payerId: 'payer',
        payerMandateId: 'mandate-payer',
        amountMinor: 10_000,
        refundedAmountMinor: 0,
        currency: 'USD',
        status: 'completed',
        providerCaptureId: 'capture-1',
        idempotencyKeyHash: 'payment-cycle-hash',
        attempts: { refund: 0 },
        eventCount: 2,
      });
      mocks.documents.set('mandates/mandate-payer', {
        ownerId: 'payer',
        spentAmountMinor: 10_000,
      });
      mocks.refundPayPalCapture.mockResolvedValueOnce({
        refundId: 'sandbox-refund-pending',
        status: 'PENDING',
        amountMinor: 2_500,
        currency: 'USD',
      });

      const response = await refundPayment(
        jsonRequest(
          { reason: 'Refund pending', amountMinor: 2_500 },
          { 'Idempotency-Key': 'refund-key-00000004' },
        ),
        { params: Promise.resolve({ paymentId: 'contract-1' }) },
      );

      expect(response.status).toBe(202);
      expect(mocks.documents.get('payments/contract-1')).toMatchObject({
        status: 'processing',
        pendingOperation: 'refund',
        refundedAmountMinor: 0,
      });
      expect(mocks.documents.get('mandates/mandate-payer')).toMatchObject({ spentAmountMinor: 10_000 });
  });
});
