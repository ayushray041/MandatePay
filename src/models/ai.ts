import { z } from 'zod';
import {
  negotiationOfferTermsSchema,
} from '@/models/negotiation';

export const negotiationIntelligenceRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recommend') }).strict(),
  z.object({ action: z.literal('compare') }).strict(),
  z.object({ action: z.literal('summarize') }).strict(),
  z.object({ action: z.literal('analyze') }).strict(),
  z.object({
    action: z.literal('explain_violation'),
    terms: negotiationOfferTermsSchema,
  }).strict(),
]);

export const negotiationRecommendationModelSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  recommendations: z.array(z.object({
    action: z.enum(['accept', 'counter', 'clarify', 'decline']),
    rationale: z.string().trim().min(1).max(600),
  }).strict()).max(4),
  counteroffer: negotiationOfferTermsSchema.nullable(),
  caveats: z.array(z.string().trim().min(1).max(300)).max(5),
}).strict();

export const mandateAssessmentSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
  reasons: z.array(z.object({
    code: z.string().min(1).max(80),
    explanation: z.string().min(1).max(300),
  }).strict()).max(10),
}).strict();

export const negotiationRecommendationResponseSchema = z.object({
  action: z.literal('recommend'),
  source: z.enum(['gemini', 'deterministic']),
  recommendation: negotiationRecommendationModelSchema.nullable(),
  mandateAssessment: mandateAssessmentSchema,
  counterofferValidation: z.enum(['not_proposed', 'valid', 'rejected']),
  counterofferRejectionReason: z.string().nullable(),
  notice: z.string().nullable(),
}).strict();

export const mandateExplanationResponseSchema = z.object({
  action: z.literal('explain_violation'),
  source: z.literal('deterministic'),
  mandateAssessment: mandateAssessmentSchema,
}).strict();

export const aiOfferComparisonModelSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  tradeoffs: z.array(z.object({
    offerSequence: z.number().int().positive(),
    observation: z.string().trim().min(1).max(400),
  }).strict()).max(10),
  questions: z.array(z.string().trim().min(1).max(300)).max(5),
}).strict();

export const offerComparisonRequestSchema = z.object({
  action: z.literal('compare'),
}).strict();

export const offerComparisonResponseSchema = z.object({
  action: z.literal('compare'),
  source: z.enum(['gemini', 'deterministic']),
  comparison: aiOfferComparisonModelSchema.nullable(),
  offers: z.array(z.object({
    sequence: z.number().int().positive(),
    perspective: z.enum(['you', 'other_party']),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3),
    deliveryDays: z.number().int().positive(),
    priceDeltaFromPreviousMinor: z.number().int().nullable(),
    deliveryDeltaFromPreviousDays: z.number().int().nullable(),
    mandateAllowed: z.boolean(),
    mandateApprovalRequired: z.boolean(),
    mandateReasons: z.array(z.string().max(300)).max(10),
  }).strict()).max(20),
  notice: z.string().nullable(),
}).strict();

export const negotiationAnalysisModelSchema = z.object({
  unfavorableTerms: z.array(z.object({
    offerSequence: z.number().int().positive(),
    term: z.string().trim().min(1).max(120),
    concern: z.string().trim().min(1).max(400),
    severity: z.enum(['low', 'medium', 'high']),
  }).strict()).max(10),
  strategies: z.array(z.object({
    strategy: z.string().trim().min(1).max(120),
    rationale: z.string().trim().min(1).max(400),
  }).strict()).max(5),
  outcomePrediction: z.object({
    likelihood: z.enum(['unlikely', 'uncertain', 'plausible', 'likely']),
    rationale: z.string().trim().min(1).max(500),
  }).strict(),
}).strict();

export const negotiationAnalysisResponseSchema = z.object({
  action: z.literal('analyze'),
  source: z.enum(['gemini', 'deterministic']),
  priceDifferences: z.array(z.object({
    offerSequence: z.number().int().positive(),
    amountMinor: z.number().int().positive(),
    deltaFromPreviousMinor: z.number().int().nullable(),
    currency: z.string().length(3),
  }).strict()).max(20),
  observedPriceReference: z.object({
    lowMinor: z.number().int().positive(),
    medianMinor: z.number().int().positive(),
    highMinor: z.number().int().positive(),
    currency: z.string().length(3),
    sampleSize: z.number().int().positive(),
    disclaimer: z.literal('Observed negotiation prices only; not an external market estimate.'),
  }).strict().nullable(),
  coverage: z.object({
    includedOffers: z.number().int().nonnegative(),
    totalOffers: z.number().int().nonnegative(),
  }).strict(),
  analysis: negotiationAnalysisModelSchema.nullable(),
  notice: z.string().nullable(),
}).strict();

export const negotiationSummaryModelSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  keyChanges: z.array(z.string().trim().min(1).max(300)).max(8),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();

export const negotiationSummaryResponseSchema = z.object({
  action: z.literal('summarize'),
  source: z.enum(['gemini', 'deterministic']),
  summary: negotiationSummaryModelSchema.nullable(),
  coverage: z.object({
    includedOffers: z.number().int().nonnegative(),
    totalOffers: z.number().int().nonnegative(),
    includedEvents: z.number().int().nonnegative(),
    totalEvents: z.number().int().nonnegative(),
  }).strict(),
  notice: z.string().nullable(),
}).strict();

export const contractAnalysisModelSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  clauses: z.array(z.object({
    field: z.enum([
      'paymentConditions',
      'deliveryConditions',
      'terminationConditions',
      'service.description',
    ]),
    excerpt: z.string().trim().min(1).max(500),
    concern: z.string().trim().min(1).max(500),
    question: z.string().trim().min(1).max(300),
    severity: z.enum(['low', 'medium', 'high']),
  }).strict()).max(12),
}).strict();

export const contractAnalysisResponseSchema = z.object({
  action: z.literal('analyze'),
  source: z.literal('gemini'),
  analysis: contractAnalysisModelSchema,
  disclaimer: z.literal('AI-generated review aid only; not legal advice or a determination of enforceability.'),
}).strict();

export const negotiationIntelligenceResponseSchema = z.discriminatedUnion('action', [
  negotiationRecommendationResponseSchema,
  mandateExplanationResponseSchema,
  offerComparisonResponseSchema,
  negotiationSummaryResponseSchema,
  negotiationAnalysisResponseSchema,
]);

export const contractAnalysisRequestSchema = z.object({}).strict();

export type NegotiationIntelligenceRequest = z.infer<typeof negotiationIntelligenceRequestSchema>;
export type NegotiationRecommendationResponse = z.infer<typeof negotiationRecommendationResponseSchema>;
export type OfferComparisonResponse = z.infer<typeof offerComparisonResponseSchema>;
export type NegotiationSummaryResponse = z.infer<typeof negotiationSummaryResponseSchema>;
export type NegotiationAnalysisResponse = z.infer<typeof negotiationAnalysisResponseSchema>;
export type ContractAnalysisResponse = z.infer<typeof contractAnalysisResponseSchema>;
export type NegotiationIntelligenceResponse = z.infer<typeof negotiationIntelligenceResponseSchema>;
