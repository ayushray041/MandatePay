import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import { writeContractEvent } from '@/lib/contracts/events';
import { formatContract } from '@/lib/contracts/format';
import {
  assertContractTermsAuthorized,
  assertRequiredApprover,
  contractReservationUsageWindowKeys,
} from '@/lib/contracts/policy';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { releaseMandateVelocityUsage } from '@/lib/mandates/policy';
import { contractTermsSchema, contractApprovalSchema } from '@/models/contract';

type RouteContext = { params: Promise<{ contractId: string }> };
type StoredData = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function usageWindowKeys(value: unknown): { daily?: string; weekly?: string; monthly?: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys: { daily?: string; weekly?: string; monthly?: string } = {};
  for (const window of ['daily', 'weekly', 'monthly'] as const) {
    if (typeof value[window] === 'string') {
      keys[window] = value[window] as string;
    }
  }
  return keys;
}

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Contract decision must be valid JSON.');
  }
  const parsed = contractApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Contract decision is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const { contractId } = await context.params;
  const firestore = adminFirestore;
  const contractRef = firestore.collection('contracts').doc(contractId);
  const uid = authentication.user.uid;
  const now = new Date();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const contractSnapshot = await transaction.get(contractRef);
      if (!contractSnapshot.exists) {
        throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
      }
      const contract = contractSnapshot.data();
      if (!contract) {
        throw new Error('Contract document has no data.');
      }
      assertRequiredApprover(contract, uid);
      if (contract.status !== 'pending_review') {
        throw new ContractError(409, 'CONTRACT_NOT_REVIEWABLE', 'Contract is not awaiting review.');
      }
      const requiredApproverIds = contract.requiredApproverIds;
      const approvals = contract.approvals;
      if (!Array.isArray(requiredApproverIds) || !Array.isArray(approvals)) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Contract approval data is invalid.');
      }
      if (approvals.includes(uid)) {
        throw new ContractError(409, 'ALREADY_REVIEWED', 'This account has already reviewed the contract.');
      }
      const versionId = String(contract.currentVersionId ?? '');
      const versionRef = contractRef.collection('versions').doc(versionId);
      const versionSnapshot = await transaction.get(versionRef);
      if (!versionSnapshot.exists) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Current contract version was not found.');
      }
      const version = versionSnapshot.data();
      const termsResult = contractTermsSchema.safeParse(version?.terms);
      if (!termsResult.success) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Current contract terms are invalid.');
      }
      const parties = termsResult.data.parties;
      const mandateIds = contract.mandateIds;
      if (
        !Array.isArray(mandateIds)
        || mandateIds.length !== 2
        || parties[0].mandateId !== mandateIds[0]
        || parties[1].mandateId !== mandateIds[1]
      ) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Contract mandate references are invalid.');
      }
      const [firstMandateSnapshot, secondMandateSnapshot, firstAgentSnapshot, secondAgentSnapshot] =
        await Promise.all([
          transaction.get(firestore.collection('mandates').doc(String(mandateIds[0]))),
          transaction.get(firestore.collection('mandates').doc(String(mandateIds[1]))),
          transaction.get(firestore.collection('agents').doc(parties[0].agentId)),
          transaction.get(firestore.collection('agents').doc(parties[1].agentId)),
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
      const timestamp = getServerTimestamp();
      if (parsed.data.decision === 'reject') {
        const firstReserved = Number(firstMandate.reservedAmountMinor ?? 0);
        const secondReserved = Number(secondMandate.reservedAmountMinor ?? 0);
        if (
          !Number.isSafeInteger(firstReserved)
          || !Number.isSafeInteger(secondReserved)
          || firstReserved < termsResult.data.amountMinor
          || secondReserved < termsResult.data.amountMinor
        ) {
          throw new ContractError(409, 'INVALID_RESERVATION', 'The accepted negotiation reservation is unavailable.');
        }
        const usageKeys = isRecord(contract.reservationUsageWindowKeys)
          ? contract.reservationUsageWindowKeys
          : {};
        const firstUsageKeys = usageWindowKeys(usageKeys.initiator);
        const secondUsageKeys = usageWindowKeys(usageKeys.recipient);
        transaction.update(firestore.collection('mandates').doc(String(mandateIds[0])), {
          reservedAmountMinor: firstReserved - termsResult.data.amountMinor,
          ...(firstUsageKeys ? {
            velocityUsage: releaseMandateVelocityUsage(
              firstMandate,
              termsResult.data.amountMinor,
              firstUsageKeys,
            ),
          } : {}),
          updatedAt: timestamp,
        });
        transaction.update(firestore.collection('mandates').doc(String(mandateIds[1])), {
          reservedAmountMinor: secondReserved - termsResult.data.amountMinor,
          ...(secondUsageKeys ? {
            velocityUsage: releaseMandateVelocityUsage(
              secondMandate,
              termsResult.data.amountMinor,
              secondUsageKeys,
            ),
          } : {}),
          updatedAt: timestamp,
        });
        transaction.update(contractRef, {
          status: 'rejected',
          rejectionReason: parsed.data.reason,
          eventCount: eventCount + 1,
          updatedAt: timestamp,
        });
        writeContractEvent(transaction, contractRef, {
          sequence: eventCount + 1,
          type: 'contract.rejected',
          actorId: uid,
          details: { reason: parsed.data.reason },
        });
        return {
          ...contract,
          status: 'rejected',
          rejectionReason: parsed.data.reason,
          eventCount: eventCount + 1,
          updatedAt: now,
        };
      }

      if (!firstAgent || !secondAgent) {
        throw new ContractError(409, 'AGENT_UNAVAILABLE', 'A contract agent profile is unavailable.');
      }
      assertContractTermsAuthorized(
        [firstMandate, secondMandate] as [StoredData, StoredData],
        [firstAgent, secondAgent] as [StoredData, StoredData],
        [parties[0].agentId, parties[1].agentId],
        termsResult.data,
        termsResult.data.amountMinor,
        'contract.create',
        now,
        contractReservationUsageWindowKeys(contract.reservationUsageWindowKeys),
      );
      const nextApprovals = [...approvals, uid];
      const activated = requiredApproverIds.every((approverId) => nextApprovals.includes(approverId));
      transaction.update(contractRef, {
        approvals: nextApprovals,
        ...(activated ? { status: 'active', activatedAt: timestamp } : {}),
        eventCount: eventCount + (activated ? 2 : 1),
        updatedAt: timestamp,
      });
      writeContractEvent(transaction, contractRef, {
        sequence: eventCount + 1,
        type: 'contract.approved',
        actorId: uid,
        versionId,
      });
      if (activated) {
        writeContractEvent(transaction, contractRef, {
          sequence: eventCount + 2,
          type: 'contract.activated',
          actorId: uid,
          versionId,
        });
      }
      return {
        ...contract,
        approvals: nextApprovals,
        ...(activated ? { status: 'active', activatedAt: now } : {}),
        eventCount: eventCount + (activated ? 2 : 1),
        updatedAt: now,
      };
    });
    return apiSuccess(formatContract(contractId, result));
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
}
