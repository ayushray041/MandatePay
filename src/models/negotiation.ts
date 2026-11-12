import { z } from 'zod';
import { agentCategorySchema } from '@/models/agent';
import { mandateCurrencySchema } from '@/models/mandate';

export const negotiationStatuses = [
  'initiated',
  'offer_submitted',
  'counter_offered',
  'pending_owner_approval',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;

export const negotiationStatusSchema = z.enum(negotiationStatuses);

export const negotiationVolumeDiscountSchema = z.object({
  minimumQuantity: z.number().int().min(2).max(1_000_000),
  discountBasisPoints: z.number().int().min(1).max(5_000),
}).strict();

export const negotiationQuantityPricingSchema = z.object({
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: z.number().int().positive().max(100_000_000_000),
  volumeDiscounts: z.array(negotiationVolumeDiscountSchema).max(10),
}).strict().superRefine((pricing, context) => {
  let previousQuantity = 1;
  let previousDiscount = 0;
  for (const [index, tier] of pricing.volumeDiscounts.entries()) {
    if (
      tier.minimumQuantity <= previousQuantity
      || tier.discountBasisPoints < previousDiscount
      || tier.minimumQuantity > pricing.quantity
    ) {
      context.addIssue({
        code: 'custom',
        path: ['volumeDiscounts', index],
        message: 'Volume discount tiers must increase by quantity and cannot exceed the order quantity.',
      });
    }
    previousQuantity = tier.minimumQuantity;
    previousDiscount = tier.discountBasisPoints;
  }
});

export const negotiationSlaSchema = z.object({
  responseTimeHours: z.number().int().min(1).max(8760),
  uptimeBasisPoints: z.number().int().min(5000).max(10000),
  supportHoursPerWeek: z.number().int().min(0).max(168),
}).strict();

export const negotiationContractTermsSchema = z.object({
  durationMonths: z.number().int().min(1).max(120).nullable(),
  renewal: z.enum(['none', 'monthly', 'annual']),
  terminationNoticeDays: z.number().int().min(0).max(365),
  paymentSchedule: z.enum(['upfront', 'milestone', 'completion']),
}).strict();

export const negotiationConditionSchema = z.object({
  when: z.string().trim().min(1).max(300),
  then: z.string().trim().min(1).max(300),
}).strict();

export const negotiationOfferTermsSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    category: agentCategorySchema,
    description: z.string().trim().min(10).max(3000),
    amountMinor: z.number().int().positive().max(100_000_000_000),
    currency: mandateCurrencySchema,
    deliveryDays: z.number().int().min(1).max(3650),
    quantityPricing: negotiationQuantityPricingSchema.optional(),
    sla: negotiationSlaSchema.optional(),
    contractTerms: negotiationContractTermsSchema.optional(),
    conditions: z.array(negotiationConditionSchema).max(10).optional(),
  })
  .strict()
  .superRefine((terms, context) => {
    if (!terms.quantityPricing) {
      return;
    }
    const applicableDiscount = terms.quantityPricing.volumeDiscounts
      .filter((tier) => tier.minimumQuantity <= terms.quantityPricing!.quantity)
      .at(-1)?.discountBasisPoints ?? 0;
    const undiscounted = terms.quantityPricing.unitPriceMinor * terms.quantityPricing.quantity;
    const discountMultiplier = 10_000 - applicableDiscount;
    const calculatedAmount = Number.isSafeInteger(undiscounted)
      ? Math.floor(undiscounted / 10_000) * discountMultiplier
        + Math.round((undiscounted % 10_000) * discountMultiplier / 10_000)
      : Number.NaN;
    if (!Number.isSafeInteger(undiscounted) || calculatedAmount !== terms.amountMinor) {
      context.addIssue({
        code: 'custom',
        path: ['amountMinor'],
        message: 'Total amount must match the quantity price and applicable volume discount.',
      });
    }
  });

