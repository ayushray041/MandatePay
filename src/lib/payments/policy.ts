import { timestampToIso } from '@/lib/mandates/format';
import { assertExecutionAllowed } from '@/lib/mandates/policy';
import { MandateError } from '@/lib/mandates/errors';
import {
  contractExpiryStatus,
  contractReservationUsageWindowKeys,
} from '@/lib/contracts/policy';
import { PaymentError } from '@/lib/payments/errors';
import type { ContractTerms } from '@/models/contract';

type StoredData = Record<string, unknown>;

function assertActiveMandate(
  mandate: StoredData,
  ownerId: string,
  agentId: string,
  now: Date,
): void {
  const start = timestampToIso(mandate.startsAt);
  const expiry = timestampToIso(mandate.expiresAt);
  const permanent = mandate.durationType === 'permanent' && mandate.expiresAt == null;
  if (
    mandate.ownerId !== ownerId
    || mandate.authorizedAgentId !== agentId
    || mandate.status !== 'active'
    || !start
    || (!expiry && !permanent)
    || Date.parse(start) > now.getTime()
    || (expiry !== null && Date.parse(expiry) <= now.getTime())
  ) {
    throw new PaymentError(
      409,
      'MANDATE_NOT_ACTIVE',
      'Both contract mandates must remain active and assigned to the approved parties.',
    );
  }
}

function assertContractApprovals(contract: StoredData): void {
  const requiredApproverIds = contract.requiredApproverIds;
  const approvals = contract.approvals;
  if (
    !Array.isArray(requiredApproverIds)
    || !Array.isArray(approvals)
    || !requiredApproverIds.every((uid) => approvals.includes(uid))
  ) {
    throw new PaymentError(
      409,
      'CONTRACT_NOT_APPROVED',
      'All required contract approvals must be recorded before payment.',
    );
  }
}

export function assertPaymentInitiationAllowed(input: {
  contract: StoredData;
  terms: ContractTerms;
  mandates: [StoredData, StoredData];
  uid: string;
  now: Date;
}): {
  payerId: string;
  payerMandateId: string;
  payeeId: string;
  payeeMandateId: string;
} {
  const { contract, terms, mandates, uid, now } = input;
  if (contract.status !== 'active' || contractExpiryStatus(
    contract.status,
    contract.expiresAt,
    now,
  ) !== 'active') {
    throw new PaymentError(409, 'CONTRACT_NOT_ACTIVE', 'Only an active contract can be paid.');
  }
  assertContractApprovals(contract);

  const clientParties = terms.parties.filter((party) => party.role === 'client');
  const freelancerParties = terms.parties.filter((party) => party.role === 'freelancer');
  if (clientParties.length !== 1 || freelancerParties.length !== 1) {
    throw new PaymentError(409, 'INVALID_CONTRACT_PARTIES', 'Contract must identify exactly one payer and one payee.');
  }
  const payer = clientParties[0];
  const payee = freelancerParties[0];
  if (payer.userId !== uid) {
    throw new PaymentError(403, 'FORBIDDEN', 'Only the approved client account can initiate payment.');
  }
  if (
    !Array.isArray(contract.mandateIds)
    || contract.mandateIds[0] !== terms.parties[0].mandateId
    || contract.mandateIds[1] !== terms.parties[1].mandateId
  ) {
    throw new PaymentError(409, 'INVALID_CONTRACT', 'Contract mandate references do not match the approved version.');
  }

  const payerIndex = terms.parties[0].userId === payer.userId ? 0 : 1;
  const payeeIndex = payerIndex === 0 ? 1 : 0;
  const payerMandate = mandates[payerIndex];
  const payeeMandate = mandates[payeeIndex];
  assertActiveMandate(payerMandate, payer.userId, payer.agentId, now);
  assertActiveMandate(payeeMandate, payee.userId, payee.agentId, now);
  if (
    payerMandate.currency !== terms.currency
    || payeeMandate.currency !== terms.currency
  ) {
    throw new PaymentError(409, 'MANDATE_CURRENCY_MISMATCH', 'Contract currency no longer matches both mandates.');
  }

  const payerReservation = payerMandate.reservedAmountMinor;
  const payeeReservation = payeeMandate.reservedAmountMinor;
  if (
    typeof payerReservation !== 'number'
    || typeof payeeReservation !== 'number'
    || !Number.isSafeInteger(payerReservation)
    || !Number.isSafeInteger(payeeReservation)
    || payerReservation < terms.amountMinor
    || payeeReservation < terms.amountMinor
  ) {
    throw new PaymentError(
      409,
      'INVALID_RESERVATION',
      'The approved contract reservation is not available on both mandates.',
    );
  }

  try {
    const requiresOwnerApproval = assertExecutionAllowed(
      {
        ...payerMandate,
        reservedAmountMinor: payerReservation - terms.amountMinor,
      },
      'payment.authorize',
      terms.amountMinor,
      `${terms.service.title} ${terms.service.description}`,
      now,
      {
        enforceVelocity: true,
        serviceCategory: terms.service.category,
        contractDurationDays: Math.max(
          1,
          Math.ceil((Date.parse(terms.expiresAt) - now.getTime()) / 86_400_000),
        ),
        excludeVelocityReservationAmountMinor: terms.amountMinor,
        excludeVelocityUsageWindowKeys: contractReservationUsageWindowKeys(
          contract.reservationUsageWindowKeys,
        )?.[payerIndex],
      },
    );
    if (requiresOwnerApproval && payer.userId !== uid) {
      throw new PaymentError(
        403,
        'OWNER_APPROVAL_REQUIRED',
        'The client mandate owner must initiate this payment.',
      );
    }
  } catch (error: unknown) {
    if (error instanceof PaymentError) {
      throw error;
    }
    if (error instanceof MandateError) {
      throw new PaymentError(error.status, error.code, error.message);
    }
    throw error;
  }

  return {
    payerId: payer.userId,
    payerMandateId: payer.mandateId,
    payeeId: payee.userId,
    payeeMandateId: payee.mandateId,
  };
}
