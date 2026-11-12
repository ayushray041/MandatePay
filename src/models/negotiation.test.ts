import { describe, expect, it } from 'vitest';
import {
  negotiationCreateSchema,
  negotiationDecisionSchema,
  negotiationOwnerApprovalSchema,
  negotiationOfferSubmitSchema,
  negotiationOfferTermsSchema,
  negotiationStatuses,
} from '@/models/negotiation';

const terms = {
  title: 'API integration',
  category: 'software',
  description: 'Build and document the billing service integration.',
  amountMinor: 125_000,
  currency: 'USD',
  deliveryDays: 14,
};

describe('negotiation schemas', () => {
  it('defines all required workflow states and accepts valid service terms', () => {
    expect(negotiationStatuses).toEqual([
      'initiated',
      'offer_submitted',
      'counter_offered',
      'pending_owner_approval',
      'accepted',
      'rejected',
      'expired',
      'cancelled',
    ]);
    expect(negotiationOfferTermsSchema.safeParse(terms).success).toBe(true);
  });

  it('rejects invalid amount precision, currency and unexpected offer fields', () => {
    expect(negotiationOfferTermsSchema.safeParse({ ...terms, amountMinor: 1.5 }).success).toBe(false);
    expect(negotiationOfferTermsSchema.safeParse({ ...terms, currency: 'ZZZ' }).success).toBe(false);
    expect(negotiationOfferTermsSchema.safeParse({ ...terms, ownerId: 'forged' }).success).toBe(false);
  });

  it('requires an expiry and validates the request shape', () => {
    const request = {
      mandateId: 'mandate-1',
      recipientAgentId: 'agent-2',
      title: 'Billing integration',
      expiresAt: '2026-11-19T10:00:00.000Z',
    };
    expect(negotiationCreateSchema.safeParse(request).success).toBe(true);
    expect(negotiationCreateSchema.safeParse({
      ...request,
      expiresAt: 'not-a-date',
    }).success).toBe(false);
  });

  it('requires rejection reasons and disallows unsupported transitions', () => {
    expect(negotiationDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(negotiationDecisionSchema.safeParse({ decision: 'accept', reason: 'No' }).success).toBe(false);
    expect(negotiationDecisionSchema.safeParse({ decision: 'cancel' }).success).toBe(true);
  });

  it('requires a reason when a mandate owner rejects terms', () => {
    expect(negotiationOwnerApprovalSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(negotiationOwnerApprovalSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(negotiationOwnerApprovalSchema.safeParse({
      decision: 'reject',
      reason: 'Outside mandate scope.',
    }).success).toBe(true);
  });

  it('requires a participant mandate for offer submissions', () => {
    expect(negotiationOfferSubmitSchema.safeParse({ terms }).success).toBe(true);
    expect(negotiationOfferSubmitSchema.safeParse({
      mandateId: 'mandate-2',
      terms: { ...terms, amountMinor: 0 },
    }).success).toBe(false);
  });
});
