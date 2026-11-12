import { z } from 'zod';
import { mandateCurrencySchema } from '@/models/mandate';
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

const aiAdvisoryMetadataShape = {
  confidenceScore: z.number().min(0).max(1).nullable().optional(),
  confidenceMethod: z.enum([
    'sample_size_heuristic',
    'not_calibrated',
    'deterministic_rule',
  ]).optional(),
  requiresHumanReview: z.boolean().optional(),
};

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
  ...aiAdvisoryMetadataShape,
}).strict();

export const mandateExplanationResponseSchema = z.object({
  action: z.literal('explain_violation'),
  source: z.literal('deterministic'),
  mandateAssessment: mandateAssessmentSchema,
  ...aiAdvisoryMetadataShape,
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
  ...aiAdvisoryMetadataShape,
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
  ...aiAdvisoryMetadataShape,
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
  ...aiAdvisoryMetadataShape,
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
  source: z.enum(['gemini', 'deterministic']),
  analysis: contractAnalysisModelSchema.nullable(),
  notice: z.string().nullable(),
  disclaimer: z.literal('AI-generated review aid only; not legal advice or a determination of enforceability.'),
  ...aiAdvisoryMetadataShape,
}).strict();

export const aiRiskSignalSchema = z.object({
  code: z.string().min(1).max(80),
  severity: z.enum(['informational', 'medium', 'high']),
  explanation: z.string().min(1).max(400),
  evidence: z.array(z.string().max(200)).max(8),
}).strict();

export const aiRiskAssessmentSchema = z.object({
  action: z.enum([
    'payment_anomaly',
    'spending_forecast',
    'vendor_risk',
    'agent_behavior',
  ]),
  source: z.literal('deterministic'),
  riskScore: z.number().int().min(0).max(100).nullable(),
  riskLevel: z.enum(['low', 'medium', 'high', 'insufficient_data']),
  confidence: z.object({
    score: z.number().min(0).max(1),
    method: z.literal('sample_size_heuristic'),
  }).strict(),
  requiresHumanReview: z.boolean(),
  summary: z.string().min(1).max(500),
  signals: z.array(aiRiskSignalSchema).max(10),
  evidence: z.object({
    sampleSize: z.number().int().nonnegative(),
    observationWindowDays: z.number().int().positive(),
  }).strict(),
  priceEstimate: z.object({
    medianMinor: z.number().int().positive(),
    lowMinor: z.number().int().positive(),
    highMinor: z.number().int().positive(),
    currency: z.string().length(3),
    sampleSize: z.number().int().min(3),
    basis: z.literal('observed_completed_payments_only'),
  }).strict().nullable(),
  spendingForecast: z.object({
    projectedSpendMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    horizonDays: z.number().int().positive(),
    sampleSize: z.number().int().positive(),
    basis: z.literal('historical_daily_average'),
  }).strict().nullable(),
}).strict();

export const aiRiskRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('payment_anomaly'),
    paymentId: z.string().trim().min(1).max(128).refine((id) => !id.includes('/')),
  }).strict(),
  z.object({
    action: z.literal('spending_forecast'),
    currency: mandateCurrencySchema,
  }).strict(),
  z.object({
    action: z.literal('vendor_risk'),
    vendorId: z.string().trim().min(1).max(128).refine((id) => !id.includes('/')),
    currency: mandateCurrencySchema,
  }).strict(),
  z.object({ action: z.literal('agent_behavior') }).strict(),
]);

export const aiHistoryActionSchema = z.enum([
  'negotiation_recommendation',
  'offer_comparison',
  'negotiation_summary',
  'negotiation_analysis',
  'contract_analysis',
  'mandate_explanation',
  'payment_anomaly',
  'spending_forecast',
  'vendor_risk',
  'agent_behavior',
]);

export const aiDecisionHistoryEntrySchema = z.object({
  id: z.string().min(1),
  action: aiHistoryActionSchema,
  resourceType: z.enum(['negotiation', 'contract', 'payment', 'agent']),
  resourceId: z.string().min(1),
  source: z.enum(['gemini', 'deterministic']),
  providerId: z.string().nullable(),
  modelVersion: z.string().nullable(),
  promptVersion: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).nullable(),
  confidenceMethod: z.enum([
    'sample_size_heuristic',
    'not_calibrated',
    'deterministic_rule',
  ]),
  requiresHumanReview: z.boolean(),
  evidence: z.array(z.object({
    type: z.string().min(1).max(80),
    reference: z.string().max(160),
    sampleSize: z.number().int().nonnegative().nullable(),
  }).strict()).max(20),
  result: z.unknown(),
  createdAt: z.string().nullable(),
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
export type AiRiskAssessment = z.infer<typeof aiRiskAssessmentSchema>;
export type AiDecisionHistoryEntry = z.infer<typeof aiDecisionHistoryEntrySchema>;
export type NegotiationIntelligenceResponse = z.infer<typeof negotiationIntelligenceResponseSchema>;
