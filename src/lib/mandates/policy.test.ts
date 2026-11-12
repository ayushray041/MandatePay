import { describe, expect, it } from 'vitest';
import { MandateError } from '@/lib/mandates/errors';
import {
  addMandateVelocityUsage,
  assertExecutionAllowed,
  assertOwner,
  assertOwnerOrAgent,
  getMandateUsageWindowKeys,
  releaseMandateVelocityUsage,
} from '@/lib/mandates/policy';

const activeMandate = {
  ownerId: 'owner-1',
  authorizedAgentId: 'agent-1',
  status: 'active',
  startsAt: new Date('2026-11-01T00:00:00.000Z'),
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  spendingLimitMinor: 20_000,
  spentAmountMinor: 5_000,
  allowedOperations: ['payment.authorize'],
  approvalRequirements: {
    ownerApprovalOperations: [],
    ownerApprovalAboveMinor: 10_000,
  },
  executionConditions: {
    maximumOperationAmountMinor: 12_000,
    requiredDescriptionTerms: ['project alpha'],
  },
};

const now = new Date('2026-11-12T00:00:00.000Z');

describe('mandate authorization policy', () => {
  it('allows an in-policy operation and requires approval above configured thresholds', () => {
    expect(assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      7_000,
      'Payment for Project Alpha milestone',
      now,
    )).toBe(false);

    expect(assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      10_500,
      'Payment for Project Alpha milestone',
      now,
    )).toBe(true);
  });

  it('rejects operations outside the allowed set and custom execution conditions', () => {
    expect(() => assertExecutionAllowed(
      activeMandate,
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
    )).toThrowError(MandateError);

    expect(() => assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      1_000,
      'Unrelated work',
      now,
    )).toThrowError(/description does not meet/);

    expect(() => assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      12_001,
      'Project Alpha work',
      now,
    )).toThrowError(/per-operation spending condition/);
  });

  it('enforces remaining budget, active dates, expiry, and ownership boundaries', () => {
    expect(() => assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      15_001,
      'Project Alpha work',
      now,
    )).toThrowError(/remaining mandate budget/);

    expect(() => assertExecutionAllowed(
      { ...activeMandate, status: 'paused' },
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
    )).toThrowError(/not active/);

    expect(() => assertExecutionAllowed(
      activeMandate,
      'payment.authorize',
      1_000,
      'Project Alpha work',
      new Date('2026-12-01T00:00:00.000Z'),
    )).toThrowError(/expired/);

    expect(() => assertOwner(activeMandate, 'agent-1')).toThrowError(/Only the mandate owner/);
    expect(() => assertOwnerOrAgent(activeMandate, 'stranger')).toThrowError(/not found/);
  });

  it('counts accepted negotiation reservations against later spending', () => {
    expect(() => assertExecutionAllowed(
      { ...activeMandate, reservedAmountMinor: 8_000 },
      'payment.authorize',
      7_001,
      'Project Alpha work',
      now,
    )).toThrowError(/remaining mandate budget/);
    expect(assertExecutionAllowed(
      { ...activeMandate, reservedAmountMinor: 8_000 },
      'payment.authorize',
      7_000,
      'Project Alpha work',
      now,
    )).toBe(false);
  });

  it('enforces UTC velocity boundaries and resets stale period counters', () => {
    const mandate = {
      ...activeMandate,
      spendingLimitMinor: 50_000,
      spentAmountMinor: 0,
      velocityUsage: {
        totalTransactionCount: 2,
        daily: { periodKey: '2026-11-12', amountMinor: 9_000, transactionCount: 2 },
        weekly: { periodKey: '2026-W45', amountMinor: 20_000, transactionCount: 2 },
        monthly: { periodKey: '2026-10', amountMinor: 40_000, transactionCount: 2 },
      },
      executionConditions: {
        ...activeMandate.executionConditions,
        dailyLimitMinor: 10_000,
        maximumTransactionCount: 3,
      },
    };
    expect(assertExecutionAllowed(
      mandate,
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
      { enforceVelocity: true },
    )).toBe(false);
    expect(() => assertExecutionAllowed(
      mandate,
      'payment.authorize',
      1_001,
      'Project Alpha work',
      now,
      { enforceVelocity: true },
    )).toThrowError(/daily spending limit/);
    expect(() => assertExecutionAllowed(
      {
        ...mandate,
        velocityUsage: {
          ...mandate.velocityUsage,
          totalTransactionCount: 3,
          daily: { periodKey: '2026-11-11', amountMinor: 10_000, transactionCount: 3 },
        },
      },
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
      { enforceVelocity: true },
    )).toThrowError(/transaction count limit/);
  });

  it('fails closed without trusted vendor, category, geography, or duration context', () => {
    const constrained = {
      ...activeMandate,
      executionConditions: {
        ...activeMandate.executionConditions,
        allowedVendorIds: ['vendor-1'],
      },
    };
    expect(() => assertExecutionAllowed(
      constrained,
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
    )).toThrowError(/trusted server-side vendor identity/);
    expect(assertExecutionAllowed(
      constrained,
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
      { vendorId: 'vendor-1' },
    )).toBe(false);
    expect(() => assertExecutionAllowed(
      {
        ...activeMandate,
        executionConditions: {
          ...activeMandate.executionConditions,
          allowedCountries: ['US'],
        },
      },
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
      { countryCode: 'GB' },
    )).toThrowError(/not allowed/);
    expect(() => assertExecutionAllowed(
      {
        ...activeMandate,
        executionConditions: {
          ...activeMandate.executionConditions,
          allowedCategories: ['software'],
        },
      },
      'payment.authorize',
      1_000,
      'Project Alpha work',
      now,
    )).toThrowError(/service category is not approved/);
    expect(() => assertExecutionAllowed(
      {
        ...activeMandate,
        allowedOperations: ['contract.create'],
        executionConditions: {
          ...activeMandate.executionConditions,
          maximumContractDurationDays: 30,
        },
      },
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
    )).toThrowError(/duration exceeds/);
  });

  it('enforces assigned-agent, blocked-vendor, category, contract-duration, and recurring caps', () => {
    const constrained = {
      ...activeMandate,
      allowedOperations: ['contract.create', 'payment.authorize'],
      executionConditions: {
        ...activeMandate.executionConditions,
        agentSpendingLimitMinor: 6_000,
        blockedVendorIds: ['blocked-vendor'],
        allowedCategories: ['software'],
        maximumContractDurationDays: 10,
        recurringPeriod: 'monthly',
        recurringLimitMinor: 10_000,
      },
      velocityUsage: {
        totalTransactionCount: 0,
        monthly: { periodKey: '2026-11', amountMinor: 9_000, transactionCount: 0 },
      },
    };
    expect(assertExecutionAllowed(
      constrained,
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
      {
        enforceVelocity: true,
        vendorId: 'approved-vendor',
        serviceCategory: 'software',
        contractDurationDays: 10,
      },
    )).toBe(false);
    expect(() => assertExecutionAllowed(
      constrained,
      'payment.authorize',
      1_001,
      'Project Alpha work',
      now,
      { vendorId: 'approved-vendor', enforceVelocity: true },
    )).toThrowError(/this agent’s spending limit/);
    expect(() => assertExecutionAllowed(
      {
        ...constrained,
        executionConditions: {
          ...constrained.executionConditions,
          agentSpendingLimitMinor: 10_000,
        },
      },
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
      { vendorId: 'blocked-vendor', serviceCategory: 'software', contractDurationDays: 10 },
    )).toThrowError(/vendor is blocked/);
    expect(() => assertExecutionAllowed(
      constrained,
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
      { vendorId: 'approved-vendor', serviceCategory: 'design', contractDurationDays: 10 },
    )).toThrowError(/service category is not approved/);
    expect(() => assertExecutionAllowed(
      constrained,
      'contract.create',
      1_000,
      'Project Alpha work',
      now,
      { vendorId: 'approved-vendor', serviceCategory: 'software', contractDurationDays: 11 },
    )).toThrowError(/duration exceeds/);
    expect(() => assertExecutionAllowed(
      {
        ...constrained,
        executionConditions: {
          ...constrained.executionConditions,
          agentSpendingLimitMinor: 10_000,
        },
      },
      'contract.create',
      1_001,
      'Project Alpha work',
      now,
      {
        enforceVelocity: true,
        vendorId: 'approved-vendor',
        serviceCategory: 'software',
        contractDurationDays: 10,
      },
    )).toThrowError(/recurring monthly spending limit/);
  });

  it('records and releases a reservation in the exact UTC usage windows', () => {
    const keys = getMandateUsageWindowKeys(now);
    expect(keys).toEqual({ daily: '2026-11-12', weekly: '2026-W46', monthly: '2026-11' });
    const reservation = addMandateVelocityUsage(
      { velocityUsage: { totalTransactionCount: 0 } },
      2_500,
      now,
    );
    expect(reservation.velocityUsage.daily).toEqual({
      periodKey: keys.daily,
      amountMinor: 2_500,
      transactionCount: 1,
    });
    expect(releaseMandateVelocityUsage(
      { velocityUsage: reservation.velocityUsage },
      2_500,
      reservation.usageWindowKeys,
    )).toMatchObject({
      daily: { amountMinor: 0, transactionCount: 0 },
      totalTransactionCount: 0,
    });
  });
});
