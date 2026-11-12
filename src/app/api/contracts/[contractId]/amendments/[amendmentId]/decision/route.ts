import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import { writeContractEvent } from '@/lib/contracts/events';
import { formatContractAmendment } from '@/lib/contracts/format';
import {
  assertContractVersionIntegrity,
  contractVersionMetadata,
} from '@/lib/contracts/integrity';
import {
  assertContractTermsAuthorized,
  assertRequiredApprover,
  contractExpiryStatus,
  contractReservationUsageWindowKeys,
} from '@/lib/contracts/policy';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import {
  addMandateVelocityUsage,
  releaseMandateVelocityUsage,
} from '@/lib/mandates/policy';
import {
  amendmentDecisionSchema,
  contractTermsSchema,
} from '@/models/contract';

type RouteContext = {
  params: Promise<{ contractId: string; amendmentId: string }>;
};
type StoredData = Record<string, unknown>;

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Amendment decision must be valid JSON.');
  }
  const parsed = amendmentDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Amendment decision is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const { contractId, amendmentId } = await context.params;
  const firestore = adminFirestore;
  const contractRef = firestore.collection('contracts').doc(contractId);
  const amendmentRef = contractRef.collection('amendments').doc(amendmentId);
  const uid = authentication.user.uid;
  const now = new Date();
  try {
    const amendment = await firestore.runTransaction(async (transaction) => {
      const [contractSnapshot, amendmentSnapshot] = await Promise.all([
        transaction.get(contractRef),
        transaction.get(amendmentRef),
      ]);
      if (!contractSnapshot.exists || !amendmentSnapshot.exists) {
        throw new ContractError(404, 'AMENDMENT_NOT_FOUND', 'Amendment was not found.');
      }
      const contract = contractSnapshot.data();
      const amendment = amendmentSnapshot.data();
      if (!contract || !amendment || amendment.contractId !== contractId) {
        throw new ContractError(404, 'AMENDMENT_NOT_FOUND', 'Amendment was not found.');
      }
      assertRequiredApprover(contract, uid);
      if (
        contractExpiryStatus(contract.status, contract.expiresAt, now) !== 'active'
        || contract.activeAmendmentId !== amendmentId
        || amendment.status !== 'pending_review'
        || amendment.baseVersion !== contract.currentVersion
      ) {
        throw new ContractError(409, 'AMENDMENT_NOT_REVIEWABLE', 'Amendment is no longer reviewable.');
      }
      if (
        !Array.isArray(amendment.requiredApproverIds)
        || !amendment.requiredApproverIds.includes(uid)
        || !Array.isArray(amendment.approvals)
      ) {
        throw new ContractError(403, 'FORBIDDEN', 'This account is not authorized to review the amendment.');
      }
      if (amendment.approvals.includes(uid)) {
        throw new ContractError(409, 'ALREADY_REVIEWED', 'This account has already reviewed the amendment.');
      }

      const currentVersionId = String(contract.currentVersionId ?? '');
      const currentVersionRef = contractRef.collection('versions').doc(currentVersionId);
      const [currentVersionSnapshot] = await Promise.all([
        transaction.get(currentVersionRef),
      ]);
      if (!currentVersionSnapshot.exists) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Current contract version was not found.');
      }
      const currentVersion = currentVersionSnapshot.data();
      assertContractVersionIntegrity({
        contractId: String(currentVersion?.contractId ?? ''),
        version: Number(currentVersion?.version),
        previousVersionId: typeof currentVersion?.previousVersionId === 'string'
          ? currentVersion.previousVersionId
          : null,
        negotiationId: String(currentVersion?.negotiationId ?? ''),
        amendmentId: typeof currentVersion?.amendmentId === 'string'
          ? currentVersion.amendmentId
          : null,
        createdBy: String(currentVersion?.createdBy ?? ''),
        terms: currentVersion?.terms,
      }, currentVersion?.integrityHash, currentVersionId);
      const currentTermsResult = contractTermsSchema.safeParse(currentVersion?.terms);
      const proposedTermsResult = contractTermsSchema.safeParse(amendment.proposedTerms);
      if (!currentTermsResult.success || !proposedTermsResult.success) {
        throw new ContractError(500, 'INVALID_AMENDMENT', 'Current or proposed contract terms are invalid.');
      }
      const currentTerms = currentTermsResult.data;
      const proposedTerms = proposedTermsResult.data;
      const mandateIds = contract.mandateIds;
      if (
        !Array.isArray(mandateIds)
        || mandateIds.length !== 2
        || mandateIds[0] !== currentTerms.parties[0].mandateId
        || mandateIds[1] !== currentTerms.parties[1].mandateId
      ) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Contract mandate references are invalid.');
      }
      const [firstMandateSnapshot, secondMandateSnapshot, firstAgentSnapshot, secondAgentSnapshot] =
        await Promise.all([
          transaction.get(firestore.collection('mandates').doc(String(mandateIds[0]))),
          transaction.get(firestore.collection('mandates').doc(String(mandateIds[1]))),
          transaction.get(firestore.collection('agents').doc(currentTerms.parties[0].agentId)),
          transaction.get(firestore.collection('agents').doc(currentTerms.parties[1].agentId)),
        ]);
      if (
        !firstMandateSnapshot.exists
        || !secondMandateSnapshot.exists
      ) {
        throw new ContractError(409, 'MANDATE_UNAVAILABLE', 'A contract mandate is unavailable.');
      }
      const firstMandate = firstMandateSnapshot.data();
      const secondMandate = secondMandateSnapshot.data();
      const firstAgent = firstAgentSnapshot.data();
      const secondAgent = secondAgentSnapshot.data();
      if (!firstMandate || !secondMandate) {
        throw new Error('Contract mandate data is incomplete.');
      }
      const eventCount = Number(contract.eventCount ?? 0);
      if (!Number.isSafeInteger(eventCount) || eventCount < 1) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Contract event sequence is invalid.');
      }
      const nextApprovals = [...amendment.approvals, uid];
      const approved = amendment.requiredApproverIds.every(
        (approverId: string) => nextApprovals.includes(approverId),
      );
      const timestamp = getServerTimestamp();
      if (parsed.data.decision === 'reject') {
        transaction.update(amendmentRef, {
          status: 'rejected',
          rejectionReason: parsed.data.reason,
          updatedAt: timestamp,
        });
        transaction.update(contractRef, {
          activeAmendmentId: null,
          eventCount: eventCount + 1,
          updatedAt: timestamp,
        });
        writeContractEvent(transaction, contractRef, {
          sequence: eventCount + 1,
          type: 'amendment.rejected',
          actorId: uid,
          amendmentId,
          details: { reason: parsed.data.reason },
        });
        return {
          id: amendmentId,
          ...amendment,
          status: 'rejected',
          rejectionReason: parsed.data.reason,
          updatedAt: now,
        };
      }

      if (!firstAgent || !secondAgent) {
        throw new ContractError(409, 'AGENT_UNAVAILABLE', 'A contract agent profile is unavailable.');
      }
      assertContractTermsAuthorized(
        [firstMandate, secondMandate] as [StoredData, StoredData],
        [firstAgent, secondAgent] as [StoredData, StoredData],
        [currentTerms.parties[0].agentId, currentTerms.parties[1].agentId],
        proposedTerms,
        currentTerms.amountMinor,
        'contract.amend',
        now,
        contractReservationUsageWindowKeys(contract.reservationUsageWindowKeys),
      );

      if (!approved) {
        transaction.update(amendmentRef, {
          approvals: nextApprovals,
          updatedAt: timestamp,
        });
        transaction.update(contractRef, {
          eventCount: eventCount + 1,
          updatedAt: timestamp,
        });
        writeContractEvent(transaction, contractRef, {
          sequence: eventCount + 1,
          type: 'amendment.approved',
          actorId: uid,
          amendmentId,
        });
        return {
          id: amendmentId,
          ...amendment,
          approvals: nextApprovals,
          updatedAt: now,
        };
      }

      const nextVersion = Number(contract.currentVersion) + 1;
      const nextVersionId = `v${nextVersion}`;
      const nextVersionRef = contractRef.collection('versions').doc(nextVersionId);
      const nextVersionSnapshot = await transaction.get(nextVersionRef);
      if (nextVersionSnapshot.exists) {
        throw new ContractError(409, 'VERSION_CONFLICT', 'The next contract version already exists.');
      }
      const oldAmount = currentTerms.amountMinor;
      const newAmount = proposedTerms.amountMinor;
      const firstReserved = Number(firstMandate.reservedAmountMinor ?? 0);
      const secondReserved = Number(secondMandate.reservedAmountMinor ?? 0);
      if (
        !Number.isSafeInteger(firstReserved + newAmount - oldAmount)
        || !Number.isSafeInteger(secondReserved + newAmount - oldAmount)
        || firstReserved + newAmount - oldAmount < 0
        || secondReserved + newAmount - oldAmount < 0
      ) {
        throw new ContractError(409, 'INVALID_RESERVATION', 'The amended amount cannot be reserved safely.');
      }
      const reservationUsageKeys = contractReservationUsageWindowKeys(
        contract.reservationUsageWindowKeys,
      );
      const firstVelocityUsage = addMandateVelocityUsage(
        {
          ...firstMandate,
          velocityUsage: reservationUsageKeys?.[0]
            ? releaseMandateVelocityUsage(firstMandate, oldAmount, reservationUsageKeys[0])
            : firstMandate.velocityUsage,
        },
        newAmount,
        now,
      );
      const secondVelocityUsage = addMandateVelocityUsage(
        {
          ...secondMandate,
          velocityUsage: reservationUsageKeys?.[1]
            ? releaseMandateVelocityUsage(secondMandate, oldAmount, reservationUsageKeys[1])
            : secondMandate.velocityUsage,
        },
        newAmount,
        now,
      );
      transaction.update(firestore.collection('mandates').doc(String(mandateIds[0])), {
        reservedAmountMinor: firstReserved + newAmount - oldAmount,
        velocityUsage: firstVelocityUsage.velocityUsage,
        updatedAt: timestamp,
      });
      transaction.update(firestore.collection('mandates').doc(String(mandateIds[1])), {
        reservedAmountMinor: secondReserved + newAmount - oldAmount,
        velocityUsage: secondVelocityUsage.velocityUsage,
        updatedAt: timestamp,
      });
      const versionContent = {
        contractId,
        version: nextVersion,
        previousVersionId: currentVersionId,
        negotiationId: contract.negotiationId,
        amendmentId,
        createdBy: uid,
        terms: proposedTerms,
      };
      transaction.create(nextVersionRef, {
        ...versionContent,
        createdAt: timestamp,
        ...contractVersionMetadata(versionContent),
      });
      transaction.update(amendmentRef, {
        status: 'accepted',
        approvals: nextApprovals,
        updatedAt: timestamp,
      });
      transaction.update(contractRef, {
        currentVersion: nextVersion,
        currentVersionId: nextVersionId,
        activeAmendmentId: null,
        approvals: amendment.requiredApproverIds,
        expiresAt: new Date(proposedTerms.expiresAt),
        reservationUsageWindowKeys: {
          initiator: firstVelocityUsage.usageWindowKeys,
          recipient: secondVelocityUsage.usageWindowKeys,
        },
        eventCount: eventCount + 2,
        updatedAt: timestamp,
      });
      writeContractEvent(transaction, contractRef, {
        sequence: eventCount + 1,
        type: 'amendment.approved',
        actorId: uid,
        amendmentId,
      });
      writeContractEvent(transaction, contractRef, {
        sequence: eventCount + 2,
        type: 'contract.version_created',
        actorId: uid,
        amendmentId,
        versionId: nextVersionId,
        details: { version: nextVersion, amountMinor: newAmount, currency: proposedTerms.currency },
      });
      return {
        id: amendmentId,
        ...amendment,
        status: 'accepted',
        approvals: nextApprovals,
        updatedAt: now,
      };
    });
    return apiSuccess(formatContractAmendment(amendment.id, amendment));
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
}
