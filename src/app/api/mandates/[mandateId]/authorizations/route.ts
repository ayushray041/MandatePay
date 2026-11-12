import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { assertExecutionAllowed, isAuthorizedAgent } from '@/lib/mandates/policy';
import { mandateAuthorizationRequestSchema } from '@/models/mandate';

type RouteContext = { params: Promise<{ mandateId: string }> };

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
  const authorizationRef = firestore.collection('mandateAuthorizations').doc();
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

      const requiresOwnerApproval = assertExecutionAllowed(
        mandate,
        parsed.data.operation,
        parsed.data.amountMinor,
        parsed.data.description,
        new Date(),
      );
      const status = requiresOwnerApproval ? 'pending_approval' : 'approved';
      const now = getServerTimestamp();
      const authorization = {
        mandateId,
        ownerId: mandate.ownerId,
        authorizedAgentId: authentication.user.uid,
        operation: parsed.data.operation,
        amountMinor: parsed.data.amountMinor,
        currency: mandate.currency,
        description: parsed.data.description,
        status,
        createdAt: now,
        updatedAt: now,
      };

      transaction.create(authorizationRef, authorization);
      if (!requiresOwnerApproval) {
        transaction.update(mandateRef, {
          spentAmountMinor: mandate.spentAmountMinor + parsed.data.amountMinor,
          updatedAt: getServerTimestamp(),
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
          amountMinor: parsed.data.amountMinor,
          status,
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
      };
    });

    return apiSuccess(result, result.status === 'pending_approval' ? 202 : 201);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
