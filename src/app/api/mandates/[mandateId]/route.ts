import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { formatMandate, timestampToIso } from '@/lib/mandates/format';
import {
  assertOwner,
  assertOwnerOrAgent,
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

    assertOwnerOrAgent(data, authentication.user.uid);
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

      if (
        parsed.data.spendingLimitMinor !== undefined
        && parsed.data.spendingLimitMinor
          < current.spentAmountMinor + (current.reservedAmountMinor ?? 0)
      ) {
        throw new MandateError(
          409,
          'LIMIT_BELOW_COMMITTED_SPEND',
          'Spending limit cannot be lower than authorized spend plus accepted negotiation reservations.',
        );
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

      const changes = {
        ...parsed.data,
        ...(parsed.data.startsAt ? { startsAt: new Date(parsed.data.startsAt) } : {}),
        ...(parsed.data.expiresAt ? { expiresAt: new Date(parsed.data.expiresAt) } : {}),
        updatedAt: getServerTimestamp(),
      };
      transaction.update(mandateRef, changes);
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
