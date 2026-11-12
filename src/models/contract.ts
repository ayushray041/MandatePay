import { z } from 'zod';
import { agentCategorySchema } from '@/models/agent';
import { mandateCurrencySchema } from '@/models/mandate';

export const contractStatuses = [
  'pending_review',
  'active',
  'rejected',
  'expired',
] as const;

export const contractStatusSchema = z.enum(contractStatuses);

export const amendmentStatuses = ['pending_review', 'accepted', 'rejected'] as const;
export const amendmentStatusSchema = z.enum(amendmentStatuses);

export const contractPartySchema = z.object({
  userId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(100),
  role: z.enum(['client', 'freelancer']),
  agentId: z.string().min(1).max(128),
  agentDisplayName: z.string().min(1).max(100),
  mandateId: z.string().min(1).max(128),
  mandateTitle: z.string().min(1).max(120),
}).strict();

export const contractServiceSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: agentCategorySchema,
  description: z.string().trim().min(10).max(3000),
  deliveryDays: z.number().int().min(1).max(3650),
}).strict();

export const contractTermsSchema = z.object({
  parties: z.tuple([contractPartySchema, contractPartySchema]),
  service: contractServiceSchema,
  amountMinor: z.number().int().positive().max(100_000_000_000),
  currency: mandateCurrencySchema,
  paymentConditions: z.string().trim().min(1).max(2000),
  deliveryConditions: z.string().trim().min(1).max(2000),
  expiresAt: z.string().datetime({ offset: true }),
  terminationConditions: z.string().trim().min(1).max(2000),
}).strict().superRefine((terms, context) => {
  const [first, second] = terms.parties;
  if (first.userId === second.userId || first.agentId === second.agentId) {
    context.addIssue({
      code: 'custom',
      path: ['parties'],
      message: 'A contract requires two distinct parties and agents.',
    });
  }
  if (first.mandateId === second.mandateId) {
    context.addIssue({
      code: 'custom',
      path: ['parties'],
      message: 'Each party must reference a distinct mandate.',
    });
  }
});

export const contractGenerateSchema = z.object({
  negotiationId: z.string().trim().min(1).max(128).refine((id) => !id.includes('/')),
}).strict();

export const contractApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(
  (decision) => decision.decision !== 'reject' || decision.reason !== undefined,
  { path: ['reason'], message: 'A rejection reason is required.' },
).refine(
  (decision) => decision.decision === 'reject' || decision.reason === undefined,
  { path: ['reason'], message: 'A reason is only accepted for rejection.' },
);

const contractServiceAmendmentSchema = contractServiceSchema.partial().strict().refine(
  (service) => Object.keys(service).length > 0,
  { message: 'At least one service field must be provided.' },
);

export const amendmentProposeSchema = z.object({
  service: contractServiceAmendmentSchema.optional(),
  amountMinor: z.number().int().positive().max(100_000_000_000).optional(),
  paymentConditions: z.string().trim().min(1).max(2000).optional(),
  deliveryConditions: z.string().trim().min(1).max(2000).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  terminationConditions: z.string().trim().min(1).max(2000).optional(),
}).strict().refine(
  (proposal) => Object.keys(proposal).length > 0,
  { message: 'At least one contract term must be amended.' },
);

export const amendmentDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(
  (decision) => decision.decision !== 'reject' || decision.reason !== undefined,
  { path: ['reason'], message: 'A rejection reason is required.' },
).refine(
  (decision) => decision.decision === 'reject' || decision.reason === undefined,
  { path: ['reason'], message: 'A reason is only accepted for rejection.' },
);

export const contractVersionSchema = z.object({
  id: z.string().min(1),
  contractId: z.string().min(1),
  version: z.number().int().positive(),
  previousVersionId: z.string().nullable(),
  negotiationId: z.string().min(1),
  amendmentId: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().nullable(),
  terms: contractTermsSchema,
}).strict();

export const contractAmendmentSchema = z.object({
  id: z.string().min(1),
  contractId: z.string().min(1),
  baseVersion: z.number().int().positive(),
  proposedTerms: contractTermsSchema,
  status: amendmentStatusSchema,
  requiredApproverIds: z.array(z.string().min(1)),
  approvals: z.array(z.string().min(1)),
  createdBy: z.string().min(1),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export const contractRecordSchema = z.object({
  id: z.string().min(1),
  negotiationId: z.string().min(1),
  participantIds: z.array(z.string().min(1)),
  requiredApproverIds: z.array(z.string().min(1)),
  mandateIds: z.tuple([z.string().min(1), z.string().min(1)]),
  status: contractStatusSchema,
  currentVersion: z.number().int().positive(),
  currentVersionId: z.string().min(1),
  activeAmendmentId: z.string().nullable(),
  approvals: z.array(z.string().min(1)),
  rejectionReason: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export const contractEventSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  type: z.enum([
    'contract.generated',
    'contract.approved',
    'contract.rejected',
    'contract.activated',
    'contract.expired',
    'amendment.proposed',
    'amendment.approved',
    'amendment.rejected',
    'contract.version_created',
  ]),
  actorId: z.string().min(1),
  createdAt: z.string().nullable(),
  amendmentId: z.string().optional(),
  versionId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type ContractStatus = z.infer<typeof contractStatusSchema>;
export type AmendmentStatus = z.infer<typeof amendmentStatusSchema>;
export type ContractParty = z.infer<typeof contractPartySchema>;
export type ContractService = z.infer<typeof contractServiceSchema>;
export type ContractTerms = z.infer<typeof contractTermsSchema>;
export type ContractVersion = z.infer<typeof contractVersionSchema>;
export type ContractAmendment = z.infer<typeof contractAmendmentSchema>;
export type ContractRecord = z.infer<typeof contractRecordSchema>;
