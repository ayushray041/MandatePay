import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { ContractError, contractErrorResponse } from '@/lib/contracts/errors';
import { writeContractEvent } from '@/lib/contracts/events';
import { formatContractAmendment } from '@/lib/contracts/format';
import { assertContractVersionIntegrity } from '@/lib/contracts/integrity';
import {
  assertContractParty,
  assertContractTermsAuthorized,
  contractExpiryStatus,
} from '@/lib/contracts/policy';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import {
  amendmentProposeSchema,
  contractTermsSchema,
} from '@/models/contract';

type RouteContext = { params: Promise<{ contractId: string }> };
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
    return apiError(400, 'INVALID_JSON', 'Amendment proposal must be valid JSON.');
  }
  const parsed = amendmentProposeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Amendment proposal is invalid.');
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Contract storage is unavailable.');
  }

  const { contractId } = await context.params;
  const firestore = adminFirestore;
  const contractRef = firestore.collection('contracts').doc(contractId);
  const amendmentRef = contractRef.collection('amendments').doc();
  const uid = authentication.user.uid;
  const now = new Date();
  try {
    const amendment = await firestore.runTransaction(async (transaction) => {
      const [contractSnapshot, paymentSnapshot] = await Promise.all([
        transaction.get(contractRef),
        transaction.get(firestore.collection('payments').doc(contractId)),
      ]);
      if (!contractSnapshot.exists) {
        throw new ContractError(404, 'CONTRACT_NOT_FOUND', 'Contract was not found.');
      }
      const contract = contractSnapshot.data();
      if (!contract) {
        throw new Error('Contract document has no data.');
      }
      assertContractParty(contract, uid);
      if (contractExpiryStatus(contract.status, contract.expiresAt, now) === 'expired') {
        throw new ContractError(409, 'CONTRACT_EXPIRED', 'The contract has expired and cannot be amended.');
      }
      if (contract.status !== 'active') {
        throw new ContractError(409, 'CONTRACT_NOT_ACTIVE', 'Only an active contract can be amended.');
      }
      if (paymentSnapshot.exists && paymentSnapshot.data()?.status !== 'cancelled') {
        throw new ContractError(
          409,
          'PAYMENT_IN_PROGRESS',
          'A contract cannot be amended while its payment is active or complete.',
        );
      }
      if (contract.activeAmendmentId) {
        throw new ContractError(409, 'AMENDMENT_ALREADY_PENDING', 'Resolve the current amendment before proposing another.');
      }

      const versionId = String(contract.currentVersionId ?? '');
      const versionSnapshot = await transaction.get(
        contractRef.collection('versions').doc(versionId),
      );
      if (!versionSnapshot.exists) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Current contract version was not found.');
      }
      const currentVersion = versionSnapshot.data();
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
      }, currentVersion?.integrityHash, versionId);
      const currentTermsResult = contractTermsSchema.safeParse(currentVersion?.terms);
      if (!currentTermsResult.success) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Current contract terms are invalid.');
      }
      const currentTerms = currentTermsResult.data;
      const proposedTermsResult = contractTermsSchema.safeParse({
        ...currentTerms,
        ...parsed.data,
        service: { ...currentTerms.service, ...parsed.data.service },
      });
      if (!proposedTermsResult.success) {
        throw new ContractError(400, 'INVALID_ARGUMENT', 'Amended contract terms are invalid.');
      }
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
        || !firstAgentSnapshot.exists
        || !secondAgentSnapshot.exists
      ) {
        throw new ContractError(409, 'MANDATE_UNAVAILABLE', 'A contract mandate or agent profile is unavailable.');
      }
      const firstMandate = firstMandateSnapshot.data();
      const secondMandate = secondMandateSnapshot.data();
      const firstAgent = firstAgentSnapshot.data();
      const secondAgent = secondAgentSnapshot.data();
      if (!firstMandate || !secondMandate || !firstAgent || !secondAgent) {
        throw new Error('Contract authorization data is incomplete.');
      }
      assertContractTermsAuthorized(
        [firstMandate, secondMandate] as [StoredData, StoredData],
        [firstAgent, secondAgent] as [StoredData, StoredData],
        [currentTerms.parties[0].agentId, currentTerms.parties[1].agentId],
        proposedTerms,
        currentTerms.amountMinor,
        'contract.amend',
        now,
      );

      const requiredApproverIds = contract.requiredApproverIds;
      const eventCount = Number(contract.eventCount ?? 0);
      if (!Array.isArray(requiredApproverIds) || !Number.isSafeInteger(eventCount)) {
        throw new ContractError(500, 'INVALID_CONTRACT', 'Contract approval or event data is invalid.');
      }
      const timestamp = getServerTimestamp();
      const amendmentData = {
        contractId,
        baseVersion: contract.currentVersion,
        proposedTerms,
        status: 'pending_review',
        requiredApproverIds,
        approvals: [],
        createdBy: uid,
        rejectionReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(amendmentRef, amendmentData);
      transaction.update(contractRef, {
        activeAmendmentId: amendmentRef.id,
        eventCount: eventCount + 1,
        updatedAt: timestamp,
      });
      writeContractEvent(transaction, contractRef, {
        sequence: eventCount + 1,
        type: 'amendment.proposed',
        actorId: uid,
        amendmentId: amendmentRef.id,
        details: { baseVersion: contract.currentVersion },
      });
      return {
        id: amendmentRef.id,
        ...amendmentData,
        createdAt: now,
        updatedAt: now,
      };
    });
    return apiSuccess(formatContractAmendment(amendment.id, amendment), 201);
  } catch (error: unknown) {
    return contractErrorResponse(error);
  }
}
