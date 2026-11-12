import { z } from 'zod';
import { agentCategorySchema } from '@/models/agent-category';

export const mandateStatuses = [
  'draft',
  'active',
  'paused',
  'expired',
  'revoked',
] as const;

export const mandateStatusSchema = z.enum(mandateStatuses);
export const mandateDurationTypes = ['temporary', 'permanent'] as const;
export const mandateDurationTypeSchema = z.enum(mandateDurationTypes);

export const mandateOperations = [
  'contract.create',
  'contract.amend',
  'payment.authorize',
] as const;

export const mandateOperationSchema = z.enum(mandateOperations);

const minorUnitAmountSchema = z.number().int().positive().max(100_000_000_000);
const nonnegativeMinorAmountSchema = z.number().int().nonnegative().max(100_000_000_000);
const currencyCodes = new Set(Intl.supportedValuesOf('currency'));
const userIdSchema = z.string().trim().min(1).max(128);
const immutableAgentIdSchema = z.string().regex(/^agt_[A-Za-z0-9_-]{32}$/);
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const mandateCurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter uppercase code.')
  .refine((currency) => currencyCodes.has(currency), 'Currency must be a supported ISO 4217 code.');

export const mandateApprovalRequirementsSchema = z.object({
  ownerApprovalOperations: z.array(mandateOperationSchema).max(mandateOperations.length),
  ownerApprovalAboveMinor: minorUnitAmountSchema.optional(),
  approverIds: z.array(userIdSchema).min(1).max(20).optional(),
  approvalMode: z.enum(['all', 'quorum']).default('all'),
  approvalQuorum: z.number().int().min(1).max(20).optional(),
}).strict().superRefine((requirements, context) => {
  if (
    requirements.approvalMode === 'quorum'
    && (
      requirements.approvalQuorum === undefined
      || requirements.approvalQuorum > (requirements.approverIds?.length ?? 1)
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['approvalQuorum'],
      message: 'A quorum must be set and cannot exceed the number of approvers.',
    });
  }
  if (
    requirements.approvalMode === 'all'
    && requirements.approvalQuorum !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['approvalQuorum'],
      message: 'A quorum is only valid when approval mode is quorum.',
    });
  }
  if (
    requirements.approverIds
    && new Set(requirements.approverIds).size !== requirements.approverIds.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['approverIds'],
      message: 'Approver IDs must be unique.',
    });
  }
});

export const mandateExecutionConditionsSchema = z.object({
  maximumOperationAmountMinor: minorUnitAmountSchema.optional(),
  dailyLimitMinor: minorUnitAmountSchema.optional(),
  weeklyLimitMinor: minorUnitAmountSchema.optional(),
  monthlyLimitMinor: minorUnitAmountSchema.optional(),
  recurringPeriod: z.enum(['daily', 'weekly', 'monthly']).optional(),
  recurringLimitMinor: minorUnitAmountSchema.optional(),
  maximumTransactionCount: z.number().int().positive().max(1_000_000).optional(),
  agentSpendingLimitMinor: minorUnitAmountSchema.optional(),
  allowedVendorIds: z.array(userIdSchema).max(100).optional(),
  blockedVendorIds: z.array(userIdSchema).max(100).optional(),
  allowedCategories: z.array(agentCategorySchema).max(8).optional(),
  allowedCountries: z.array(countryCodeSchema).max(100).optional(),
  blockedCountries: z.array(countryCodeSchema).max(100).optional(),
  allowedDelegateAgentIds: z.array(immutableAgentIdSchema).max(10).optional(),
  maximumDelegationDepth: z.number().int().min(0).max(3).default(0),
  maximumContractDurationDays: z.number().int().min(1).max(3650).optional(),
  requiredDescriptionTerms: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
}).strict().superRefine((conditions, context) => {
  if (
    conditions.allowedVendorIds
    && conditions.blockedVendorIds
    && conditions.allowedVendorIds.some((vendorId) => conditions.blockedVendorIds?.includes(vendorId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['blockedVendorIds'],
      message: 'A vendor cannot be both allowed and blocked.',
    });
  }
  if (
    conditions.allowedCountries
    && conditions.blockedCountries
    && conditions.allowedCountries.some((country) => conditions.blockedCountries?.includes(country))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['blockedCountries'],
      message: 'A country cannot be both allowed and blocked.',
    });
  }
  if ((conditions.recurringPeriod === undefined) !== (conditions.recurringLimitMinor === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['recurringLimitMinor'],
      message: 'Recurring mandates require both a period and a recurring spending limit.',
    });
  }
  if (
    conditions.allowedDelegateAgentIds
    && new Set(conditions.allowedDelegateAgentIds).size !== conditions.allowedDelegateAgentIds.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['allowedDelegateAgentIds'],
      message: 'Delegated agent IDs must be unique.',
    });
  }
  if (
    conditions.maximumDelegationDepth > 0
    && (conditions.allowedDelegateAgentIds?.length ?? 0) === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['allowedDelegateAgentIds'],
      message: 'Delegation depth requires at least one approved delegated agent.',
    });
  }
});

const mandateFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(4000),
  authorizedAgentId: userIdSchema,
  spendingLimitMinor: minorUnitAmountSchema,
  currency: mandateCurrencySchema,
  durationType: mandateDurationTypeSchema,
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  allowedOperations: z.array(mandateOperationSchema).min(1).max(mandateOperations.length),
  approvalRequirements: mandateApprovalRequirementsSchema,
  executionConditions: mandateExecutionConditionsSchema,
}).strict();

function validateMandateDatesAndLimits(
  mandate: {
    durationType?: 'temporary' | 'permanent';
    startsAt?: string;
    expiresAt?: string | null;
    spendingLimitMinor?: number;
    approvalRequirements?: z.infer<typeof mandateApprovalRequirementsSchema>;
    executionConditions?: z.infer<typeof mandateExecutionConditionsSchema>;
  },
  context: z.RefinementCtx,
) {
  if (
    mandate.durationType === 'temporary'
    && mandate.expiresAt === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Temporary mandates require an expiration date.',
    });
  }
  if (
    mandate.durationType === 'permanent'
    && mandate.expiresAt !== null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Permanent mandates cannot have an expiration date.',
    });
  }
  if (
    mandate.startsAt
    && mandate.expiresAt
    && Date.parse(mandate.startsAt) >= Date.parse(mandate.expiresAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Expiry date must be after the start date.',
    });
  }

  const maximums = [
    ['executionConditions.maximumOperationAmountMinor', mandate.executionConditions?.maximumOperationAmountMinor],
    ['executionConditions.dailyLimitMinor', mandate.executionConditions?.dailyLimitMinor],
    ['executionConditions.weeklyLimitMinor', mandate.executionConditions?.weeklyLimitMinor],
    ['executionConditions.monthlyLimitMinor', mandate.executionConditions?.monthlyLimitMinor],
    ['executionConditions.recurringLimitMinor', mandate.executionConditions?.recurringLimitMinor],
    ['executionConditions.agentSpendingLimitMinor', mandate.executionConditions?.agentSpendingLimitMinor],
    ['approvalRequirements.ownerApprovalAboveMinor', mandate.approvalRequirements?.ownerApprovalAboveMinor],
  ] as const;
  for (const [path, amount] of maximums) {
    if (
      amount !== undefined
      && mandate.spendingLimitMinor !== undefined
      && amount > mandate.spendingLimitMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: path.split('.'),
        message: 'A mandate policy amount cannot exceed the total spending limit.',
      });
    }
  }
}

export const mandateCreateSchema = mandateFieldsSchema.extend({
  durationType: mandateDurationTypeSchema.default('temporary'),
}).superRefine(validateMandateDatesAndLimits);
export const mandateUpdateSchema = mandateFieldsSchema
  .partial()
  .superRefine(validateMandateDatesAndLimits)
  .refine((mandate) => Object.keys(mandate).length > 0, {
    message: 'At least one mandate field must be provided.',
  });

export const mandateLifecycleActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['activate', 'pause', 'resume', 'revoke']) }).strict(),
  z.object({
    action: z.literal('emergency_suspend'),
    reason: z.string().trim().min(1).max(1000),
  }).strict(),
]);

export const mandateDuplicateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
}).strict();

