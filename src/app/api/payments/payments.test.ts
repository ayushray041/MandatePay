import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  assertPaymentMatchesContract: vi.fn(),
  createPayPalOrder: vi.fn(),
  isPayPalConfigured: vi.fn(),
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
  PaymentProviderError: class PaymentProviderError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { POST as createPayment } from '@/app/api/payments/route';
import { POST as authorizePayment } from '@/app/api/payments/[paymentId]/authorize/route';

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
});
