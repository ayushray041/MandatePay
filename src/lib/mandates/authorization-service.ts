import 'server-only';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import {
  addMandateVelocityUsage,
  assertExecutionAllowed,
  currentMandateVersion,
  getMandateApprovalQuorum,
  getMandateApprovers,
  isAuthorizedAgent,
} from '@/lib/mandates/policy';
import { MandateError } from '@/lib/mandates/errors';
import { mandateAuthorizationRequestSchema } from '@/models/mandate';

type AuthorizationInput = z.infer<typeof mandateAuthorizationRequestSchema>;

function authorizationFingerprint(data: Record<string, unknown>): string {
  return JSON.stringify({
    operation: data.operation,
    amountMinor: data.amountMinor,
    description: data.description,
    vendorId: data.vendorId ?? null,
    serviceCategory: data.serviceCategory ?? null,
    contractDurationDays: data.contractDurationDays ?? null,
  });
}

export async function createMandateAuthorization(
  firestore: Firestore,
  mandateId: string,
  agentUid: string,
  input: AuthorizationInput,
) {
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  const authorizationId = input.idempotencyKey
    ? createHash('sha256')
      .update(`${mandateId}:${agentUid}:${input.idempotencyKey}`)
      .digest('hex')
    : undefined;
  const authorizationCollection = firestore.collection('mandateAuthorizations');
  const authorizationRef = authorizationId
    ? authorizationCollection.doc(authorizationId)
    : authorizationCollection.doc();

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(mandateRef);
    if (!snapshot.exists) {
      throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const mandate = snapshot.data();
    if (!mandate) {
      throw new Error('Mandate document has no data.');
    }
    if (!isAuthorizedAgent(mandate, agentUid)) {
      throw new MandateError(403, 'FORBIDDEN', 'Only the authorized agent can request an operation.');
    }

    if (authorizationId) {
      const existing = await transaction.get(authorizationRef);
      if (existing.exists) {
        const existingData = existing.data();
        if (
          !existingData
          || authorizationFingerprint(existingData) !== authorizationFingerprint(input)
        ) {
          throw new MandateError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'The idempotency key was already used for a different operation.',
          );
        }
        return {
          authorization: { id: existing.id, ...existingData },
          status: existingData.status as 'pending_approval' | 'approved',
          duplicate: true,
        };
      }
    }

    const amountMinor = input.amountMinor;
    const now = new Date();
    const requiresOwnerApproval = assertExecutionAllowed(
      mandate,
      input.operation,
      amountMinor,
      input.description,
      now,
      { enforceVelocity: true },
    );
    const status = requiresOwnerApproval ? 'pending_approval' : 'approved';
    const approverIds = requiresOwnerApproval ? getMandateApprovers(mandate) : [];
    const approvalQuorum = requiresOwnerApproval ? getMandateApprovalQuorum(mandate) : 0;
    const version = currentMandateVersion(mandate);
    const nowTimestamp = getServerTimestamp();
    const usage = addMandateVelocityUsage(mandate, amountMinor, now);
    const authorization = {
      mandateId,
      ownerId: mandate.ownerId,
      authorizedAgentId: agentUid,
      operation: input.operation,
      amountMinor,
      currency: mandate.currency,
      description: input.description,
      vendorId: null,
      serviceCategory: null,
      contractDurationDays: null,
      mandateVersion: version,
      approvalApproverIds: approverIds,
      approvalQuorum,
      approvals: [],
      usageWindowKeys: usage.usageWindowKeys,
      idempotencyFingerprint: authorizationFingerprint(input),
      status,
      createdAt: nowTimestamp,
      updatedAt: nowTimestamp,
    };

    transaction.create(authorizationRef, authorization);
    if (requiresOwnerApproval) {
      const reserved = Number(mandate.authorizationReservedAmountMinor ?? 0);
      if (!Number.isSafeInteger(reserved) || reserved < 0 || !Number.isSafeInteger(reserved + amountMinor)) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Authorization reservation data is invalid.');
      }
      transaction.update(mandateRef, {
        authorizationReservedAmountMinor: reserved + amountMinor,
        velocityUsage: usage.velocityUsage,
        updatedAt: nowTimestamp,
      });
    } else {
      const spent = Number(mandate.spentAmountMinor);
      if (!Number.isSafeInteger(spent) || spent < 0 || !Number.isSafeInteger(spent + amountMinor)) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Mandate spend data is invalid.');
      }
      transaction.update(mandateRef, {
        spentAmountMinor: spent + amountMinor,
        velocityUsage: usage.velocityUsage,
        updatedAt: nowTimestamp,
      });
    }
    writeMandateAuditEvent(firestore, transaction, {
      mandateId,
      action: requiresOwnerApproval
        ? 'mandate.operation_approval_requested'
        : 'mandate.operation_approved',
      performedBy: agentUid,
      payload: {
        authorizationId: authorizationRef.id,
        operation: input.operation,
        amountMinor,
        status,
        mandateVersion: version,
      },
    });

    return {
      authorization: {
        id: authorizationRef.id,
        ...authorization,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      status,
      duplicate: false,
    };
  });
}
