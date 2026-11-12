'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  negotiationEventSchema,
  negotiationOfferRecordSchema,
  negotiationRecordSchema,
  type NegotiationOfferTerms,
  type NegotiationRecord,
} from '@/models/negotiation';

const negotiationDetailRecordSchema = negotiationRecordSchema.extend({
  initiatorDisplayName: z.string().optional(),
  recipientDisplayName: z.string().optional(),
});

const negotiationDetailSchema = z.object({
  negotiation: negotiationDetailRecordSchema,
  offers: z.array(negotiationOfferRecordSchema),
  events: z.array(negotiationEventSchema),
}).strict();

export type NegotiationDetail = z.infer<typeof negotiationDetailSchema>;

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

export async function submitNegotiationOffer(
  negotiationId: string,
  input: { mandateId?: string; terms: NegotiationOfferTerms },
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
  },
): Promise<NegotiationRecord> {
  return authenticatedApiRequest(
    `/api/negotiations/${encodeURIComponent(negotiationId)}/decision`,
    negotiationRecordSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Negotiation decision failed.',
  );
}
