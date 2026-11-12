import { z } from 'zod';

export const mandateStatuses = [
  'draft',
  'active',
  'paused',
  'expired',
  'revoked',
] as const;

export const mandateStatusSchema = z.enum(mandateStatuses);

export const mandateOperations = [
  'contract.create',
  'contract.amend',
  'payment.authorize',
] as const;

export const mandateOperationSchema = z.enum(mandateOperations);

const minorUnitAmountSchema = z.number().int().positive().max(100_000_000_000);
const supportedCurrencyCodes = new Set(Intl.supportedValuesOf('currency'));
export const mandateCurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter uppercase code.')
  .refine(
    (currency) => supportedCurrencyCodes.has(currency),
    'Currency must be a supported ISO 4217 code.',
  );

export const mandateApprovalRequirementsSchema = z
  .object({
    ownerApprovalOperations: z.array(mandateOperationSchema).max(mandateOperations.length),
    ownerApprovalAboveMinor: minorUnitAmountSchema.optional(),
  })
  .strict();

export const mandateExecutionConditionsSchema = z
  .object({
    maximumOperationAmountMinor: minorUnitAmountSchema.optional(),
    requiredDescriptionTerms: z.array(z.string().trim().min(1).max(80)).max(10),
  })
  .strict();

const mandateFieldsSchema = z.object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(4000),
    authorizedAgentId: z.string().trim().min(1).max(128),
    spendingLimitMinor: minorUnitAmountSchema,
    currency: mandateCurrencySchema,
    startsAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    allowedOperations: z.array(mandateOperationSchema).min(1).max(mandateOperations.length),
    approvalRequirements: mandateApprovalRequirementsSchema,
    executionConditions: mandateExecutionConditionsSchema,
  }).strict();

function validateMandateDatesAndLimits(
  mandate: {
    startsAt?: string;
    expiresAt?: string;
    spendingLimitMinor?: number;
    executionConditions?: MandateExecutionConditions;
  },
  context: z.RefinementCtx,
) {
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

  const maximumOperationAmountMinor =
    mandate.executionConditions?.maximumOperationAmountMinor;
  if (
    maximumOperationAmountMinor !== undefined
    && mandate.spendingLimitMinor !== undefined
    && maximumOperationAmountMinor > mandate.spendingLimitMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['executionConditions', 'maximumOperationAmountMinor'],
      message: 'Maximum operation amount cannot exceed the mandate spending limit.',
    });
  }
}

export const mandateCreateSchema = mandateFieldsSchema.superRefine(
  validateMandateDatesAndLimits,
);
export const mandateUpdateSchema = mandateFieldsSchema
  .partial()
  .superRefine(validateMandateDatesAndLimits)
  .refine((mandate) => Object.keys(mandate).length > 0, {
    message: 'At least one mandate field must be provided.',
  });

export const mandateLifecycleActionSchema = z
  .object({
    action: z.enum(['activate', 'pause', 'resume', 'revoke']),
  })
  .strict();

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
  })
  .strict();

export const mandateRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    authorizedAgentId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    spendingLimitMinor: minorUnitAmountSchema,
    spentAmountMinor: z.number().int().nonnegative(),
    currency: mandateCurrencySchema,
    startsAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    allowedOperations: z.array(mandateOperationSchema),
    approvalRequirements: mandateApprovalRequirementsSchema,
    executionConditions: mandateExecutionConditionsSchema,
    status: mandateStatusSchema,
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
    status: z.enum(['pending_approval', 'approved', 'rejected']),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

export type MandateStatus = z.infer<typeof mandateStatusSchema>;
export type MandateOperation = z.infer<typeof mandateOperationSchema>;
export type MandateCreateInput = z.infer<typeof mandateCreateSchema>;
export type MandateRecord = z.infer<typeof mandateRecordSchema>;
export type MandateAuthorizationRecord = z.infer<
  typeof mandateAuthorizationRecordSchema
>;
export type MandateExecutionConditions = z.infer<
  typeof mandateExecutionConditionsSchema
>;
export type MandateApprovalRequirements = z.infer<
  typeof mandateApprovalRequirementsSchema
>;
