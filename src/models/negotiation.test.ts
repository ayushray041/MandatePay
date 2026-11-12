import { describe, expect, it } from 'vitest';
import {
  negotiationCreateSchema,
  negotiationDecisionSchema,
  negotiationOwnerApprovalSchema,
  negotiationOfferSubmitSchema,
  negotiationOfferTermsSchema,
  negotiationStatuses,
  negotiationStrategyProfileSchema,
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
    expect(negotiationCreateSchema.safeParse({
      mandateId: 'mandate-1',
      recipientAgentIds: ['agent-2', 'agent-3'],
      title: 'Billing integration',
      expiresAt: '2026-11-19T10:00:00.000Z',
    }).success).toBe(true);
    expect(negotiationCreateSchema.safeParse({
      mandateId: 'mandate-1',
      recipientAgentIds: ['agent-2', 'agent-2'],
      title: 'Billing integration',
      expiresAt: '2026-11-19T10:00:00.000Z',
    }).success).toBe(false);
  });

  it('requires rejection reasons and disallows unsupported transitions', () => {
    expect(negotiationDecisionSchema.safeParse({ decision: 'reject', expectedOfferId: 'offer-1' }).success).toBe(false);
    expect(negotiationDecisionSchema.safeParse({
      decision: 'accept',
      reason: 'Reviewed terms.',
      expectedOfferId: 'offer-1',
    }).success).toBe(true);
    expect(negotiationDecisionSchema.safeParse({ decision: 'cancel', expectedOfferId: null }).success).toBe(true);
  });

  it('requires a reason when a mandate owner rejects terms', () => {
    expect(negotiationOwnerApprovalSchema.safeParse({
      decision: 'approve',
      expectedOfferId: 'offer-1',
    }).success).toBe(true);
    expect(negotiationOwnerApprovalSchema.safeParse({
      decision: 'reject',
      expectedOfferId: 'offer-1',
    }).success).toBe(false);
    expect(negotiationOwnerApprovalSchema.safeParse({
      decision: 'reject',
      reason: 'Outside mandate scope.',
      expectedOfferId: 'offer-1',
    }).success).toBe(true);
  });

  it('requires a participant mandate for offer submissions', () => {
    expect(negotiationOfferSubmitSchema.safeParse({ terms, expectedOfferId: null }).success).toBe(true);
    expect(negotiationOfferSubmitSchema.safeParse({
      mandateId: 'mandate-2',
      expectedOfferId: null,
      terms: { ...terms, amountMinor: 0 },
    }).success).toBe(false);
  });

  it('validates quantity totals, discount tiers, and negotiated commercial terms', () => {
    const quantityPricing = {
      quantity: 10,
      unitPriceMinor: 1_000,
      volumeDiscounts: [{ minimumQuantity: 2, discountBasisPoints: 1_000 }],
    };
    expect(negotiationOfferTermsSchema.safeParse({
      ...terms,
      amountMinor: 9_000,
      quantityPricing,
      sla: { responseTimeHours: 24, uptimeBasisPoints: 9_950, supportHoursPerWeek: 40 },
      contractTerms: {
        durationMonths: 12,
        renewal: 'annual',
        terminationNoticeDays: 30,
        paymentSchedule: 'milestone',
      },
      conditions: [{ when: 'the first milestone is delivered', then: 'release the next milestone' }],
    }).success).toBe(true);
    expect(negotiationOfferTermsSchema.safeParse({
      ...terms,
      amountMinor: 10_000,
      quantityPricing,
    }).success).toBe(false);
    expect(negotiationOfferTermsSchema.safeParse({
      ...terms,
      amountMinor: 9_000,
      quantityPricing: {
        quantity: 10,
        unitPriceMinor: 1_000,
        volumeDiscounts: [
          { minimumQuantity: 8, discountBasisPoints: 1_000 },
          { minimumQuantity: 4, discountBasisPoints: 2_000 },
        ],
      },
    }).success).toBe(false);
  });

  it('rejects repeated negotiation strategy priorities and excessive concessions', () => {
    expect(negotiationStrategyProfileSchema.safeParse({
      posture: 'balanced',
      priorities: ['price', 'price'],
      concessionStepBasisPoints: 500,
    }).success).toBe(false);
    expect(negotiationStrategyProfileSchema.safeParse({
      posture: 'assertive',
      priorities: ['price'],
      concessionStepBasisPoints: 5_001,
    }).success).toBe(false);
  });
});
