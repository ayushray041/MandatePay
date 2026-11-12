import { describe, expect, it } from 'vitest';
import {
  mandateCreateSchema,
  mandateUpdateSchema,
} from '@/models/mandate';

const validMandate = {
  title: 'Freelance agreement',
  description: 'Manage the approved project scope.',
  authorizedAgentId: 'agent-123',
  spendingLimitMinor: 125_000,
  currency: 'USD',
  startsAt: '2026-11-12T05:00:00.000Z',
  expiresAt: '2026-12-12T05:00:00.000Z',
  allowedOperations: ['contract.create', 'payment.authorize'],
  approvalRequirements: {
    ownerApprovalOperations: ['payment.authorize'],
    ownerApprovalAboveMinor: 50_000,
  },
  executionConditions: {
    maximumOperationAmountMinor: 75_000,
    requiredDescriptionTerms: ['project alpha'],
  },
};

describe('mandate schemas', () => {
  it('accepts a complete policy with supported currency and operation constraints', () => {
    expect(mandateCreateSchema.safeParse(validMandate).success).toBe(true);
  });

  it('rejects invalid date order, unsupported currency, and per-operation limits above the mandate cap', () => {
    expect(mandateCreateSchema.safeParse({
      ...validMandate,
      expiresAt: validMandate.startsAt,
    }).success).toBe(false);
    expect(mandateCreateSchema.safeParse({
      ...validMandate,
      currency: 'NOT-A-CURRENCY',
    }).success).toBe(false);
    expect(mandateCreateSchema.safeParse({
      ...validMandate,
      currency: 'ZZZ',
    }).success).toBe(false);
    expect(mandateCreateSchema.safeParse({
      ...validMandate,
      executionConditions: { maximumOperationAmountMinor: 125_001, requiredDescriptionTerms: [] },
    }).success).toBe(false);
  });

  it('rejects unknown fields and empty updates', () => {
    expect(mandateCreateSchema.safeParse({
      ...validMandate,
      ownerId: 'forged-owner',
    }).success).toBe(false);
    expect(mandateUpdateSchema.safeParse({}).success).toBe(false);
    expect(mandateUpdateSchema.safeParse({ status: 'active' }).success).toBe(false);
  });
});
