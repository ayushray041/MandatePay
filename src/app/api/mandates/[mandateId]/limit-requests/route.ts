import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { writeMandateAuditEvent } from '@/lib/mandates/audit';
import { MandateError, mandateErrorResponse } from '@/lib/mandates/errors';
import { assertNotExpired, isAuthorizedAgent, mandateStatus } from '@/lib/mandates/policy';
import { mandateLimitRequestSchema } from '@/models/mandate';

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

  const parsed = mandateLimitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_ARGUMENT', 'Spending-limit request is invalid.');
  }

  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Mandate storage is unavailable.');
  }

  const { mandateId } = await context.params;
  const firestore = adminFirestore;
  const mandateRef = firestore.collection('mandates').doc(mandateId);
  try {
    const pendingLimitRequest = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(mandateRef);
      if (!snapshot.exists) {
        throw new MandateError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
      }

      const mandate = snapshot.data();
      if (!mandate) {
        throw new Error('Mandate document has no data.');
      }
      if (!isAuthorizedAgent(mandate, authentication.user.uid)) {
        throw new MandateError(403, 'FORBIDDEN', 'Only the authorized agent can request a limit increase.');
      }
      assertNotExpired(mandate, new Date());
      if (mandateStatus(mandate) === 'revoked' || mandateStatus(mandate) === 'expired') {
        throw new MandateError(409, 'MANDATE_INACTIVE', 'Limit changes are unavailable for this mandate.');
      }
      if (mandate.pendingLimitRequest) {
        throw new MandateError(409, 'LIMIT_REQUEST_PENDING', 'A spending-limit request is already pending.');
      }
      if (parsed.data.requestedLimitMinor <= mandate.spendingLimitMinor) {
        throw new MandateError(400, 'INVALID_LIMIT_REQUEST', 'Requested limit must exceed the current limit.');
      }
      if (
        mandate.executionConditions?.maximumOperationAmountMinor !== undefined
        && mandate.executionConditions.maximumOperationAmountMinor > parsed.data.requestedLimitMinor
      ) {
        throw new MandateError(
          400,
          'INVALID_LIMIT_REQUEST',
          'Requested limit cannot be lower than the per-operation maximum.',
        );
      }

      const pending = {
        requestedLimitMinor: parsed.data.requestedLimitMinor,
        requestedBy: authentication.user.uid,
        reason: parsed.data.reason,
        previousLimitMinor: mandate.spendingLimitMinor,
        requestedAt: getServerTimestamp(),
      };
      transaction.update(mandateRef, {
        pendingLimitRequest: pending,
        updatedAt: getServerTimestamp(),
      });
      writeMandateAuditEvent(firestore, transaction, {
        mandateId,
        action: 'mandate.limit_increase_requested',
        performedBy: authentication.user.uid,
        payload: {
          previousLimitMinor: mandate.spendingLimitMinor,
          requestedLimitMinor: parsed.data.requestedLimitMinor,
          reason: parsed.data.reason,
        },
      });
      return {
        ...pending,
        requestedAt: new Date().toISOString(),
      };
    });

    return apiSuccess({ pendingLimitRequest }, 202);
  } catch (error: unknown) {
    return mandateErrorResponse(error);
  }
}
