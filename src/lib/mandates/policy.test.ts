import { describe, expect, it } from 'vitest';
import { MandateError } from '@/lib/mandates/errors';
import {
  assertExecutionAllowed,
  assertOwner,
  assertOwnerOrAgent,
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
});
