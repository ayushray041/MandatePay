import { z } from 'zod';
import { agentCategorySchema } from '@/models/agent';
import { mandateCurrencySchema } from '@/models/mandate';

export const negotiationStatuses = [
  'initiated',
  'offer_submitted',
  'counter_offered',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;

export const negotiationStatusSchema = z.enum(negotiationStatuses);

export const negotiationOfferTermsSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    category: agentCategorySchema,
    description: z.string().trim().min(10).max(3000),
    amountMinor: z.number().int().positive().max(100_000_000_000),
    currency: mandateCurrencySchema,
    deliveryDays: z.number().int().min(1).max(3650),
  })
  .strict();

export const negotiationCreateSchema = z
  .object({
    mandateId: z.string().trim().min(1).max(128),
    recipientAgentId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(3).max(120),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const negotiationOfferSubmitSchema = z
  .object({
    mandateId: z.string().trim().min(1).max(128).optional(),
    terms: negotiationOfferTermsSchema,
  })
  .strict();

export const negotiationDecisionSchema = z
  .object({
    decision: z.enum(['accept', 'reject', 'cancel']),
    mandateId: z.string().trim().min(1).max(128).optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (decision) => decision.decision !== 'reject' || decision.reason !== undefined,
    { path: ['reason'], message: 'A rejection reason is required.' },
  )
  .refine(
    (decision) => decision.decision === 'reject' || decision.reason === undefined,
    { path: ['reason'], message: 'A reason is only accepted for rejection.' },
  );

export const negotiationOfferRecordSchema = z
  .object({
    id: z.string().min(1),
    negotiationId: z.string().min(1),
    sequence: z.number().int().positive(),
    submittedByAgentId: z.string().min(1),
    mandateId: z.string().min(1),
    terms: negotiationOfferTermsSchema,
    createdAt: z.string().nullable(),
  })
  .strict();

export const negotiationEventSchema = z
  .object({
    id: z.string().min(1),
    sequence: z.number().int().positive(),
    type: z.enum([
      'negotiation.created',
      'offer.submitted',
      'offer.countered',
      'negotiation.accepted',
      'negotiation.rejected',
      'negotiation.cancelled',
      'negotiation.expired',
    ]),
    actorAgentId: z.string().min(1),
    createdAt: z.string().nullable(),
    offerId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const negotiationRecordSchema = z
  .object({
    id: z.string().min(1),
    initiatorAgentId: z.string().min(1),
    recipientAgentId: z.string().min(1),
    initiatorMandateId: z.string().min(1),
    recipientMandateId: z.string().nullable(),
    title: z.string(),
    status: negotiationStatusSchema,
    expiresAt: z.string(),
    currentOfferId: z.string().nullable(),
    currentOffer: z
      .object({
        sequence: z.number().int().positive(),
        submittedByAgentId: z.string(),
        mandateId: z.string(),
        terms: negotiationOfferTermsSchema,
        createdAt: z.string().nullable(),
      })
      .strict()
      .nullable(),
    offerCount: z.number().int().nonnegative(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    resolvedByAgentId: z.string().nullable(),
    rejectionReason: z.string().nullable(),
  })
  .passthrough();

export type NegotiationStatus = z.infer<typeof negotiationStatusSchema>;
export type NegotiationOfferTerms = z.infer<typeof negotiationOfferTermsSchema>;
export type NegotiationOfferRecord = z.infer<typeof negotiationOfferRecordSchema>;
export type NegotiationEvent = z.infer<typeof negotiationEventSchema>;
export type NegotiationRecord = z.infer<typeof negotiationRecordSchema>;
