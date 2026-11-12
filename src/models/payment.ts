import { z } from 'zod';
import { mandateCurrencySchema } from '@/models/mandate';

export const paymentStatuses = [
  'created',
  'pending',
  'authorized',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'refunded',
] as const;

export const paymentStatusSchema = z.enum(paymentStatuses);

export const paymentCreateSchema = z.object({
  contractId: z.string().trim().min(1).max(128).refine((id) => !id.includes('/')),
}).strict();

export const paymentCaptureSchema = z.object({
  fulfillmentConfirmed: z.literal(true),
}).strict();

export const paymentCancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const paymentRefundSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const paymentRecordSchema = z.object({
  id: z.string().min(1),
  contractId: z.string().min(1),
  negotiationId: z.string().min(1),
  participantIds: z.array(z.string().min(1)),
  payerId: z.string().min(1),
  payerMandateId: z.string().min(1),
  payeeId: z.string().min(1),
  payeeMandateId: z.string().min(1),
  amountMinor: z.number().int().positive().max(100_000_000_000),
  currency: mandateCurrencySchema,
  status: paymentStatusSchema,
  provider: z.literal('paypal'),
  providerOrderId: z.string().min(1).nullable(),
  providerAuthorizationId: z.string().min(1).nullable(),
  providerCaptureId: z.string().min(1).nullable(),
  providerRefundId: z.string().min(1).nullable(),
  idempotencyKeyHash: z.string().min(1),
  mandateApproval: z.object({
    approverId: z.string().min(1),
    approvedAt: z.string().nullable(),
  }).strict(),
  attempts: z.object({
    createOrder: z.number().int().nonnegative(),
    authorize: z.number().int().nonnegative(),
    capture: z.number().int().nonnegative(),
    cancel: z.number().int().nonnegative(),
    refund: z.number().int().nonnegative(),
  }).strict(),
  failureCode: z.string().nullable(),
  receiptUrl: z.string().url().nullable(),
  authorizedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export const paymentEventSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  type: z.enum([
    'payment.created',
    'payment.order_created',
    'payment.authorization_started',
    'payment.authorized',
    'payment.capture_started',
    'payment.completed',
    'payment.cancelled',
    'payment.refund_started',
    'payment.refunded',
    'payment.failed',
    'payment.webhook_processed',
  ]),
  source: z.enum(['api', 'webhook', 'system']),
  actorId: z.string().nullable(),
  providerEventId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().nullable(),
}).strict();

export const paypalWebhookEventSchema = z.object({
  id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(128),
  resource: z.record(z.string(), z.unknown()),
}).passthrough();

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type PayPalWebhookEvent = z.infer<typeof paypalWebhookEventSchema>;
