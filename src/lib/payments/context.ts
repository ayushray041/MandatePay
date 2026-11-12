import type {
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { PaymentError } from '@/lib/payments/errors';
import { assertPaymentInitiationAllowed } from '@/lib/payments/policy';
import { timestampToIso } from '@/lib/mandates/format';
import { contractTermsSchema, type ContractTerms } from '@/models/contract';

type StoredData = Record<string, unknown>;

export type ContractPaymentContext = {
  contract: StoredData;
  terms: ContractTerms;
  mandates: [StoredData, StoredData];
  payerId: string;
  payerMandateId: string;
  payeeId: string;
  payeeMandateId: string;
};

export type PaymentLedgerContext = {
  terms: ContractTerms;
  mandates: [StoredData, StoredData];
};

export async function loadPaymentLedgerContext(
  firestore: Firestore,
  transaction: Transaction,
  payment: StoredData,
): Promise<PaymentLedgerContext> {
  const contractId = payment.contractId;
  if (typeof contractId !== 'string' || !contractId) {
    throw new PaymentError(500, 'INVALID_PAYMENT', 'Payment contract reference is invalid.');
  }
  const contractSnapshot = await transaction.get(firestore.collection('contracts').doc(contractId));
  const contract = contractSnapshot.data();
  const versionId = contract?.currentVersionId;
  const mandateIds = contract?.mandateIds;
  if (
    !contractSnapshot.exists
    || typeof versionId !== 'string'
    || !versionId
    || !Array.isArray(mandateIds)
    || mandateIds.length !== 2
    || mandateIds.some((id) => typeof id !== 'string' || !id)
  ) {
    throw new PaymentError(409, 'PAYMENT_AUTHORITY_UNAVAILABLE', 'Contract authority is unavailable.');
  }
  const contractRef = firestore.collection('contracts').doc(contractId);
  const [versionSnapshot, firstMandateSnapshot, secondMandateSnapshot] = await Promise.all([
    transaction.get(contractRef.collection('versions').doc(versionId)),
    transaction.get(firestore.collection('mandates').doc(mandateIds[0])),
    transaction.get(firestore.collection('mandates').doc(mandateIds[1])),
  ]);
  const termsResult = contractTermsSchema.safeParse(versionSnapshot.data()?.terms);
  const firstMandate = firstMandateSnapshot.data();
  const secondMandate = secondMandateSnapshot.data();
  if (
    !versionSnapshot.exists
    || !termsResult.success
    || !firstMandateSnapshot.exists
    || !secondMandateSnapshot.exists
    || !firstMandate
    || !secondMandate
    || termsResult.data.parties[0].mandateId !== mandateIds[0]
    || termsResult.data.parties[1].mandateId !== mandateIds[1]
  ) {
    throw new PaymentError(409, 'PAYMENT_AUTHORITY_UNAVAILABLE', 'Approved contract authority is invalid.');
  }
  const payerIndex = termsResult.data.parties.findIndex((party) => party.userId === payment.payerId);
  const payeeIndex = payerIndex === 0 ? 1 : 0;
  const payerMandate = payerIndex === 0 ? firstMandate : secondMandate;
  const payeeMandate = payerIndex === 0 ? secondMandate : firstMandate;
  if (
    payerIndex < 0
    || termsResult.data.parties[payeeIndex].userId !== payment.payeeId
    || termsResult.data.parties[payerIndex].mandateId !== payment.payerMandateId
    || termsResult.data.parties[payeeIndex].mandateId !== payment.payeeMandateId
    || payerMandate.ownerId !== payment.payerId
    || payeeMandate.ownerId !== payment.payeeId
    || termsResult.data.amountMinor !== payment.amountMinor
    || termsResult.data.currency !== payment.currency
  ) {
    throw new PaymentError(409, 'PAYMENT_CONTRACT_CHANGED', 'Payment no longer matches approved contract records.');
  }
  return {
    terms: termsResult.data,
    mandates: [firstMandate, secondMandate],
  };
}

export async function loadContractPaymentContext(
  firestore: Firestore,
  transaction: Transaction,
  contractId: string,
  uid: string,
  now: Date,
  contractSnapshot?: DocumentSnapshot,
): Promise<ContractPaymentContext> {
  const contractRef = firestore.collection('contracts').doc(contractId);
  const snapshot = contractSnapshot ?? await transaction.get(contractRef);
  if (!snapshot.exists) {
    throw new PaymentError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
  }
  const contract = snapshot.data();
  if (!contract) {
    throw new PaymentError(500, 'INVALID_CONTRACT', 'Contract data is unavailable.');
  }
  const versionId = contract.currentVersionId;
  const mandateIds = contract.mandateIds;
  if (
    typeof versionId !== 'string'
    || !versionId
    || !Array.isArray(mandateIds)
    || mandateIds.length !== 2
    || mandateIds.some((id) => typeof id !== 'string' || !id)
  ) {
    throw new PaymentError(500, 'INVALID_CONTRACT', 'Contract version or mandate references are invalid.');
  }

  const [versionSnapshot, firstMandateSnapshot, secondMandateSnapshot] = await Promise.all([
    transaction.get(contractRef.collection('versions').doc(versionId)),
    transaction.get(firestore.collection('mandates').doc(mandateIds[0])),
    transaction.get(firestore.collection('mandates').doc(mandateIds[1])),
  ]);
  if (!versionSnapshot.exists || !firstMandateSnapshot.exists || !secondMandateSnapshot.exists) {
    throw new PaymentError(409, 'PAYMENT_AUTHORITY_UNAVAILABLE', 'Contract terms or mandate authority are unavailable.');
  }

  const termsResult = contractTermsSchema.safeParse(versionSnapshot.data()?.terms);
  const firstMandate = firstMandateSnapshot.data();
  const secondMandate = secondMandateSnapshot.data();
  if (!termsResult.success || !firstMandate || !secondMandate) {
    throw new PaymentError(500, 'INVALID_CONTRACT', 'Approved contract terms or mandate data are invalid.');
  }
  const policyResult = assertPaymentInitiationAllowed({
    contract,
    terms: termsResult.data,
    mandates: [firstMandate, secondMandate],
    uid,
    now,
  });
  if (
    termsResult.data.parties[0].mandateId !== mandateIds[0]
    || termsResult.data.parties[1].mandateId !== mandateIds[1]
  ) {
    throw new PaymentError(409, 'INVALID_CONTRACT', 'Contract parties do not match the mandate references.');
  }
  return {
    contract,
    terms: termsResult.data,
    mandates: [firstMandate, secondMandate],
    ...policyResult,
  };
}

export function assertPaymentMatchesContract(
  payment: StoredData,
  context: ContractPaymentContext,
  uid: string,
  now: Date,
): void {
  if (
    payment.payerId !== context.payerId
    || payment.payerMandateId !== context.payerMandateId
    || payment.payeeId !== context.payeeId
    || payment.payeeMandateId !== context.payeeMandateId
    || payment.amountMinor !== context.terms.amountMinor
    || payment.currency !== context.terms.currency
    || payment.payerId !== uid
  ) {
    throw new PaymentError(
      409,
      'PAYMENT_CONTRACT_CHANGED',
      'Payment details no longer match the approved contract version.',
    );
  }
  const payerReservation = context.mandates.find(
    (mandate) => mandate.ownerId === context.payerId,
  )?.reservedAmountMinor;
  const payeeReservation = context.mandates.find(
    (mandate) => mandate.ownerId === context.payeeId,
  )?.reservedAmountMinor;
  if (
    typeof payerReservation !== 'number'
    || typeof payeeReservation !== 'number'
    || payerReservation < context.terms.amountMinor
    || payeeReservation < context.terms.amountMinor
  ) {
    throw new PaymentError(409, 'INVALID_RESERVATION', 'The approved contract reservation is unavailable.');
  }
  const expiresAt = timestampToIso(context.contract.expiresAt);
  if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) {
    throw new PaymentError(409, 'CONTRACT_EXPIRED', 'The approved contract has expired.');
  }
}