export const negotiationCreateSchema = z
  .object({
    mandateId: z.string().trim().min(1).max(128),
    recipientAgentId: z.string().trim().min(1).max(128).optional(),
    recipientAgentIds: z.array(z.string().trim().min(1).max(128)).min(2).max(10).optional(),
    title: z.string().trim().min(3).max(120),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((input) => Boolean(input.recipientAgentId) !== Boolean(input.recipientAgentIds), {
    message: 'Provide either recipientAgentId or recipientAgentIds.',
    path: ['recipientAgentIds'],
  })
  .refine(
    (input) => !input.recipientAgentIds
      || new Set(input.recipientAgentIds).size === input.recipientAgentIds.length,
    { path: ['recipientAgentIds'], message: 'Recipient agent IDs must be unique.' },
  );

export const negotiationOfferSubmitSchema = z
  .object({
    mandateId: z.string().trim().min(1).max(128).optional(),
    expectedOfferId: z.string().trim().min(1).max(128).nullable(),
    terms: negotiationOfferTermsSchema,
  })
  .strict();

export const negotiationDecisionSchema = z
  .object({
    decision: z.enum(['accept', 'reject', 'cancel']),
    mandateId: z.string().trim().min(1).max(128).optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    expectedOfferId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict()
  .refine(
    (decision) => !['accept', 'reject'].includes(decision.decision) || decision.reason !== undefined,
    { path: ['reason'], message: 'An acceptance or rejection reason is required.' },
  )
  .refine(
    (decision) => decision.decision !== 'cancel' || decision.reason === undefined,
    { path: ['reason'], message: 'A reason is not accepted for cancellation.' },
  );

export const negotiationOwnerApprovalSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(1).max(1000).optional(),
    expectedOfferId: z.string().trim().min(1).max(128),
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
    version: z.number().int().positive().optional(),
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
      'negotiation.owner_approval_requested',
      'negotiation.owner_approved',
      'negotiation.owner_rejected',
      'negotiation.accepted',
      'negotiation.rejected',
      'negotiation.cancelled',
      'negotiation.expired',
      'negotiation.dispute_escalated',
    ]),
    actorType: z.enum(['agent', 'owner', 'system']).optional(),
    actorAgentId: z.string().min(1).optional(),
    actorOwnerId: z.string().min(1).optional(),
    actorSystemId: z.string().min(1).optional(),
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
    ownerApprovalRequired: z.boolean().optional(),
    ownerApprovalRequiredForViewer: z.boolean().optional(),
    ownerApprovalRecordedForViewer: z.boolean().optional(),
    acceptanceRequestedByAgentId: z.string().min(1).optional(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    resolvedByAgentId: z.string().nullable(),
    rejectionReason: z.string().nullable(),
    acceptanceReason: z.string().nullable().optional(),
    version: z.number().int().positive().optional(),
    batchId: z.string().min(1).optional(),
    batchIndex: z.number().int().nonnegative().optional(),
    batchSize: z.number().int().positive().optional(),
    lockedOfferId: z.string().nullable().optional(),
  })
  .passthrough();

export const negotiationSnapshotSchema = z.object({
  version: z.number().int().positive(),
  status: negotiationStatusSchema,
  currentOfferId: z.string().nullable(),
  currentOffer: negotiationRecordSchema.shape.currentOffer,
  offerCount: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  actorId: z.string().min(1),
  createdAt: z.string().nullable(),
}).strict();

export const negotiationStrategyProfileSchema = z.object({
  posture: z.enum(['collaborative', 'balanced', 'assertive']),
  priorities: z.array(z.enum(['price', 'delivery', 'sla', 'flexibility', 'certainty'])).min(1).max(5),
  concessionStepBasisPoints: z.number().int().min(0).max(5000),
}).strict().refine(
  (profile) => new Set(profile.priorities).size === profile.priorities.length,
  { path: ['priorities'], message: 'Strategy priorities must be unique.' },
);

export const negotiationDisputeSchema = z.object({
  id: z.string().min(1),
  negotiationId: z.string().min(1),
  raisedByAgentId: z.string().min(1),
  category: z.enum(['delivery', 'quality', 'payment', 'scope', 'other']),
  reason: z.string().trim().min(10).max(2000),
  status: z.literal('open'),
  createdAt: z.string().nullable(),
}).strict();

export type NegotiationStatus = z.infer<typeof negotiationStatusSchema>;
export type NegotiationOfferTerms = z.infer<typeof negotiationOfferTermsSchema>;
export type NegotiationOfferRecord = z.infer<typeof negotiationOfferRecordSchema>;
export type NegotiationEvent = z.infer<typeof negotiationEventSchema>;
export type NegotiationRecord = z.infer<typeof negotiationRecordSchema>;
export type NegotiationStrategyProfile = z.infer<typeof negotiationStrategyProfileSchema>;
