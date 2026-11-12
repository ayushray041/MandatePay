'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  paymentEventSchema,
  paymentRecordSchema,
  type PaymentRecord,
} from '@/models/payment';

const paymentDetailSchema = z.object({
  payment: paymentRecordSchema,
  events: z.array(paymentEventSchema),
}).strict();

export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

export function listPayments(): Promise<PaymentRecord[]> {
  return authenticatedApiRequest(
    '/api/payments',
    z.array(paymentRecordSchema),
    {},
    'Payment history could not be loaded.',
  );
}

export function getPayment(paymentId: string): Promise<PaymentDetail> {
  return authenticatedApiRequest(
    `/api/payments/${encodeURIComponent(paymentId)}`,
    paymentDetailSchema,
    {},
    'Payment details could not be loaded.',
  );
}

export function getPaymentIdempotencyKey(
  userId: string,
  contractId: string,
  startNewCycle = false,
): string {
  const key = `mandatepay:payment:${userId}:${contractId}`;
  if (!startNewCycle) {
    const existing = window.localStorage.getItem(key);
    if (existing) {
      return existing;
    }
  }
  const idempotencyKey = window.crypto.randomUUID();
  window.localStorage.setItem(key, idempotencyKey);
  return idempotencyKey;
}

export function createPayment(contractId: string, idempotencyKey: string): Promise<PaymentRecord> {
  return authenticatedApiRequest(
    '/api/payments',
    paymentRecordSchema,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ contractId }),
    },
    'Payment could not be initiated.',
  );
}

export function authorizePayment(paymentId: string): Promise<PaymentRecord> {
  return authenticatedApiRequest(
    `/api/payments/${encodeURIComponent(paymentId)}/authorize`,
    paymentRecordSchema,
    { method: 'POST' },
    'Payment authorization could not be confirmed.',
  );
}

export function capturePayment(paymentId: string): Promise<PaymentRecord> {
  return authenticatedApiRequest(
    `/api/payments/${encodeURIComponent(paymentId)}/capture`,
    paymentRecordSchema,
    {
      method: 'POST',
      body: JSON.stringify({ fulfillmentConfirmed: true }),
    },
    'Payment capture could not be confirmed.',
  );
}

export function cancelPayment(paymentId: string, reason: string): Promise<PaymentRecord> {
  return authenticatedApiRequest(
    `/api/payments/${encodeURIComponent(paymentId)}/cancel`,
    paymentRecordSchema,
    { method: 'POST', body: JSON.stringify({ reason }) },
    'Payment cancellation could not be confirmed.',
  );
}

export function refundPayment(paymentId: string, reason: string): Promise<PaymentRecord> {
  return authenticatedApiRequest(
    `/api/payments/${encodeURIComponent(paymentId)}/refund`,
    paymentRecordSchema,
    { method: 'POST', body: JSON.stringify({ reason }) },
    'Payment refund could not be confirmed.',
  );
}
