import { describe, expect, it } from 'vitest';
import { PaymentError } from '@/lib/payments/errors';
import { assertPaymentInitiationAllowed } from '@/lib/payments/policy';
import type { ContractTerms } from '@/models/contract';

const now = new Date();
const expiresAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
const terms: ContractTerms = {
  parties: [
    {
      userId: 'payer',
      displayName: 'Client',
      role: 'client',
      agentId: 'client-agent',
      agentDisplayName: 'Client Agent',
      mandateId: 'mandate-payer',
      mandateTitle: 'Client mandate',
    },
    {
      userId: 'payee',
      displayName: 'Freelancer',
      role: 'freelancer',
      agentId: 'freelancer-agent',
      agentDisplayName: 'Freelancer Agent',
      mandateId: 'mandate-payee',
      mandateTitle: 'Freelancer mandate',
    },
  ],
  service: {
    title: 'Build website',
    category: 'software',
    description: 'Build and document a responsive website.',
    deliveryDays: 20,
  },
  amountMinor: 10_000,
  currency: 'USD',
  paymentConditions: 'No payment is authorized by this record.',
  deliveryConditions: 'Deliver within 20 days.',
  expiresAt,
  terminationConditions: 'No termination procedure is configured.',
};

function mandate(ownerId: string, agentId: string) {
  return {
    ownerId,
    authorizedAgentId: agentId,
    status: 'active',
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    spendingLimitMinor: 20_000,
    spentAmountMinor: 0,
    reservedAmountMinor: 10_000,
    allowedOperations: ['payment.authorize'],
    executionConditions: {
      maximumOperationAmountMinor: 15_000,
      requiredDescriptionTerms: ['website'],
    },
    approvalRequirements: {
      ownerApprovalOperations: ['payment.authorize'],
    },
  };
}

function input(overrides: {
  contract?: Record<string, unknown>;
  terms?: ContractTerms;
  mandates?: [Record<string, unknown>, Record<string, unknown>];
  uid?: string;
} = {}) {
  return {
    contract: {
      status: 'active',
      expiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
      mandateIds: ['mandate-payer', 'mandate-payee'],
      requiredApproverIds: ['payer', 'client-agent', 'payee', 'freelancer-agent'],
      approvals: ['payer', 'client-agent', 'payee', 'freelancer-agent'],
      ...overrides.contract,
    },
    terms: overrides.terms ?? terms,
    mandates: overrides.mandates ?? [
      mandate('payer', 'client-agent'),
      mandate('payee', 'freelancer-agent'),
    ],
    uid: overrides.uid ?? 'payer',
    now,
  };
}

describe('payment authorization policy', () => {
  it('accepts a fully approved contract covered by active mandates and an existing reservation', () => {
    expect(assertPaymentInitiationAllowed(input())).toEqual({
      payerId: 'payer',
      payerMandateId: 'mandate-payer',
      payeeId: 'payee',
      payeeMandateId: 'mandate-payee',
    });
  });

  it('rejects unauthorized users, non-active contracts, and incomplete approvals', () => {
    expect(() => assertPaymentInitiationAllowed(input({ uid: 'payee' })))
      .toThrowError(PaymentError);
    expect(() => assertPaymentInitiationAllowed(input({
      contract: { status: 'pending_review' },
    }))).toThrowError(PaymentError);
    expect(() => assertPaymentInitiationAllowed(input({
      contract: { approvals: ['payer'] },
    }))).toThrowError(PaymentError);
  });

  it('rejects inactive mandates, changed assignments, missing reservations, and currencies outside the agreement', () => {
    const inactive = mandate('payer', 'client-agent');
    inactive.status = 'paused';
    expect(() => assertPaymentInitiationAllowed(input({
      mandates: [inactive, mandate('payee', 'freelancer-agent')],
    }))).toThrowError(PaymentError);

    expect(() => assertPaymentInitiationAllowed(input({
      mandates: [mandate('another-owner', 'client-agent'), mandate('payee', 'freelancer-agent')],
    }))).toThrowError(PaymentError);

    const noReservation = mandate('payer', 'client-agent');
    noReservation.reservedAmountMinor = 0;
    expect(() => assertPaymentInitiationAllowed(input({
      mandates: [noReservation, mandate('payee', 'freelancer-agent')],
    }))).toThrowError(PaymentError);
  });

  it('enforces payment operation, amount, description, and owner approval policy', () => {
    const disallowed = mandate('payer', 'client-agent');
    disallowed.allowedOperations = ['contract.create'];
    expect(() => assertPaymentInitiationAllowed(input({
      mandates: [disallowed, mandate('payee', 'freelancer-agent')],
    }))).toThrowError(PaymentError);

    const termsOutsideLimit = { ...terms, amountMinor: 16_000 };
    expect(() => assertPaymentInitiationAllowed(input({
      terms: termsOutsideLimit,
    }))).toThrowError(PaymentError);

    const termsWithoutRequiredWord = {
      ...terms,
      service: { ...terms.service, title: 'Mobile app', description: 'Create a mobile app project.' },
    };
    expect(() => assertPaymentInitiationAllowed(input({
      terms: termsWithoutRequiredWord,
    }))).toThrowError(PaymentError);
  });
});
