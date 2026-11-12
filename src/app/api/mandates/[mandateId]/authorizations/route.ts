import { createHash } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import {
  addMandateVelocityUsage,
  assertExecutionAllowed,
  currentMandateVersion,
  getMandateApprovalQuorum,
  getMandateApprovers,
  isAuthorizedAgent,
  isMandateApprover,
} from '@/lib/mandates/policy';
import { timestampToIso } from '@/lib/mandates/format';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { mandateAuthorizationRequestSchema } from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

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
    const mandateSnapshot = await adminFirestore.collection('mandates').doc(mandateId).get();
    if (!mandateSnapshot.exists) {
      return apiError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const mandate = mandateSnapshot.data();
    if (!mandate) {
      throw new Error('Mandate document has no data.');
    }
    if (
      mandate.ownerId !== authentication.user.uid
      && mandate.authorizedAgentId !== authentication.user.uid
      && !isMandateApprover(mandate, authentication.user.uid)
    ) {
      throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }

    const authorizations = await adminFirestore
      .collection('mandateAuthorizations')
      .where('mandateId', '==', mandateId)
      .orderBy('createdAt', 'desc')
      .get();

    return apiSuccess(authorizations.docs.map((snapshot) => {
      const data = snapshot.data();
      return {
        ...data,
        id: snapshot.id,
        createdAt: timestampToIso(data.createdAt),
        updatedAt: timestampToIso(data.updatedAt),
      };
    }));
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
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
    return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = mandateAuthorizationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Mandate operation request is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  const authorizationId = parsed.data.idempotencyKey
    ? createHash('sha256')
      .update(`${mandateId}:${authentication.user.uid}:${parsed.data.idempotencyKey}`)
      .digest('hex')
    : undefined;
  const authorizationCollection = firestore.collection('mandateAuthorizations');
  const authorizationRef = authorizationId
    ? authorizationCollection.doc(authorizationId)
    : authorizationCollection.doc();
  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(mandateRef);
      if (!snapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }

      const mandate = snapshot.data();
      if (!mandate) {
        throw new Error('Mandate document has no data.');
      }
      if (!isAuthorizedAgent(mandate, authentication.user.uid)) {
        throw new MandateError(403, 'FORBIDDEN', 'Only the authorized agent can request an operation.');
      }

      if (authorizationId) {
        const existing = await transaction.get(authorizationRef);
        if (existing.exists) {
          const existingData = existing.data();
          if (!existingData || authorizationFingerprint(existingData) !== authorizationFingerprint(parsed.data)) {
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

      const amountMinor = parsed.data.amountMinor;
      const now = new Date();
      const requiresOwnerApproval = assertExecutionAllowed(
        mandate,
        parsed.data.operation,
        amountMinor,
        parsed.data.description,
        now,
        {
          enforceVelocity: true,
        },
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
        authorizedAgentId: authentication.user.uid,
        operation: parsed.data.operation,
        amountMinor,
        currency: mandate.currency,
        description: parsed.data.description,
        vendorId: null,
        serviceCategory: null,
        contractDurationDays: null,
        mandateVersion: version,
        approvalApproverIds: approverIds,
        approvalQuorum,
        approvals: [],
        usageWindowKeys: usage.usageWindowKeys,
        idempotencyFingerprint: authorizationFingerprint(parsed.data),
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
        performedBy: authentication.user.uid,
        payload: {
          authorizationId: authorizationRef.id,
          operation: parsed.data.operation,
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

    return apiSuccess(result, result.duplicate ? 200 : result.status === 'pending_approval' ? 202 : 201);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
