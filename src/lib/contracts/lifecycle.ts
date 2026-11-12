import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { ContractError } from '@/lib/contracts/errors';
import { writeContractEvent } from '@/lib/contracts/events';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { contractReservationUsageWindowKeys } from '@/lib/contracts/policy';
import { assertContractVersionIntegrity } from '@/lib/contracts/integrity';
import { releaseMandateVelocityUsage } from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import { contractTermsSchema } from '@/models/contract';

type StoredContract = Record<string, unknown>;

async function releaseContractReservation(
  firestore: Firestore,
  transaction: FirebaseFirestore.Transaction,
  contractRef: DocumentReference,
  contract: StoredContract,
): Promise<void> {
  const mandateIds = contract.mandateIds;
  const currentVersionId = contract.currentVersionId;
  if (
    !Array.isArray(mandateIds)
    || mandateIds.length !== 2
    || typeof mandateIds[0] !== 'string'
    || typeof mandateIds[1] !== 'string'
    || mandateIds[0] === mandateIds[1]
    || typeof currentVersionId !== 'string'
  ) {
    throw new ContractError(500, 'INVALID_CONTRACT', 'Expired contract reservation references are invalid.');
  }
  const versionRef = contractRef.collection('versions').doc(currentVersionId);
  const firstMandateRef = firestore.collection('mandates').doc(mandateIds[0]);
  const secondMandateRef = firestore.collection('mandates').doc(mandateIds[1]);
  const [versionSnapshot, firstMandateSnapshot, secondMandateSnapshot] = await Promise.all([
    transaction.get(versionRef),
    transaction.get(firstMandateRef),
    transaction.get(secondMandateRef),
  ]);
  const version = versionSnapshot.data();
  const firstMandate = firstMandateSnapshot.data();
  const secondMandate = secondMandateSnapshot.data();
  if (
    !versionSnapshot.exists
    || !version
    || !firstMandateSnapshot.exists
    || !secondMandateSnapshot.exists
    || !firstMandate
    || !secondMandate
  ) {
    throw new ContractError(409, 'INVALID_RESERVATION', 'Expired contract reservations could not be verified.');
  }
  const termsResult = contractTermsSchema.safeParse(version?.terms);
  if (
    !termsResult.success
    || version.contractId !== contractRef.id
    || version.version !== contract.currentVersion
    || termsResult.data.parties[0].mandateId !== mandateIds[0]
    || termsResult.data.parties[1].mandateId !== mandateIds[1]
    || firstMandate.ownerId !== termsResult.data.parties[0].userId
    || secondMandate.ownerId !== termsResult.data.parties[1].userId
  ) {
    throw new ContractError(409, 'INVALID_RESERVATION', 'Expired contract reservations could not be verified.');
  }
  assertContractVersionIntegrity({
    contractId: String(version.contractId),
    version: Number(version.version),
    previousVersionId: typeof version.previousVersionId === 'string' ? version.previousVersionId : null,
    negotiationId: String(version.negotiationId ?? ''),
    amendmentId: typeof version.amendmentId === 'string' ? version.amendmentId : null,
    createdBy: String(version.createdBy ?? ''),
    terms: version.terms,
  }, version.integrityHash, currentVersionId);

  const amountMinor = termsResult.data.amountMinor;
  const usageWindowKeys = contractReservationUsageWindowKeys(contract.reservationUsageWindowKeys);
  const mandates = [firstMandate, secondMandate] as const;
  const mandateRefs = [firstMandateRef, secondMandateRef] as const;
  for (const index of [0, 1] as const) {
    const reservedAmountMinor = Number(mandates[index].reservedAmountMinor ?? 0);
    if (!Number.isSafeInteger(reservedAmountMinor) || reservedAmountMinor < amountMinor) {
      throw new ContractError(409, 'INVALID_RESERVATION', 'Expired contract reservation cannot be released safely.');
    }
    const velocity = usageWindowKeys?.[index]
      ? releaseMandateVelocityUsage(mandates[index], amountMinor, usageWindowKeys[index])
      : null;
    transaction.update(mandateRefs[index], {
      reservedAmountMinor: reservedAmountMinor - amountMinor,
      ...(velocity ? { velocityUsage: velocity } : {}),
      updatedAt: getServerTimestamp(),
    });
  }
}

export async function expireContractIfDue(
  firestore: Firestore,
  contractRef: DocumentReference,
  now: Date,
  source: 'access' | 'scheduled_expiry',
): Promise<{ expired: boolean; data: StoredContract }> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(contractRef);
    const contract = snapshot.data() as StoredContract | undefined;
    if (!snapshot.exists || !contract) {
      throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
    }

    const expiresAt = timestampToIso(contract.expiresAt);
    if (
      !['pending_review', 'active'].includes(String(contract.status))
      || !expiresAt
      || Date.parse(expiresAt) > now.getTime()
    ) {
      return { expired: false, data: contract };
    }

    const eventCount = Number(contract.eventCount);
    if (!Number.isSafeInteger(eventCount) || eventCount < 1 || eventCount >= Number.MAX_SAFE_INTEGER) {
      throw new ContractError(500, 'INVALID_CONTRACT', 'Contract event sequence is invalid.');
    }

    const activePayment = contract.status === 'active'
      ? await transaction.get(firestore.collection('payments').doc(contractRef.id))
      : null;
    if (contract.status === 'pending_review' || (activePayment && !activePayment.exists)) {
      await releaseContractReservation(firestore, transaction, contractRef, contract);
    }

    const timestamp = getServerTimestamp();
    transaction.update(contractRef, {
      status: 'expired',
      eventCount: eventCount + 1,
      updatedAt: timestamp,
    });
    writeContractEvent(transaction, contractRef, {
      sequence: eventCount + 1,
      type: 'contract.expired',
      actorId: 'system:contract-expiry',
      details: { source },
    });

    return {
      expired: true,
      data: {
        ...contract,
        status: 'expired',
        eventCount: eventCount + 1,
        updatedAt: now,
      },
    };
  });
}