export const mandateRenewalRequestSchema = z.object({
  requestedExpiresAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const mandateRenewalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(
  (decision) => decision.decision !== 'reject' || decision.reason !== undefined,
  { path: ['reason'], message: 'A rejection reason is required.' },
).refine(
  (decision) => decision.decision === 'reject' || decision.reason === undefined,
  { path: ['reason'], message: 'A reason is only accepted for rejection.' },
);

export const mandateLimitRequestSchema = z
  .object({
    requestedLimitMinor: minorUnitAmountSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const mandateLimitDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
  })
  .strict();

export const mandateAuthorizationRequestSchema = z
  .object({
    operation: mandateOperationSchema,
    amountMinor: minorUnitAmountSchema,
    description: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
  })
  .strict();

export const mandateUsageWindowSchema = z.object({
  periodKey: z.string(),
  amountMinor: nonnegativeMinorAmountSchema,
  transactionCount: z.number().int().nonnegative(),
}).strict();

export const mandateVelocityUsageSchema = z.object({
  daily: mandateUsageWindowSchema.optional(),
  weekly: mandateUsageWindowSchema.optional(),
  monthly: mandateUsageWindowSchema.optional(),
  totalTransactionCount: z.number().int().nonnegative().default(0),
}).strict();

const renewalRequestRecordSchema = z.object({
  requestedBy: userIdSchema,
  requestedExpiresAt: z.string().datetime({ offset: true }),
  reason: z.string(),
  requestedAt: z.string().nullable(),
}).strict();

export const mandateVersionRecordSchema = z.object({
  version: z.number().int().positive(),
  createdBy: userIdSchema,
  createdAt: z.string().nullable(),
  reason: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();

export const mandateRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    authorizedAgentId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    spendingLimitMinor: minorUnitAmountSchema,
    spentAmountMinor: nonnegativeMinorAmountSchema,
    reservedAmountMinor: nonnegativeMinorAmountSchema.default(0),
    authorizationReservedAmountMinor: nonnegativeMinorAmountSchema.default(0),
    velocityUsage: mandateVelocityUsageSchema.default({ totalTransactionCount: 0 }),
    currency: mandateCurrencySchema,
    durationType: mandateDurationTypeSchema.default('temporary'),
    startsAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    allowedOperations: z.array(mandateOperationSchema),
    approvalRequirements: mandateApprovalRequirementsSchema,
    executionConditions: mandateExecutionConditionsSchema,
    status: mandateStatusSchema,
    version: z.number().int().positive().default(1),
    emergencySuspension: z.object({
      reason: z.string(),
      suspendedBy: userIdSchema,
      suspendedAt: z.string().nullable(),
    }).strict().nullable().default(null),
    renewalRequest: renewalRequestRecordSchema.nullable().default(null),
    pendingLimitRequest: z
      .object({
        requestedLimitMinor: minorUnitAmountSchema,
        requestedBy: z.string(),
        reason: z.string(),
        previousLimitMinor: minorUnitAmountSchema,
      })
      .passthrough()
      .nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

export const mandateAuthorizationRecordSchema = z
  .object({
    id: z.string().min(1),
    mandateId: z.string().min(1),
    ownerId: z.string().min(1),
    authorizedAgentId: z.string().min(1),
    operation: mandateOperationSchema,
    amountMinor: minorUnitAmountSchema,
    currency: mandateCurrencySchema,
    description: z.string(),
    vendorId: userIdSchema.nullable().optional(),
    serviceCategory: agentCategorySchema.nullable().optional(),
    mandateVersion: z.number().int().positive().optional(),
    approvalApproverIds: z.array(userIdSchema).optional(),
    approvalQuorum: z.number().int().positive().optional(),
    approvals: z.array(userIdSchema).optional(),
    status: z.enum(['pending_approval', 'approved', 'rejected']),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

export type MandateStatus = z.infer<typeof mandateStatusSchema>;
export type MandateDurationType = z.infer<typeof mandateDurationTypeSchema>;
export type MandateOperation = z.infer<typeof mandateOperationSchema>;
export type MandateCreateInput = z.infer<typeof mandateCreateSchema>;
export type MandateRecord = z.infer<typeof mandateRecordSchema>;
export type MandateAuthorizationRecord = z.infer<typeof mandateAuthorizationRecordSchema>;
export type MandateExecutionConditions = z.infer<typeof mandateExecutionConditionsSchema>;
export type MandateApprovalRequirements = z.infer<typeof mandateApprovalRequirementsSchema>;
export type MandateVersionRecord = z.infer<typeof mandateVersionRecordSchema>;
export type MandateVelocityUsage = z.infer<typeof mandateVelocityUsageSchema>;
