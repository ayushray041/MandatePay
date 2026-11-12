'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  negotiationEventSchema,
  negotiationDisputeSchema,
  negotiationOfferRecordSchema,
  negotiationRecordSchema,
  negotiationSnapshotSchema,
  negotiationStrategyProfileSchema,
  type NegotiationOfferTerms,
  type NegotiationRecord,
  type NegotiationStrategyProfile,
} from '@/models/negotiation';
import {
  negotiationIntelligenceResponseSchema,
  type NegotiationIntelligenceResponse,
} from '@/models/ai';

const negotiationDetailRecordSchema = negotiationRecordSchema.extend({
  initiatorDisplayName: z.string().optional(),
  recipientDisplayName: z.string().optional(),
});

const negotiationDetailSchema = z.object({
  negotiation: negotiationDetailRecordSchema,
  offers: z.array(negotiationOfferRecordSchema),
  events: z.array(negotiationEventSchema),
  versions: z.array(negotiationSnapshotSchema),
  dispute: negotiationDisputeSchema.nullable(),
}).strict();

export type NegotiationDetail = z.infer<typeof negotiationDetailSchema>;
const negotiationBatchResponseSchema = z.object({
  batchId: z.string().min(1),
  negotiations: z.array(negotiationRecordSchema).min(2).max(10),
}).strict();
const negotiationReplaySchema = z.object({
  negotiationId: z.string().min(1),
  currentVersion: z.number().int().positive(),
  snapshots: z.array(negotiationSnapshotSchema),
}).strict();
const negotiationBatchComparisonSchema = z.object({
  batchId: z.string().min(1),
  entries: z.array(z.object({
    negotiationId: z.string().min(1),
    recipientAgentId: z.string().min(1),
    recipientDisplayName: z.string(),
    status: z.string(),
    offerCount: z.number().int().nonnegative(),
    latestOffer: z.object({
      title: z.string(),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      deliveryDays: z.number().int().positive(),
    }).strict().nullable(),
  }).strict()).max(10),
}).strict();
const negotiationAnalyticsSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  windowTruncated: z.boolean(),
  statusCounts: z.record(z.string(), z.number().int().nonnegative()),
  averageOffersPerNegotiation: z.number().nonnegative(),
  acceptanceRate: z.number().min(0).max(1).nullable(),
  averageResolutionMs: z.number().nonnegative().nullable(),
}).strict();

export async function listNegotiations(): Promise<NegotiationRecord[]> {
  return authenticatedApiRequest(
    '/api/negotiations',
    z.array(negotiationRecordSchema),
    {},
    'Negotiation request failed.',
  );
}

export async function getNegotiation(
  negotiationId: string,
): Promise<NegotiationDetail> {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}`,
    negotiationDetailSchema,
    {},
    'Negotiation request failed.',
  );
}

export async function createNegotiation(input: {
  mandateId: string;
  recipientAgentId: string;
  title: string;
  expiresAt: string;
}): Promise<NegotiationRecord> {
  return authenticatedApiRequest(
    '/api/negotiations',
    negotiationRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Negotiation request failed.',
  );
}

export async function createNegotiationBatch(input: {
  mandateId: string;
  recipientAgentIds: string[];
  title: string;
  expiresAt: string;
}): Promise<z.infer<typeof negotiationBatchResponseSchema>> {
  return authenticatedApiRequest(
    '/api/negotiations',
    negotiationBatchResponseSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Negotiation batch could not be created.',
  );
}

export async function submitNegotiationOffer(
  negotiationId: string,
  input: { mandateId?: string; expectedOfferId: string | null; terms: NegotiationOfferTerms },
): Promise<void> {
  await authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/offers`,
    negotiationOfferRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Offer submission failed.',
  );
}

export async function decideNegotiation(
  negotiationId: string,
  input: {
    decision: 'accept' | 'reject' | 'cancel';
    mandateId?: string;
    reason?: string;
    expectedOfferId: string | null;
  },
): Promise<NegotiationRecord> {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/decision`,
    negotiationRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Negotiation decision failed.',
  );
}

export async function decideNegotiationOwnerApproval(
  negotiationId: string,
  input: { decision: 'approve' | 'reject'; reason?: string; expectedOfferId: string },
): Promise<NegotiationRecord> {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/owner-approval`,
    negotiationRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Owner approval failed.',
  );
}

export async function getNegotiationReplay(negotiationId: string) {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/replay`,
    negotiationReplaySchema,
    {},
    'Negotiation replay could not be loaded.',
  );
}

export async function getNegotiationBatchComparison(batchId: string) {
  return authenticatedApiRequest(
    `/api/negotiations/batches/${encodeURIComponent(batchId)}`,
    negotiationBatchComparisonSchema,
    {},
    'Negotiation batch comparison could not be loaded.',
  );
}

export async function getNegotiationAnalytics() {
  return authenticatedApiRequest(
    '/api/negotiations/analytics',
    negotiationAnalyticsSchema,
    {},
    'Negotiation analytics could not be loaded.',
  );
}

export async function getNegotiationStrategy(): Promise<NegotiationStrategyProfile> {
  return authenticatedApiRequest(
    '/api/negotiations/strategy',
    negotiationStrategyProfileSchema,
    {},
    'Negotiation strategy could not be loaded.',
  );
}

export async function saveNegotiationStrategy(profile: NegotiationStrategyProfile): Promise<void> {
  await authenticatedApiRequest(
    '/api/negotiations/strategy',
    negotiationStrategyProfileSchema,
    { method: 'PUT', body: JSON.stringify(profile) },
    'Negotiation strategy could not be saved.',
  );
}

export async function escalateNegotiationDispute(
  negotiationId: string,
  input: { category: 'delivery' | 'quality' | 'payment' | 'scope' | 'other'; reason: string },
) {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/disputes`,
    negotiationDisputeSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Dispute escalation failed.',
  );
}

export function requestNegotiationIntelligence(
  negotiationId: string,
  input:
    | { action: 'recommend' | 'compare' | 'summarize' | 'analyze' }
    | { action: 'explain_violation'; terms: NegotiationOfferTerms },
): Promise<NegotiationIntelligenceResponse> {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/intelligence`,
    negotiationIntelligenceResponseSchema,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    'Negotiation intelligence could not be loaded.',
  );
}
