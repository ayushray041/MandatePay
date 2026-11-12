import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { assertDelegatedAgentsRegistered } from '@/lib/mandates/delegation';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { formatMandate, timestampToIso } from '@/lib/mandates/format';
import {
  assertOwner,
  assertOwnerAgentOrApprover,
  mandateStatus,
} from '@/lib/mandates/policy';
import {
  mandateCreateSchema,
  mandateUpdateSchema,
} from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

function validationDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function editableMandate(data: FirebaseFirestore.DocumentData) {
  return {
    title: data.title,
    description: data.description,
    authorizedAgentId: data.authorizedAgentId,
    spendingLimitMinor: data.spendingLimitMinor,
    currency: data.currency,
    durationType: data.durationType ?? 'temporary',
    startsAt: timestampToIso(data.startsAt),
    expiresAt: timestampToIso(data.expiresAt),
    allowedOperations: data.allowedOperations,
    approvalRequirements: data.approvalRequirements,
    executionConditions: data.executionConditions,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  try {
    const snapshot = await adminFirestore.collection('mandates').doc(mandateId).get();
    if (!snapshot.exists) {
      return apiError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const data = snapshot.data();
    if (!data) {
      throw new Error('Mandate document has no data.');
    }

    assertOwnerAgentOrApprover(data, authentication.user.uid);
    return apiSuccess(formatMandate(snapshot.id, data));
  } catch (error: unknown) {
    if (error instanceof MandateError) {
      return mandateErrorResponse(error);
    }
    return mandateErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = mandateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      'INVALID_ARGUMENT',
      'Mandate changes are invalid.',
      validationDetails(parsed.error.issues),
    );
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(mandateRef);
      if (!snapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }

      const current = snapshot.data();
      if (!current) {
        throw new Error('Mandate document has no data.');
      }

      assertOwner(current, authentication.user.uid);
      if (mandateStatus(current) !== 'draft') {
        throw new MandateError(
          409,
          'MANDATE_NOT_EDITABLE',
          'Only draft mandates can be edited.',
        );
      }

      if (
        parsed.data.authorizedAgentId
        && parsed.data.authorizedAgentId !== current.authorizedAgentId
      ) {
        const agent = await transaction.get(
          firestore.collection('users').doc(parsed.data.authorizedAgentId),
        );
        if (!agent.exists) {
          throw new MandateError(
            422,
            'INVALID_AGENT',
            'The authorized agent must have a registered user profile.',
          );
        }
      }

      if (
        parsed.data.spendingLimitMinor !== undefined
        && parsed.data.spendingLimitMinor > current.spendingLimitMinor
      ) {
        throw new MandateError(
          409,
          'LIMIT_APPROVAL_REQUIRED',
          'Spending-limit increases require an authorized-agent request and separate owner approval.',
        );
      }

      if (parsed.data.spendingLimitMinor !== undefined) {
        const committedAmounts = [
          current.spentAmountMinor,
          current.reservedAmountMinor ?? 0,
          current.authorizationReservedAmountMinor ?? 0,
        ];
        if (committedAmounts.some((amount) =>
          typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)) {
          throw new MandateError(500, 'INVALID_MANDATE', 'Mandate spend and reservation data is invalid.');
        }
        if (
          parsed.data.spendingLimitMinor
          < committedAmounts.reduce((total, amount) => total + Number(amount), 0)
        ) {
          throw new MandateError(
            409,
            'LIMIT_BELOW_COMMITTED_SPEND',
            'Spending limit cannot be lower than committed spend plus outstanding reservations.',
          );
        }
      }

      if (
        parsed.data.authorizedAgentId === authentication.user.uid
        || (parsed.data.authorizedAgentId === undefined
          && current.authorizedAgentId === authentication.user.uid)
      ) {
        throw new MandateError(400, 'INVALID_AGENT', 'The authorized agent must differ from the owner.');
      }

      const merged = mandateCreateSchema.safeParse({
        ...editableMandate(current),
        ...parsed.data,
      });
      if (!merged.success) {
        throw new MandateError(400, 'INVALID_ARGUMENT', 'Combined mandate fields are invalid.');
      }
      if (
        parsed.data.authorizedAgentId !== undefined
        || parsed.data.executionConditions?.allowedDelegateAgentIds !== undefined
        || parsed.data.executionConditions?.maximumDelegationDepth !== undefined
      ) {
        await assertDelegatedAgentsRegistered(
          firestore,
          transaction,
          merged.data.authorizedAgentId,
          merged.data.executionConditions.allowedDelegateAgentIds ?? [],
        );
      }

      const approvalRequirements = merged.data.approvalRequirements;
      const approverIds = approvalRequirements.approverIds ?? [current.ownerId];
      if (
        !approverIds.includes(current.ownerId)
        || approverIds.includes(current.authorizedAgentId)
      ) {
        throw new MandateError(
          422,
          'INVALID_APPROVERS',
          'The mandate owner must be an approver and the authorized agent cannot approve their own operations.',
        );
      }
      if (parsed.data.approvalRequirements?.approverIds) {
        const approverSnapshots = await Promise.all(
          parsed.data.approvalRequirements.approverIds.map((userId) =>
            transaction.get(firestore.collection('users').doc(userId))),
        );
        if (approverSnapshots.some((approver) => !approver.exists)) {
          throw new MandateError(
            422,
            'INVALID_APPROVERS',
            'Every approver must have a registered user profile.',
          );
        }
      }

      const currentVersion = Number(current.version ?? 1);
      if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
        throw new MandateError(500, 'INVALID_MANDATE', 'Mandate version is invalid.');
      }
      const nextVersion = currentVersion + 1;
      const changes: Record<string, unknown> = {
        ...parsed.data,
        ...(parsed.data.startsAt ? { startsAt: new Date(parsed.data.startsAt) } : {}),
        ...(parsed.data.expiresAt !== undefined
          ? { expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null }
          : {}),
        ...(parsed.data.approvalRequirements
          ? { approvalRequirements: { ...approvalRequirements, approverIds } }
          : {}),
        version: nextVersion,
        updatedAt: getServerTimestamp(),
      };
      transaction.update(mandateRef, changes);
      transaction.create(
        mandateRef.collection('versions').doc(String(nextVersion).padStart(6, '0')),
        {
          version: nextVersion,
          createdBy: authentication.user.uid,
          createdAt: getServerTimestamp(),
          reason: 'Draft mandate updated.',
          snapshot: { ...current, ...changes },
        },
      );
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: 'mandate.updated',
        performedBy: authentication.user.uid,
        payload: { changedFields: Object.keys(parsed.data) },
      });
    });

    const updated = await mandateRef.get();
    const data = updated.data();
    if (!data) {
      throw new Error('Updated mandate document could not be read.');
    }

    return apiSuccess(formatMandate(updated.id, data));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
