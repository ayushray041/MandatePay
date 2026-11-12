import { describe, expect, it } from 'vitest';
import {
  paymentCancelSchema,
  paymentCaptureSchema,
  paymentCreateSchema,
  paymentRecordSchema,
  paymentStatusSchema,
  paypalWebhookEventSchema,
} from '@/models/payment';

const payment = {
  id: 'payment-1',
  contractId: 'contract-1',
  negotiationId: 'negotiation-1',
  participantIds: ['payer-1', 'agent-1', 'payee-1', 'agent-2'],
  payerId: 'payer-1',
  payerMandateId: 'mandate-1',
  payeeId: 'payee-1',
  payeeMandateId: 'mandate-2',
  amountMinor: 125_000,
  currency: 'USD',
  status: 'pending',
  provider: 'paypal',
  providerOrderId: 'ORDER123',
  providerAuthorizationId: null,
  providerCaptureId: null,
  providerRefundId: null,
  idempotencyKeyHash: 'a'.repeat(64),
  mandateApproval: { approverId: 'payer-1', approvedAt: '2026-11-12T00:00:00.000Z' },
  attempts: { createOrder: 1, authorize: 0, capture: 0, cancel: 0, refund: 0 },
  failureCode: null,
  receiptUrl: null,
  authorizedAt: null,
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
};

describe('payment schemas', () => {
  it('accepts a complete server-owned payment record', () => {
    expect(paymentRecordSchema.safeParse(payment).success).toBe(true);
  });

  it('rejects invalid states, amounts, currencies, and unknown record fields', () => {
    expect(paymentStatusSchema.safeParse('settled').success).toBe(false);
    expect(paymentRecordSchema.safeParse({ ...payment, amountMinor: 0 }).success).toBe(false);
    expect(paymentRecordSchema.safeParse({ ...payment, currency: 'US' }).success).toBe(false);
    expect(paymentRecordSchema.safeParse({ ...payment, clientAmount: 125_000 }).success).toBe(false);
  });

  it('accepts only a contract reference for initiation and requires explicit fulfillment confirmation', () => {
    expect(paymentCreateSchema.safeParse({ contractId: 'contract-1' }).success).toBe(true);
    expect(paymentCreateSchema.safeParse({ contractId: 'contract-1', amountMinor: 1 }).success).toBe(false);
    expect(paymentCreateSchema.safeParse({ contractId: 'bad/id' }).success).toBe(false);
    expect(paymentCaptureSchema.safeParse({ fulfillmentConfirmed: true }).success).toBe(true);
    expect(paymentCaptureSchema.safeParse({ fulfillmentConfirmed: false }).success).toBe(false);
  });

  it('requires cancellation reasons and parses verified webhook event envelopes', () => {
    expect(paymentCancelSchema.safeParse({ reason: 'Order no longer needed.' }).success).toBe(true);
    expect(paymentCancelSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(paypalWebhookEventSchema.safeParse({
      id: 'WH-EVENT-1',
      event_type: 'PAYMENT.AUTHORIZATION.CREATED',
      resource: { id: 'AUTH-1' },
      create_time: '2026-11-12T00:00:00Z',
    }).success).toBe(true);
  });
});
